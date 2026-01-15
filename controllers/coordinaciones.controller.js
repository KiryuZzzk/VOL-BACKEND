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
 */
exports.setMisCoordinaciones = async (req, res) => {
  const firebaseUid = getFirebaseUid(req);
  if (!firebaseUid) return res.status(401).json({ ok: false, error: "No autenticado" });

  const codes = normalizeCodes(req.body?.codes);

  // Regla actual: máximo 2 al finalizar SV
  if (codes.length > 2) {
    return res.status(400).json({ ok: false, error: "Máximo 2 coordinaciones en esta etapa" });
  }

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
