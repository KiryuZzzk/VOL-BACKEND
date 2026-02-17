const db = require("../config/db");

// 👇 Importamos el helper del controller de coordinaciones
// OJO: esto requiere que en coordinaciones.controller.js hayas exportado upsertUserCoordinacionAndSync
const { upsertUserCoordinacionAndSync } = require("./coordinaciones.controller");

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
const TUM_CATEGORIES = new Set([normCategory("TUM Cruz Roja Mexicana"), normCategory("TUM externo")]);

/**
 * Asegura que el usuario quede inscrito a SOC (coordinación code=SOC)
 * ✅ AHORA TAMBIÉN: sincroniza enrollments de programas dependientes (@req:coord:SOC)
 */
async function ensureSocEnrollmentAndPrograms(firebaseUid) {
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const result = await upsertUserCoordinacionAndSync(conn, firebaseUid, "SOC", "EN_PROCESO");

    await conn.commit();
    return { ok: true, ...result };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {}
    console.error("⚠️ ensureSocEnrollmentAndPrograms error:", e);
    return { ok: false, reason: "ERROR" };
  } finally {
    conn.release();
  }
}

/**
 * ─────────────────────────────────────────────────────────────
 *  POST /trayectoria
 *  (usuario)
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

    // ✅ Auto-inscripción a SOC + auto-enrollment programas SOC si la categoría es TUM
    let autoEnrollSoc = null;
    const isTum = TUM_CATEGORIES.has(normCategory(category));
    if (isTum) {
      try {
        autoEnrollSoc = await ensureSocEnrollmentAndPrograms(uid);
        console.log("✅ Auto-enroll SOC + programs:", { uid, ...autoEnrollSoc });
      } catch (e) {
        console.error("⚠️ Error auto-enroll SOC+programs (no bloquea trayectoria):", e);
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
 *  (usuario)
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
 *  DELETE /trayectoria/:trajectoryId
 *  (usuario)
 *  Borrado lógico (is_active=0) de SU PROPIO registro
 *  Regla: si está validated => no se puede borrar (para no romper auditoría)
 * ─────────────────────────────────────────────────────────────
 */
const borrarMiTrayectoria = async (req, res) => {
  try {
    const uid = req.user?.uid;
    if (!uid) return res.status(401).json({ error: "No autenticado" });

    const trajectoryId = Number(req.params.trajectoryId);
    if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
      return res.status(400).json({ error: "trajectoryId inválido" });
    }

    // 1) Verifica que exista y sea del usuario
    const [rows] = await db.query(
      `SELECT trajectory_id, status
       FROM trajectory
       WHERE trajectory_id = ? AND uid = ? AND is_active = 1
       LIMIT 1`,
      [trajectoryId, uid]
    );

    if (!rows.length) return res.status(404).json({ error: "Registro no encontrado" });

    const st = String(rows[0].status || "").toLowerCase();
    if (st === "validated") {
      return res.status(409).json({
        error: "No puedes borrar un registro validado. Si necesitas corregirlo, contacta a soporte.",
      });
    }

    // 2) Borrado lógico
    const [result] = await db.query(
      `UPDATE trajectory
       SET is_active = 0, updated_at = CURRENT_TIMESTAMP
       WHERE trajectory_id = ? AND uid = ? AND is_active = 1`,
      [trajectoryId, uid]
    );

    if (!result.affectedRows) return res.status(404).json({ error: "Registro no encontrado" });

    return res.status(204).send();
  } catch (err) {
    console.error("❌ borrarMiTrayectoria:", err);
    return res.status(500).json({ error: "Error al borrar trayectoria" });
  }
};

/**
 * ─────────────────────────────────────────────────────────────
 *  GET /trayectoria
 *  (admin/mod) lista global con filtros (para revisión)
 *  Query params:
 *    - searchField: matricula|correo|curp
 *    - search: string
 *    - status: pending|validated|rejected
 *    - category: string (LIKE)
 *    - year: number
 * ─────────────────────────────────────────────────────────────
 */
const getAllTrayectoria = async (req, res) => {
  try {
    const { rol } = req.user || {};
    const { searchField, search, status, category, year } = req.query;

    const validFields = ["matricula", "correo", "curp"];

    const where = [];
    const params = [];

    // Permisos
    if (rol === "moderador") {
      // Moderador: restringe por scopes (estado/programa/grupo) via enrollment
      where.push(`
EXISTS (
  SELECT 1
  FROM user_program_enrollment upe
  JOIN moderator_scopes ms
    ON ms.moderator_uid = ?
   AND ms.is_active = 1
   AND (ms.estado IS NULL OR ms.estado COLLATE utf8mb4_unicode_ci = users.estado COLLATE utf8mb4_unicode_ci)
   AND (ms.program_id IS NULL OR ms.program_id = upe.program_id)
   AND (ms.group_code IS NULL OR ms.group_code COLLATE utf8mb4_unicode_ci = upe.group_code COLLATE utf8mb4_unicode_ci)
  WHERE upe.user_id COLLATE utf8mb4_unicode_ci = users.uid COLLATE utf8mb4_unicode_ci
)
`);
      params.push(req.user?.uid);
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

    // Oculta eliminados
    where.push("ut.is_active = 1");

    // 👇 Collation-safe join (por si users.uid y trajectory.uid traen collations distintas)
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
      JOIN users
        ON users.uid COLLATE utf8mb4_unicode_ci = ut.uid COLLATE utf8mb4_unicode_ci
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
 *  GET /trayectoria/:trajectoryId
 *  (admin/mod) ver detalle puntual
 * ─────────────────────────────────────────────────────────────
 */
const obtenerTrayectoriaPorIdAdmin = async (req, res) => {
  try {
    const { rol } = req.user || {};
    if (!["admin", "moderador"].includes(rol)) {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    const trajectoryId = Number(req.params.trajectoryId);
    if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
      return res.status(400).json({ error: "trajectoryId inválido" });
    }

    const where = ["ut.trajectory_id = ?", "ut.is_active = 1"];
    const params = [trajectoryId];

    if (rol === "moderador") {
      where.push(`
EXISTS (
  SELECT 1
  FROM user_program_enrollment upe
  JOIN moderator_scopes ms
    ON ms.moderator_uid = ?
   AND ms.is_active = 1
   AND (ms.estado IS NULL OR ms.estado COLLATE utf8mb4_unicode_ci = users.estado COLLATE utf8mb4_unicode_ci)
   AND (ms.program_id IS NULL OR ms.program_id = upe.program_id)
   AND (ms.group_code IS NULL OR ms.group_code COLLATE utf8mb4_unicode_ci = upe.group_code COLLATE utf8mb4_unicode_ci)
  WHERE upe.user_id COLLATE utf8mb4_unicode_ci = users.uid COLLATE utf8mb4_unicode_ci
)
`);
      params.push(req.user?.uid);
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
      JOIN users
        ON users.uid COLLATE utf8mb4_unicode_ci = ut.uid COLLATE utf8mb4_unicode_ci
      WHERE ${where.join(" AND ")}
      LIMIT 1
    `;

    const [rows] = await db.query(sql, params);
    if (!rows.length) return res.status(404).json({ error: "Registro no encontrado" });

    return res.json(rows[0]);
  } catch (err) {
    console.error("❌ obtenerTrayectoriaPorIdAdmin:", err);
    return res.status(500).json({ error: "Error al obtener trayectoria" });
  }
};

/**
 * ─────────────────────────────────────────────────────────────
 *  PATCH /trayectoria/:trajectoryId/status
 *  (admin/mod) cambia status + auditoría
 *  body: { status: pending|validated|rejected, review_notes?: string }
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

    // Moderador: solo puede tocar usuarios de su estado
    const where = ["ut.trajectory_id = ?"];
    const params = [trajectoryId];

    if (rol === "moderador") {
      where.push(`
EXISTS (
  SELECT 1
  FROM user_program_enrollment upe
  JOIN moderator_scopes ms
    ON ms.moderator_uid = ?
   AND ms.is_active = 1
   AND (ms.estado IS NULL OR ms.estado COLLATE utf8mb4_unicode_ci = users.estado COLLATE utf8mb4_unicode_ci)
   AND (ms.program_id IS NULL OR ms.program_id = upe.program_id)
   AND (ms.group_code IS NULL OR ms.group_code COLLATE utf8mb4_unicode_ci = upe.group_code COLLATE utf8mb4_unicode_ci)
  WHERE upe.user_id COLLATE utf8mb4_unicode_ci = users.uid COLLATE utf8mb4_unicode_ci
)
`);
      params.push(req.user?.uid);
    }

    const [exists] = await db.query(
      `
      SELECT ut.trajectory_id
      FROM trajectory ut
      JOIN users
        ON users.uid COLLATE utf8mb4_unicode_ci = ut.uid COLLATE utf8mb4_unicode_ci
      WHERE ${where.join(" AND ")}
      LIMIT 1
      `,
      params
    );

    if (!exists.length) return res.status(404).json({ error: "Registro no encontrado" });

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

    return res.json({ ok: true, mensaje: "Status actualizado", trajectory_id: trajectoryId, status: st });
  } catch (err) {
    console.error("❌ actualizarStatusTrayectoria:", err);
    return res.status(500).json({ error: "Error al actualizar status" });
  }
};

/**
 * ─────────────────────────────────────────────────────────────
 *  PATCH /trayectoria/estado
 *  (admin/mod) versión "tipo documentos" (por body)
 *  body: { trajectory_id, status, review_notes? }
 *  ✅ Esto existe para que el front pueda reutilizar patrón /documentos/estado
 * ─────────────────────────────────────────────────────────────
 */
const actualizarEstadoTrayectoria = async (req, res) => {
  try {
    const { rol } = req.user || {};
    if (!["admin", "moderador"].includes(rol)) {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    const trajectoryId = Number(req.body?.trajectory_id);
    if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
      return res.status(400).json({ error: "trajectory_id inválido" });
    }

    // Reusa la misma lógica que el endpoint paramétrico
    req.params.trajectoryId = String(trajectoryId);
    return actualizarStatusTrayectoria(req, res);
  } catch (err) {
    console.error("❌ actualizarEstadoTrayectoria:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};

module.exports = {
  // usuario
  crearTrayectoria,
  obtenerMiTrayectoria,
  borrarMiTrayectoria,

  // admin/mod (revisión)
  getAllTrayectoria,
  obtenerTrayectoriaPorIdAdmin,
  actualizarStatusTrayectoria,
  actualizarEstadoTrayectoria,
};
