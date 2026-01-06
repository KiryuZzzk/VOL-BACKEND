const db = require("../config/db");

/**
 * Devuelve ambos posibles identificadores del usuario:
 * - firebaseUid: string (Firebase Auth)
 * - dbUserId: number (users.id en MySQL)
 */
function getUserKeys(req) {
  const firebaseUid = String(req.firebaseUser?.uid || "").trim();

  const dbUserIdRaw =
    req.user?.id ?? req.dbUser?.id ?? req.user?.user_id ?? null;

  const dbUserId =
    dbUserIdRaw === null || dbUserIdRaw === undefined || dbUserIdRaw === ""
      ? null
      : Number(dbUserIdRaw);

  return {
    firebaseUid: firebaseUid || null,
    dbUserId: Number.isFinite(dbUserId) ? dbUserId : null,
  };
}

/**
 * Para ESCRITURAS (insert/update) elegimos 1 solo ID, para no duplicar filas.
 * Preferimos el ID numérico de BD si existe, si no usamos Firebase UID.
 */
function getWriteUserId(req) {
  const { dbUserId, firebaseUid } = getUserKeys(req);
  return dbUserId || firebaseUid || null;
}

/**
 * GET /progreso/me/programas/:code
 * Devuelve el progreso del usuario para un programa
 */
exports.getMiProgresoPrograma = async (req, res) => {
  const { code } = req.params;
  const { firebaseUid, dbUserId } = getUserKeys(req);

  if (!firebaseUid && !dbUserId) {
    return res.status(401).json({ error: "No autenticado" });
  }
  if (!code) return res.status(400).json({ error: "code requerido" });

  try {
    // Condición user_id: soporta num o uid
    const userWhere = [];
    const userParams = [];

    if (dbUserId) {
      userWhere.push("uap.user_id = ?");
      userParams.push(dbUserId);
    }
    if (firebaseUid) {
      userWhere.push("uap.user_id = ?");
      userParams.push(firebaseUid);
    }

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
        COALESCE(uap.score, 0) AS score,
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
       AND (${userWhere.join(" OR ")})
      WHERE p.code = ?
        AND p.is_active = 1
      ORDER BY
        b.order_index ASC,
        m.order_index ASC,
        a.order_index ASC
      `,
      [...userParams, code]
    );

    return res.json({
      programCode: code,
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
  const { activityId } = req.params;
  const userId = getWriteUserId(req);

  if (!userId) return res.status(401).json({ error: "No autenticado" });
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
      [userId, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ iniciarActividad error:", err);
    return res.status(500).json({ error: "Error al iniciar actividad" });
  }
};

/**
 * POST /progreso/actividades/:activityId/completar
 * Marca actividad como completed (y guarda score si viene)
 */
exports.completarActividad = async (req, res) => {
  const { activityId } = req.params;
  const userId = getWriteUserId(req);

  const score = req.body?.score ?? null;
  const data_json = req.body?.data_json ?? null;

  if (!userId) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, data_json, started_at, completed_at, last_seen_at)
      VALUES (?, ?, 'completed', 1, COALESCE(?, 0), ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = 'completed',
        attempts = COALESCE(attempts,0) + 1,
        score = COALESCE(?, score),
        data_json = COALESCE(?, data_json),
        completed_at = NOW(),
        last_seen_at = NOW()
      `,
      [userId, activityId, score, data_json, score, data_json]
    );

    return res.json({ ok: true });
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
  const { activityId } = req.params;
  const userId = getWriteUserId(req);

  if (!userId) return res.status(401).json({ error: "No autenticado" });
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
      [userId, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ heartbeatActividad error:", err);
    return res.status(500).json({ error: "Error heartbeat" });
  }
};
