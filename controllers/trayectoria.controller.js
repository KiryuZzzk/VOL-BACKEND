const db = require("../config/db");

/**
 * Helpers
 */
function normalizeStatus(s) {
  const v = String(s || "").trim().toLowerCase();
  const allowed = ["pending", "validated", "rejected"];
  if (!v) return null;
  if (!allowed.includes(v)) return null;
  return v;
}

function safeLike(str) {
  return `%${String(str || "").trim()}%`;
}

// Normaliza categorías (case/acentos/espacios)
function normCategory(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Categorías que disparan auto-inscripción a SOC
const TUM_CATEGORIES = new Set([
  normCategory("TUM Cruz Roja Mexicana"),
  normCategory("TUM externo"),
]);

/**
 * Asegura que el usuario quede inscrito a SOC (coordinación code=SOC)
 * - Inserta si no existe
 * - Si ya existe, no pisa estados finales (ACTIVO/PENDIENTE_VALIDACION/RECHAZADO/BAJA)
 * - En otros casos lo deja/manda a EN_PROCESO
 */
async function ensureSocEnrollment(firebaseUid) {
  // 1) Obtener coordinacion_id de SOC
  const [socRows] = await db.query(
    `
      SELECT coordinacion_id
      FROM coordinaciones
      WHERE code = 'SOC' AND is_active = 1
      LIMIT 1
    `
  );

  const soc = socRows?.[0];
  if (!soc?.coordinacion_id) {
    // Esto es un error de datos (catálogo), pero no debería tumbar el alta de trayectoria.
    console.warn("⚠️ SOC no existe o no está activo en coordinaciones");
    return { ok: false, reason: "SOC_NOT_FOUND" };
  }

  // 2) Upsert
  await db.query(
    `
    INSERT INTO user_coordinaciones
      (user_id, coordinacion_id, status, requested_at, status_updated_at, is_active)
    VALUES
      (?,       ?,              'EN_PROCESO', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 1)
    ON DUPLICATE KEY UPDATE
      is_active = 1,
      status_updated_at = CURRENT_TIMESTAMP,
      status = CASE
        WHEN status IN ('ACTIVO','PENDIENTE_VALIDACION','RECHAZADO','BAJA')
          THEN status
        ELSE 'EN_PROCESO'
      END
    `,
    [firebaseUid, soc.coordinacion_id]
  );

  return { ok: true, coordinacion_id: soc.coordinacion_id };
}

/**
 * ─────────────────────────────────────────────────────────────
 *  POST /trayectoria
 *  Usuario autenticado (aspirante/admin/mod)
 *  Crea un registro de trayectoria del usuario (uid)
 *  - file_url puede ser null
 *  - status por defecto 'pending'
 *  - submitted_at se setea al crear
 *  - SI category es TUM => auto-inscribe a SOC (EN_PROCESO)
 * ─────────────────────────────────────────────────────────────
 */
const crearTrayectoria = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const {
      year,
      category,
      title,
      folio,
      file_url,
      storage_path,
      file_name,
      file_type,
      file_size_bytes,
    } = req.body;

    // Validaciones mínimas
    if (!category || !title) {
      return res.status(400).json({ error: "category y title son obligatorios" });
    }

    const yearNum = year === null || year === undefined || year === "" ? null : Number(year);
    if (yearNum !== null && (!Number.isFinite(yearNum) || yearNum < 1900 || yearNum > 2100)) {
      return res.status(400).json({ error: "year inválido" });
    }

    const sql = `
      INSERT INTO trajectory
      (uid, year, category, title, folio, file_url, storage_path, file_name, file_type, file_size_bytes,
       status, submitted_at)
      VALUES
      (?,   ?,    ?,        ?,     ?,     ?,        ?,           ?,         ?,         ?,
       'pending', CURRENT_TIMESTAMP)
    `;

    const params = [
      uid,
      yearNum,
      String(category).trim(),
      String(title).trim(),
      folio ? String(folio).trim() : null,
      file_url ? String(file_url).trim() : null,
      storage_path ? String(storage_path).trim() : null,
      file_name ? String(file_name).trim() : null,
      file_type ? String(file_type).trim() : null,
      file_size_bytes === null || file_size_bytes === undefined || file_size_bytes === ""
        ? null
        : Number(file_size_bytes),
    ];

    console.log("📌 crearTrayectoria →", { uid, year: yearNum, category, title });

    const [result] = await db.query(sql, params);

    // ✅ Auto-inscripción a SOC si la categoría es TUM
    let autoEnrollSoc = null;
    const isTum = TUM_CATEGORIES.has(normCategory(category));
    if (isTum) {
      try {
        autoEnrollSoc = await ensureSocEnrollment(uid);
        console.log("✅ Auto-enroll SOC:", { uid, ...autoEnrollSoc });
      } catch (e) {
        // No tumbes el alta de trayectoria por un tema de coordinación
        console.error("⚠️ Error auto-enroll SOC (no bloquea trayectoria):", e);
        autoEnrollSoc = { ok: false, reason: "ERROR" };
      }
    }

    return res.status(201).json({
      mensaje: "Trayectoria creada",
      trajectory_id: result.insertId,
      auto_enroll_soc: isTum ? autoEnrollSoc : null,
    });
  } catch (err) {
    console.error("❌ crearTrayectoria:", err);
    return res.status(500).json({ error: "Error interno al crear trayectoria" });
  }
};

/**
 * ─────────────────────────────────────────────────────────────
 *  GET /trayectoria/mios
 *  Usuario autenticado
 *  Devuelve su trayectoria (por uid)
 * ─────────────────────────────────────────────────────────────
 */
const obtenerMiTrayectoria = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const sql = `
      SELECT
        trajectory_id,
        uid,
        year,
        category,
        title,
        folio,
        file_url,
        storage_path,
        file_name,
        file_type,
        file_size_bytes,
        status,
        submitted_at,
        validated_at,
        rejected_at,
        reviewed_by_uid,
        review_notes,
        created_at,
        updated_at
      FROM trajectory
      WHERE uid = ? AND is_active = 1
      ORDER BY year DESC, created_at DESC
    `;

    const [rows] = await db.query(sql, [uid]);
    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error("❌ obtenerMiTrayectoria:", err);
    return res.status(500).json({ error: "Error al obtener trayectoria" });
  }
};

/**
 * ─────────────────────────────────────────────────────────────
 *  GET /trayectoria
 *  Admin/Moderador: lista global con filtros
 *  Similar a documentos.getAll (filtros y moderador por estado)
 *
 *  Query params opcionales:
 *   - searchField: matricula | correo | curp
 *   - search: texto
 *   - status: pending | validated | rejected
 *   - category: texto (LIKE)
 *   - year: number
 * ─────────────────────────────────────────────────────────────
 */
const getAllTrayectoria = async (req, res) => {
  try {
    const { rol, estado } = req.user || {};
    const { searchField, search, status, category, year } = req.query;

    const validFields = ["matricula", "correo", "curp"];

    const where = [];
    const params = [];

    // Moderador: limita por users.estado (como en docs)
    if (rol === "moderador") {
      where.push("users.estado = ?");
      params.push(estado);
    } else if (rol !== "admin") {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    if (search && String(search).trim() !== "" && validFields.includes(searchField)) {
      where.push(`users.${searchField} LIKE ?`);
      params.push(safeLike(search));
    }

    const st = normalizeStatus(status);
    if (status && !st) {
      return res.status(400).json({ error: "status inválido (usa pending|validated|rejected)" });
    }
    if (st) {
      where.push("ut.status = ?");
      params.push(st);
    }

    if (category && String(category).trim() !== "") {
      where.push("ut.category LIKE ?");
      params.push(safeLike(category));
    }

    if (year !== undefined && year !== null && String(year).trim() !== "") {
      const y = Number(year);
      if (!Number.isFinite(y) || y < 1900 || y > 2100) {
        return res.status(400).json({ error: "year inválido" });
      }
      where.push("ut.year = ?");
      params.push(y);
    }

    const sql = `
      SELECT
        ut.trajectory_id,
        ut.uid,
        users.id AS user_id_internal,
        users.nombre,
        users.apellido_pat,
        users.apellido_mat,
        users.matricula,
        users.correo,
        users.curp,

        ut.year,
        ut.category,
        ut.title,
        ut.folio,
        ut.file_url,
        ut.file_name,
        ut.file_type,
        ut.file_size_bytes,
        ut.storage_path,

        ut.status,
        ut.submitted_at,
        ut.validated_at,
        ut.rejected_at,
        ut.reviewed_by_uid,
        ut.review_notes,
        ut.created_at,
        ut.updated_at
      FROM trajectory ut
      JOIN users ON users.uid = ut.uid
      ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY ut.created_at DESC
    `;

    console.log("🛠 getAllTrayectoria SQL:", sql, params);

    const [rows] = await db.query(sql, params);
    return res.json(Array.isArray(rows) ? rows : []);
  } catch (err) {
    console.error("❌ getAllTrayectoria:", err);
    return res.status(500).json({ error: "Error al obtener trayectorias" });
  }
};

/**
 * ─────────────────────────────────────────────────────────────
 *  PATCH /trayectoria/:trajectoryId/status
 *  Admin/Moderador: cambia status + auditoría
 *  Body:
 *   - status: pending|validated|rejected
 *   - review_notes: opcional
 * ─────────────────────────────────────────────────────────────
 */
const actualizarStatusTrayectoria = async (req, res) => {
  try {
    const { rol } = req.user || {};
    if (!["admin", "moderador"].includes(rol)) {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    const reviewedByUid = req.user?.uid;
    if (!reviewedByUid) return res.status(401).json({ error: "No autenticado" });

    const trajectoryId = Number(req.params.trajectoryId);
    if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
      return res.status(400).json({ error: "trajectoryId inválido" });
    }

    const st = normalizeStatus(req.body?.status);
    if (!st) return res.status(400).json({ error: "status inválido (pending|validated|rejected)" });

    const reviewNotes = req.body?.review_notes;
    const notes = typeof reviewNotes === "string" ? reviewNotes.trim() : null;

    // ✅ Verifica existencia (corregido: era user_trajectory)
    const [exists] = await db.query(
      "SELECT trajectory_id FROM trajectory WHERE trajectory_id = ? LIMIT 1",
      [trajectoryId]
    );
    if (!exists.length) return res.status(404).json({ error: "Registro no encontrado" });

    // Set timestamps según status
    const setValidatedAt = st === "validated" ? "CURRENT_TIMESTAMP" : "NULL";
    const setRejectedAt = st === "rejected" ? "CURRENT_TIMESTAMP" : "NULL";

    const sql = `
      UPDATE trajectory
      SET
        status = ?,
        reviewed_by_uid = ?,
        review_notes = ?,
        validated_at = ${setValidatedAt},
        rejected_at = ${setRejectedAt},
        updated_at = CURRENT_TIMESTAMP
      WHERE trajectory_id = ?
    `;

    await db.query(sql, [st, reviewedByUid, notes, trajectoryId]);

    return res.json({ mensaje: "Status actualizado", trajectory_id: trajectoryId, status: st });
  } catch (err) {
    console.error("❌ actualizarStatusTrayectoria:", err);
    return res.status(500).json({ error: "Error al actualizar status" });
  }
};

module.exports = {
  crearTrayectoria,
  obtenerMiTrayectoria,
  getAllTrayectoria,
  actualizarStatusTrayectoria,
};
