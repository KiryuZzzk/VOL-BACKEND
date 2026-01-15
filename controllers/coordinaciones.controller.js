// controllers/coordinaciones.controller.js
const db = require("../config/db");

function normalizeCodes(input) {
  const arr = Array.isArray(input) ? input : [];
  return [...new Set(arr.map((x) => String(x || "").trim().toUpperCase()).filter(Boolean))];
}

const ALLOWED_STATUS = new Set([
  "INTERESADO",
  "EN_PROCESO",
  "PENDIENTE_VALIDACION",
  "ACTIVO",
  "OBSERVADO",
  "RECHAZADO",
  "BAJA",
]);

function getFirebaseUid(req) {
  // En tu controller actual ya usas req.firebaseUser?.uid
  const uid = String(req.firebaseUser?.uid || "").trim();
  return uid || null;
}

// Compat: si te mandan users.id (UUID char36) lo convertimos a uid.
// Si te mandan uid ya, lo dejamos.
async function resolveUidFromParam(maybeIdOrUid) {
  const v = String(maybeIdOrUid || "").trim();
  if (!v) return null;

  // Heurística simple: UUID típico 36 chars con guiones
  const looksUuid = v.length === 36 && v.includes("-");
  if (!looksUuid) return v; // asumimos que ya es uid

  const [[row]] = await db.query(`SELECT uid FROM users WHERE id = ? LIMIT 1`, [v]);
  return row?.uid || null;
}

// === helpers sync enrollment <-> coordinaciones ===

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  const s = String(value).trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizeCoordStatus(s) {
  return String(s || "").trim().toUpperCase();
}

// Define qué estados cuentan como "tiene la coordinación"
function statusCountsAsHasCoord(status) {
  const s = normalizeCoordStatus(status);
  if (!s) return false;
  return !["RECHAZADO", "BAJA"].includes(s);
}

// Interpreta tags tipo:
// @req:coord:SOC
// @req:coord:SOC:ACTIVO
function parseReqCoordTag(tag) {
  const t = String(tag || "").trim();
  if (!t.startsWith("@req:coord:")) return null;

  const parts = t.split(":"); // ["@req", "coord", "SOC", "ACTIVO?"]
  const coordCode = (parts[2] || "").trim().toUpperCase();
  const minStatus = (parts[3] || "").trim().toUpperCase() || null;

  if (!coordCode) return null;
  return { coordCode, minStatus };
}

// Define mínimo para tags con :ACTIVO (si luego quieres más, lo expandes)
function meetsMinStatus(userCoordStatus, minStatus) {
  const s = normalizeCoordStatus(userCoordStatus);
  if (!minStatus) return true;

  if (minStatus === "ACTIVO") return s === "ACTIVO";
  if (minStatus === "PENDIENTE_VALIDACION") return ["PENDIENTE_VALIDACION", "ACTIVO"].includes(s);

  // fallback conservador
  return s === minStatus;
}

async function syncProgramsForCoord(conn, uid, coordCode, userCoordStatus) {
  const code = String(coordCode || "").trim().toUpperCase();
  if (!uid || !code) return { ok: false, reason: "uid/coordCode missing" };

  // “hasCoord” según tu política
  const hasCoord = statusCountsAsHasCoord(userCoordStatus);

  // 1) Traer programas activos con tags_json
  const [pRows] = await conn.query(
    `
    SELECT program_id, code, tags_json
    FROM program
    WHERE is_active = 1
      AND tags_json IS NOT NULL
      AND tags_json <> ''
    `
  );

  // 2) Filtrar programas que dependan de esta coordinación
  const targets = [];
  for (const p of pRows) {
    const tags = safeJsonParse(p.tags_json, []);
    if (!Array.isArray(tags) || !tags.length) continue;

    // ¿algún tag @req:coord:<code> (con o sin minStatus) matchea?
    let matches = false;
    for (const tag of tags) {
      const parsed = parseReqCoordTag(tag);
      if (!parsed) continue;
      if (parsed.coordCode !== code) continue;
      if (!meetsMinStatus(userCoordStatus, parsed.minStatus)) continue;
      matches = true;
      break;
    }

    if (matches) targets.push({ program_id: p.program_id, program_code: p.code });
  }

  // 3) Upsert enrollments sin pisar completed
  // - si hasCoord => enrolled
  // - si !hasCoord => disabled
  // - jamás tocar completed
  const desired = hasCoord ? "enrolled" : "disabled";

  for (const t of targets) {
    await conn.query(
      `
      INSERT INTO user_program_enrollment (user_id, program_id, status, enrolled_at)
      VALUES (?, ?, ?, NOW())
      ON DUPLICATE KEY UPDATE
        status = CASE
          WHEN status = 'completed' THEN status
          ELSE VALUES(status)
        END
      `,
      [uid, t.program_id, desired]
    );
  }

  return {
    ok: true,
    coordCode: code,
    hasCoord,
    desired,
    affectedPrograms: targets.map((x) => x.program_code),
  };
}

/**
 * GET /coordinaciones
 * Catálogo de coordinaciones activas
 */
exports.getCoordinaciones = async (req, res) => {
  try {
    const [rows] = await db.query(
      `
      SELECT coordinacion_id, code, name, description, is_active
      FROM coordinaciones
      WHERE is_active = 1
      ORDER BY name ASC
      `
    );
    return res.json({ ok: true, coordinaciones: rows });
  } catch (err) {
    console.error("❌ getCoordinaciones:", err);
    return res.status(500).json({ ok: false, error: "Error al obtener coordinaciones" });
  }
};

/**
 * GET /coordinaciones/me
 * Coordinaciones del usuario actual (por Firebase UID)
 */
exports.getMisCoordinaciones = async (req, res) => {
  try {
    const firebaseUid = getFirebaseUid(req);
    if (!firebaseUid) return res.status(401).json({ ok: false, error: "No autenticado" });

    const [rows] = await db.query(
      `
      SELECT
        uc.user_coordinacion_id,
        c.code,
        c.name,
        uc.status,
        uc.requested_at,
        uc.status_updated_at,
        uc.validated_at,
        uc.validated_by,
        uc.validation_notes,
        uc.is_active
      FROM user_coordinaciones uc
      JOIN coordinaciones c ON c.coordinacion_id = uc.coordinacion_id
      WHERE uc.user_id = ?
        AND uc.is_active = 1
        AND c.is_active = 1
      ORDER BY c.name ASC
      `,
      [firebaseUid]
    );

    return res.json({ ok: true, coordinaciones: rows });
  } catch (err) {
    console.error("❌ getMisCoordinaciones:", err);
    return res.status(500).json({ ok: false, error: "Error al obtener tus coordinaciones" });
  }
};

/**
 * POST /coordinaciones/me
 * Body: { codes: ["SOC","COM"] }
 *
 * Registra selección de coordinaciones (al terminar SV):
 * - upsert en user_coordinaciones usando Firebase UID
 * - ✅ Marca programa SV como COMPLETED en user_program_enrollment (Firebase UID)
 *
 * ✅ ADICIÓN: si el usuario QUITA una coordinación, se marca como BAJA y se deshabilitan enrollments dependientes.
 */
exports.setMisCoordinaciones = async (req, res) => {
  const firebaseUid = getFirebaseUid(req);
  if (!firebaseUid) return res.status(401).json({ ok: false, error: "No autenticado" });

  const codes = normalizeCodes(req.body?.codes);

  // Regla actual: máximo 2 al finalizar SV
  if (codes.length > 2) {
    return res.status(400).json({ ok: false, error: "Máximo 2 coordinaciones en esta etapa" });
  }

  // Si quieres permitir "quitar todas", cambia esto.
  if (codes.length === 0) {
    return res.json({ ok: true, message: "Sin cambios (lista vacía)" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Resolver codes -> coordinacion_id
    const [coords] = await conn.query(
      `SELECT coordinacion_id, code
       FROM coordinaciones
       WHERE is_active = 1
         AND code IN (${codes.map(() => "?").join(",")})`,
      codes
    );

    const found = new Set(coords.map((c) => String(c.code).toUpperCase()));
    const missing = codes.filter((c) => !found.has(c));
    if (missing.length) {
      await conn.rollback();
      return res.status(400).json({
        ok: false,
        error: `Coordinaciones no válidas/inactivas: ${missing.join(", ")}`,
      });
    }

    // ✅ 1.5) Desactivar coordinaciones que el usuario ya tenía pero ya no seleccionó
    const [currentRows] = await conn.query(
      `
      SELECT uc.coordinacion_id, c.code, uc.status
      FROM user_coordinaciones uc
      JOIN coordinaciones c ON c.coordinacion_id = uc.coordinacion_id
      WHERE uc.user_id = ?
        AND uc.is_active = 1
        AND c.is_active = 1
      `,
      [firebaseUid]
    );

    const selectedSet = new Set(coords.map((c) => String(c.code).toUpperCase()));
    const toRemove = currentRows
      .map((r) => ({
        coordinacion_id: r.coordinacion_id,
        code: String(r.code).toUpperCase(),
      }))
      .filter((r) => !selectedSet.has(r.code));

    for (const r of toRemove) {
      await conn.query(
        `
        UPDATE user_coordinaciones
        SET status = 'BAJA',
            status_updated_at = NOW()
        WHERE user_id = ?
          AND coordinacion_id = ?
        LIMIT 1
        `,
        [firebaseUid, r.coordinacion_id]
      );

      // Esto dispara disable en enrollments dependientes
      await syncProgramsForCoord(conn, firebaseUid, r.code, "BAJA");
    }

    // 2) Upsert en user_coordinaciones (Firebase UID)
    for (const c of coords) {
      await conn.query(
        `
        INSERT INTO user_coordinaciones (user_id, coordinacion_id, status, status_updated_at, is_active)
        VALUES (?, ?, 'EN_PROCESO', NOW(), 1)
        ON DUPLICATE KEY UPDATE
          status = CASE
            WHEN status IN ('ACTIVO','PENDIENTE_VALIDACION') THEN status
            ELSE 'EN_PROCESO'
          END,
          status_updated_at = NOW(),
          is_active = 1
        `,
        [firebaseUid, c.coordinacion_id]
      );

      await syncProgramsForCoord(conn, firebaseUid, c.code, "EN_PROCESO");
    }

    // 3) ✅ Marcar SV como COMPLETED en user_program_enrollment (Firebase UID)
    const [[sv]] = await conn.query(`SELECT program_id FROM program WHERE code = 'SV' LIMIT 1`);

    if (sv?.program_id) {
      await conn.query(
        `
        INSERT INTO user_program_enrollment (user_id, program_id, status, enrolled_at, completed_at)
        VALUES (?, ?, 'completed', NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = 'completed',
          completed_at = NOW()
        `,
        [firebaseUid, sv.program_id]
      );
    }

    await conn.commit();
    return res.json({ ok: true, message: "Coordinaciones registradas y SV completado", codes });
  } catch (err) {
    console.error("❌ setMisCoordinaciones:", err);
    try {
      await conn.rollback();
    } catch {}
    return res.status(500).json({ ok: false, error: "Error al guardar coordinaciones" });
  } finally {
    conn.release();
  }
};

/**
 * PATCH /coordinaciones/:code/users/:userId/status
 * Body: { status: "...", notes?: "..." }
 *
 * ✅ Ahora userId se interpreta como Firebase UID.
 * Compat: si te mandan users.id (UUID), se convierte a uid.
 */
exports.updateStatusUsuarioEnCoordinacion = async (req, res) => {
  const code = String(req.params.code || "").trim().toUpperCase();
  const userIdParam = String(req.params.userId || "").trim();
  const status = String(req.body?.status || "").trim().toUpperCase();
  const notes = req.body?.notes != null ? String(req.body.notes) : null;

  if (!code || !userIdParam || !ALLOWED_STATUS.has(status)) {
    return res.status(400).json({ ok: false, error: "Parámetros inválidos" });
  }

  const validatorUid = getFirebaseUid(req) || null;

  const targetUid = await resolveUidFromParam(userIdParam);
  if (!targetUid) return res.status(404).json({ ok: false, error: "Usuario no encontrado" });

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [[coord]] = await conn.query(
      `SELECT coordinacion_id FROM coordinaciones WHERE code = ? LIMIT 1`,
      [code]
    );

    if (!coord) {
      await conn.rollback();
      return res.status(404).json({ ok: false, error: "Coordinación no encontrada" });
    }

    await conn.query(
      `
      INSERT INTO user_coordinaciones (user_id, coordinacion_id, status, status_updated_at, is_active)
      VALUES (?, ?, ?, NOW(), 1)
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        status_updated_at = NOW(),
        is_active = 1
      `,
      [targetUid, coord.coordinacion_id, status]
    );

    const isDecision = ["ACTIVO", "OBSERVADO", "RECHAZADO"].includes(status);
    if (isDecision) {
      await conn.query(
        `
        UPDATE user_coordinaciones
        SET validated_at = NOW(),
            validated_by = ?,
            validation_notes = ?
        WHERE user_id = ? AND coordinacion_id = ?
        LIMIT 1
        `,
        [validatorUid, notes, targetUid, coord.coordinacion_id]
      );
    } else if (notes !== null) {
      await conn.query(
        `
        UPDATE user_coordinaciones
        SET validation_notes = ?
        WHERE user_id = ? AND coordinacion_id = ?
        LIMIT 1
        `,
        [notes, targetUid, coord.coordinacion_id]
      );
    }

    await syncProgramsForCoord(conn, targetUid, code, status);

    await conn.commit();
    return res.json({
      ok: true,
      message: "Estatus actualizado",
      code,
      userId: targetUid,
      status,
    });
  } catch (err) {
    console.error("❌ updateStatusUsuarioEnCoordinacion:", err);
    try {
      await conn.rollback();
    } catch {}
    return res.status(500).json({ ok: false, error: "Error al actualizar estatus" });
  } finally {
    conn.release();
  }
};
