const db = require("../config/db");

/**
 * Helper para obtener el UID del usuario autenticado
 * (ajústalo si tu middleware usa otro campo)
 */
const getUid = (req) =>
  req.firebaseUser?.uid ||
  req.user?.uid ||
  req.user?.user_id ||
  null;

/**
 * GET /progreso/me/programas/:code
 * Devuelve el progreso del usuario para un programa
 */
exports.getMiProgresoPrograma = async (req, res) => {
  const uid = String(getUid(req) || "").trim();
  const programCode = String(req.params.code || "").trim().toUpperCase();

  if (!uid) {
    return res.status(401).json({ error: "Usuario no autenticado" });
  }

  try {
    const sql = `
      SELECT
        a.activity_id,
        a.code AS activity_code,
        a.name AS activity_name,
        a.required,
        a.min_score,
        a.is_final_exam,

        COALESCE(uap.status, 'not_started') AS status,
        uap.attempts,
        uap.score,
        uap.started_at,
        uap.completed_at,
        uap.last_seen_at
      FROM program p
      JOIN block b ON b.program_id = p.program_id
      JOIN module m ON m.block_id = b.block_id
      JOIN activity a ON a.module_id = m.module_id
      LEFT JOIN user_activity_progress uap
        ON uap.activity_id = a.activity_id
        AND uap.user_id = ?
      WHERE p.code = ?
      ORDER BY b.order_index, m.order_index, a.order_index
    `;

    const [rows] = await db.query(sql, [uid, programCode]);

    return res.json({
      user_id: uid,
      program_code: programCode,
      activities: rows,
    });
  } catch (err) {
    console.error("❌ getMiProgresoPrograma error:", err);
    return res.status(500).json({ error: "Error al obtener progreso" });
  }
};

/**
 * POST /progreso/actividades/:activityId/iniciar
 */
exports.iniciarActividad = async (req, res) => {
  const uid = String(getUid(req) || "").trim();
  const activityId = Number(req.params.activityId);

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
 * POST /progreso/actividades/:activityId/heartbeat
 */
exports.heartbeatActividad = async (req, res) => {
  const uid = String(getUid(req) || "").trim();
  const activityId = Number(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, last_seen_at)
      VALUES (?, ?, 'in_progress', NOW())
      ON DUPLICATE KEY UPDATE
        last_seen_at = NOW()
      `,
      [uid, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ heartbeatActividad error:", err);
    return res.status(500).json({ error: "Error al guardar heartbeat" });
  }
};

/**
 * POST /progreso/actividades/:activityId/completar
 */
exports.completarActividad = async (req, res) => {
  const uid = String(getUid(req) || "").trim();
  const activityId = Number(req.params.activityId);
  const score =
    req.body?.score === undefined ? null : Number(req.body.score);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, started_at, completed_at, last_seen_at)
      VALUES (?, ?, 'completed', 1, ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = 'completed',
        attempts = attempts + 1,
        score = ?,
        completed_at = NOW(),
        last_seen_at = NOW()
      `,
      [uid, activityId, score, score]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ completarActividad error:", err);
    return res.status(500).json({ error: "Error al completar actividad" });
  }
};
