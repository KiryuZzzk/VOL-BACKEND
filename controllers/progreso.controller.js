const db = require("../config/db");

/**
 * Devuelve ambos posibles identificadores del usuario:
 * - firebaseUid: string (Firebase Auth)
 * - dbUserId: number (users.id en MySQL)
 */
function getUserKeys(req) {
  const firebaseUid = String(req.firebaseUser?.uid || "").trim() || null;

  const dbUserIdRaw =
    req.user?.id ?? req.dbUser?.id ?? req.user?.user_id ?? null;

  const dbUserId =
    dbUserIdRaw === null || dbUserIdRaw === undefined || dbUserIdRaw === ""
      ? null
      : Number(dbUserIdRaw);

  return {
    firebaseUid,
    dbUserId: Number.isFinite(dbUserId) ? dbUserId : null,
  };
}

/**
 * 🔥 CLAVE: para progreso usamos UN SOLO user_id consistente.
 * Preferimos firebaseUid (porque tu plataforma ya vive en Firebase Auth),
 * y si no existe, caemos a dbUserId como string.
 */
function getProgressUserId(req) {
  const { firebaseUid, dbUserId } = getUserKeys(req);
  if (firebaseUid) return firebaseUid;
  if (dbUserId) return String(dbUserId);
  return null;
}

function normalizeJsonForDb(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() ? value : null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeActivityId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * GET /progreso/me/programas/:code
 * Devuelve el progreso del usuario para un programa
 */
exports.getMiProgresoPrograma = async (req, res) => {
  const uid = getProgressUserId(req);
  const programCode = String(req.params.code || "").trim().toUpperCase();

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!programCode) return res.status(400).json({ error: "code requerido" });

  try {
    const [rows] = await db.query(
      `
      SELECT
        a.activity_id,
        a.code AS activity_code,
        a.name AS activity_name,
        a.required,
        a.min_score,
        a.is_final_exam,

        COALESCE(uap.status, 'not_started') AS status,
        COALESCE(uap.attempts, 0) AS attempts,
        uap.score,
        uap.data_json,
        uap.started_at,
        uap.completed_at,
        uap.last_seen_at
      FROM program p
      JOIN block b ON b.program_id = p.program_id AND b.is_active = 1
      JOIN module m ON m.block_id = b.block_id AND m.is_active = 1
      JOIN activity a ON a.module_id = m.module_id AND a.is_active = 1
      LEFT JOIN user_activity_progress uap
        ON uap.activity_id = a.activity_id
       AND uap.user_id = ?
      WHERE p.code = ?
        AND p.is_active = 1
      ORDER BY
        b.order_index ASC,
        m.order_index ASC,
        a.order_index ASC
      `,
      [uid, programCode]
    );

    return res.json({
      user_id: uid,
      programCode,
      activities: rows,
    });
  } catch (err) {
    console.error("❌ getMiProgresoPrograma error:", err);
    return res.status(500).json({ error: "Error al obtener progreso" });
  }
};

/**
 * POST /progreso/actividades/:activityId/iniciar
 * Marca actividad como in_progress
 */
exports.iniciarActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, started_at, last_seen_at)
      VALUES (?, ?, 'in_progress', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = IF(status='completed', status, 'in_progress'),
        started_at = COALESCE(started_at, NOW()),
        last_seen_at = NOW()
      `,
      [uid, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ iniciarActividad error:", err);
    return res.status(500).json({ error: "Error al iniciar actividad" });
  }
};

/**
 * POST /progreso/actividades/:activityId/completar
 * body opcional:
 * {
 *   score?: number,
 *   passed?: boolean,     // default true
 *   data_json?: any
 * }
 */
exports.completarActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  const score = normalizeScore(req.body?.score);
  const passed = req.body?.passed ?? true;
  const status = passed ? "completed" : "failed";
  const data_json = normalizeJsonForDb(req.body?.data_json);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, data_json, started_at, completed_at, last_seen_at)
      VALUES (?, ?, ?, 1, ?, ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        attempts = COALESCE(attempts,0) + 1,
        score = COALESCE(VALUES(score), score),
        data_json = COALESCE(VALUES(data_json), data_json),
        completed_at = NOW(),
        last_seen_at = NOW()
      `,
      [uid, activityId, status, score, data_json]
    );

    return res.json({ ok: true, status });
  } catch (err) {
    console.error("❌ completarActividad error:", err);
    return res.status(500).json({ error: "Error al completar actividad" });
  }
};

/**
 * POST /progreso/actividades/:activityId/heartbeat
 * Solo actualiza last_seen_at
 */
exports.heartbeatActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, started_at, last_seen_at)
      VALUES (?, ?, 'in_progress', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        last_seen_at = NOW()
      `,
      [uid, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ heartbeatActividad error:", err);
    return res.status(500).json({ error: "Error heartbeat" });
  }
};

/**
 * ✅ POST /progreso/actividades/:activityId/choose
 * Para activities type="path":
 * body:
 * { choice: "COM" | "VOL" | ... }
 *
 * Hace:
 * 1) valida choice
 * 2) inscribe al usuario al programa elegido (user_program_enrollment)
 * 3) marca la activity como completed guardando data_json con la elección
 */
exports.choosePathActividad = async (req, res) => {
  const uidProgress = getProgressUserId(req);
  const { firebaseUid, dbUserId } = getUserKeys(req);
  const activityId = normalizeActivityId(req.params.activityId);

  const choice = String(req.body?.choice || "").trim().toUpperCase();

  if (!uidProgress) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });
  if (!choice) return res.status(400).json({ error: "choice requerido" });

  // Lista blanca opcional (te protege de enrolls raros)
  const ALLOWED = new Set(["COM", "VOL", "MIG", "RDR", "APS", "TUM", "CAP", "PREV"]);
  if (!ALLOWED.has(choice)) {
    return res.status(400).json({ error: "choice inválido" });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Validar que el programa exista por code (NO hardcodear program_id)
    const [pRows] = await conn.query(
      `
      SELECT program_id, code, is_active
      FROM program
      WHERE code = ?
      LIMIT 1
      `,
      [choice]
    );

    if (!pRows.length) {
      await conn.rollback();
      return res.status(404).json({ error: `Programa no encontrado: ${choice}` });
    }

    const program = pRows[0];
    if (program.is_active === 0) {
      await conn.rollback();
      return res.status(400).json({ error: `Programa inactivo: ${choice}` });
    }

    // 2) Inscribir al usuario
    // Preferencia:
    // - Si tienes dbUserId (users.id), úsalo (porque es lo más "ERP/MySQL").
    // - Si no, usa firebaseUid.
    // - Si no hay ninguno (raro), usa uidProgress.
    const enrollmentUserId =
      (Number.isFinite(dbUserId) && dbUserId) || firebaseUid || uidProgress;

    await conn.query(
      `
      INSERT INTO user_program_enrollment (user_id, program_id, status, enrolled_at)
      VALUES (?, ?, 'enrolled', NOW())
      ON DUPLICATE KEY UPDATE
        status = 'enrolled'
      `,
      [enrollmentUserId, program.program_id]
    );

    // 3) Marcar la actividad PATH como completada y guardar elección en data_json
    const data_json = normalizeJsonForDb({
      completedBy: "path_choice",
      choice,
      enrolledProgramCode: choice,
      enrolledProgramId: program.program_id,
    });

    await conn.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, data_json, started_at, completed_at, last_seen_at)
      VALUES (?, ?, 'completed', 1, NULL, ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = 'completed',
        attempts = COALESCE(attempts,0) + 1,
        data_json = COALESCE(VALUES(data_json), data_json),
        completed_at = NOW(),
        last_seen_at = NOW()
      `,
      [uidProgress, activityId, data_json]
    );

    await conn.commit();

    return res.json({
      ok: true,
      choice,
      enrolledProgramCode: choice,
      enrolledProgramId: program.program_id,
      enrollmentUserId,
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {}
    console.error("❌ choosePathActividad error:", err);
    return res.status(500).json({ error: "Error al elegir camino" });
  } finally {
    conn.release();
  }
};
