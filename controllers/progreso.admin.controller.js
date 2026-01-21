const db = require("../config/db");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function safeUpper(s) {
  return String(s || "").trim().toUpperCase();
}

function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

async function resolveFirebaseUidFromUserId(connOrDb, userId) {
  const id = String(userId || "").trim();
  if (!id) return null;

  const [rows] = await connOrDb.query(
    "SELECT uid FROM users WHERE id = ? LIMIT 1",
    [id]
  );

  return rows?.[0]?.uid || null;
}

// ─────────────────────────────────────────────────────────────
// GET Programas en los que está inscrito (por userId interno)
// ─────────────────────────────────────────────────────────────
exports.getProgramasUsuario = async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });

    const userUid = await resolveFirebaseUidFromUserId(db, userId);
    if (!userUid) return res.status(404).json({ error: "Usuario no encontrado" });

    const [rows] = await db.query(
      `
      SELECT
        p.program_id,
        p.code,
        p.name,
        upe.status,
        upe.enrolled_at,
        upe.completed_at
      FROM user_program_enrollment upe
      JOIN program p ON p.program_id = upe.program_id
      WHERE upe.user_id = ?
      ORDER BY upe.enrolled_at DESC
      `,
      [userUid]
    );

    return res.json({ ok: true, userId, userUid, programs: rows });
  } catch (err) {
    console.error("❌ getProgramasUsuario:", err?.sqlMessage || err);
    return res.status(500).json({ error: "Error al obtener programas" });
  }
};

// ─────────────────────────────────────────────────────────────
// GET Progreso por programa (por userId interno, usa uid)
// ─────────────────────────────────────────────────────────────
exports.getProgresoProgramaUsuario = async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const programCode = safeUpper(req.params.programCode);

    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });
    if (!programCode) return res.status(400).json({ error: "programCode inválido" });

    const userUid = await resolveFirebaseUidFromUserId(db, userId);
    if (!userUid) return res.status(404).json({ error: "Usuario no encontrado" });

    const [rows] = await db.query(
      `
      SELECT
        p.code AS program_code,
        p.name AS program_name,
        b.code AS block_code,
        m.code AS module_code,
        a.activity_id,
        a.code AS activity_code,
        a.name AS activity_name,
        a.type AS activity_type,
        a.required,
        a.min_score,

        COALESCE(uap.status, 'not_started') AS status,
        COALESCE(uap.attempts, 0) AS attempts,
        uap.score,
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
      ORDER BY b.order_index ASC, m.order_index ASC, a.order_index ASC
      `,
      [userUid, programCode]
    );

    const total = rows.length;
    const completed = rows.filter((x) => x.status === "completed").length;

    return res.json({
      ok: true,
      userId,
      userUid,
      programCode,
      summary: {
        totalActivities: total,
        completedActivities: completed,
        progressPct: total ? Math.round((completed / total) * 100) : 0,
      },
      activities: rows,
    });
  } catch (err) {
    console.error("❌ getProgresoProgramaUsuario:", err?.sqlMessage || err);
    return res.status(500).json({ error: "Error al obtener progreso" });
  }
};

// ─────────────────────────────────────────────────────────────
// GET Evidencias (user_activity_docs) + score/status de progress
// ─────────────────────────────────────────────────────────────
exports.getDocsUsuario = async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const programCode = safeUpper(req.query.programCode);

    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });

    const userUid = await resolveFirebaseUidFromUserId(db, userId);
    if (!userUid) return res.status(404).json({ error: "Usuario no encontrado" });

    const params = [userUid];
    let whereProgram = "";
    if (programCode) {
      whereProgram = " AND p.code = ? ";
      params.push(programCode);
    }

    const [rows] = await db.query(
      `
      SELECT
        uad.id AS doc_id,
        uad.user_id,
        uad.activity_id,
        uad.program_code,
        uad.block_code,
        uad.module_code,
        uad.document_title,
        uad.description,
        uad.file_url,
        uad.file_name,
        uad.file_type,
        uad.file_size,
        uad.storage_path,
        uad.user_note,
        uad.status AS doc_status,
        uad.reviewed_by,
        uad.reviewed_at,
        uad.review_note,
        uad.created_at,
        uad.updated_at,

        a.code AS activity_code,
        a.name AS activity_name,
        a.type AS activity_type,

        COALESCE(uap.status, 'not_started') AS progress_status,
        uap.score AS progress_score
      FROM user_activity_docs uad
      JOIN activity a ON a.activity_id = uad.activity_id
      JOIN module m ON m.module_id = a.module_id
      JOIN block b ON b.block_id = m.block_id
      JOIN program p ON p.program_id = b.program_id
      LEFT JOIN user_activity_progress uap
        ON uap.user_id = uad.user_id
       AND uap.activity_id = uad.activity_id
      WHERE uad.user_id = ?
      ${whereProgram}
      ORDER BY uad.updated_at DESC
      `,
      params
    );

    return res.json({ ok: true, userId, userUid, docs: rows });
  } catch (err) {
    console.error("❌ getDocsUsuario:", err?.sqlMessage || err);
    return res.status(500).json({ error: "Error al obtener evidencias" });
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH Review doc (solo docs, no otras actividades)
// - actualiza user_activity_docs
// - actualiza user_activity_progress para esa activity_id
// ─────────────────────────────────────────────────────────────
exports.reviewDocUsuario = async (req, res) => {
  const userId = String(req.params.userId || "").trim();
  const docId = toInt(req.params.docId);

  if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });
  if (!Number.isFinite(docId) || docId <= 0) return res.status(400).json({ error: "docId inválido" });

  const status = String(req.body?.status || "").trim().toLowerCase();
  const reviewNote = req.body?.review_note ?? null;
  const score = normalizeScore(req.body?.score);

  const ALLOWED = new Set(["submitted", "approved", "rejected"]);
  if (!ALLOWED.has(status)) return res.status(400).json({ error: "status inválido" });

  const reviewerUid = String(req.user?.uid || "").trim() || null;

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const userUid = await resolveFirebaseUidFromUserId(conn, userId);
    if (!userUid) {
      await conn.rollback();
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    // valida doc pertenece al uid
    const [rows] = await conn.query(
      `SELECT id, user_id, activity_id FROM user_activity_docs WHERE id = ? AND user_id = ? LIMIT 1`,
      [docId, userUid]
    );
    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({ error: "Evidencia no encontrada para ese usuario" });
    }

    const activityId = rows[0].activity_id;

    // update docs
    await conn.query(
      `
      UPDATE user_activity_docs
      SET
        status = ?,
        reviewed_by = ?,
        reviewed_at = NOW(),
        review_note = ?,
        updated_at = NOW()
      WHERE id = ?
      `,
      [status, reviewerUid, reviewNote, docId]
    );

    // map status docs -> progress status
    const nextProgressStatus =
      status === "approved" ? "completed" : status === "rejected" ? "failed" : "in_progress";

    await conn.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, started_at, completed_at, last_seen_at)
      VALUES
        (?, ?, ?, 1, ?, NOW(), ?, NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        score = COALESCE(VALUES(score), score),
        completed_at = COALESCE(VALUES(completed_at), completed_at),
        last_seen_at = NOW()
      `,
      [
        userUid,
        activityId,
        nextProgressStatus,
        score,
        nextProgressStatus === "completed" ? new Date() : null,
      ]
    );

    await conn.commit();

    const [after] = await conn.query("SELECT * FROM user_activity_docs WHERE id = ? LIMIT 1", [docId]);
    return res.json({ ok: true, userId, userUid, doc: after?.[0] || null });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error("❌ reviewDocUsuario:", err?.sqlMessage || err);
    return res.status(500).json({ error: "Error al calificar evidencia" });
  } finally {
    conn.release();
  }
};
