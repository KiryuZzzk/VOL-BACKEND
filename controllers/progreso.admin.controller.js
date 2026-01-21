const db = require("../config/db");

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function safeStr(v) {
  return v === null || v === undefined ? "" : String(v);
}

function safeUpper(v) {
  return safeStr(v).trim().toUpperCase();
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

/**
 * Acepta:
 * - users.id (uuid interno)
 * - users.uid (firebase uid)
 * Devuelve siempre firebase uid (users.uid)
 */
async function resolveFirebaseUidFromUserId(connOrDb, userIdOrUid) {
  const v = safeStr(userIdOrUid).trim();
  if (!v) return null;

  // 1) intenta por id interno
  let [rows] = await connOrDb.query(
    "SELECT uid FROM users WHERE id = ? LIMIT 1",
    [v]
  );
  if (rows?.[0]?.uid) return rows[0].uid;

  // 2) fallback por uid
  [rows] = await connOrDb.query(
    "SELECT uid FROM users WHERE uid = ? LIMIT 1",
    [v]
  );
  if (rows?.[0]?.uid) return rows[0].uid;

  return null;
}

// ─────────────────────────────────────────────────────────────
// GET Programas inscritos del usuario
// ─────────────────────────────────────────────────────────────
exports.getProgramasUsuario = async (req, res) => {
  try {
    const userId = safeStr(req.params.userId).trim();
    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });

    const uid = await resolveFirebaseUidFromUserId(db, userId);
    if (!uid) return res.status(404).json({ error: "Usuario no encontrado" });

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
      [uid]
    );

    return res.json({ ok: true, userId, uid, userUid: uid, programs: rows });
  } catch (err) {
    console.error("❌ getProgramasUsuario:", err?.sqlMessage || err);
    return res.status(500).json({ error: "Error al obtener programas" });
  }
};

// ─────────────────────────────────────────────────────────────
// GET Vista admin del programa (actividades + progreso + docs)
// ─────────────────────────────────────────────────────────────
exports.getAdminProgramView = async (req, res) => {
  try {
    const userId = safeStr(req.params.userId).trim();
    const programCode = safeUpper(req.params.programCode);

    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });
    if (!programCode) return res.status(400).json({ error: "Parámetro programCode inválido" });

    const uid = await resolveFirebaseUidFromUserId(db, userId);
    if (!uid) return res.status(404).json({ error: "Usuario no encontrado" });

    // Traemos TODO el catálogo del programa (bloques/módulos/actividades)
    // + progreso por actividad (uap)
    // + evidencia (uad) si existe
    const [rows] = await db.query(
      `
      SELECT
        p.program_id,
        p.code AS program_code,
        p.name AS program_name,

        b.block_id,
        b.code AS block_code,
        b.name AS block_name,
        b.order_index AS block_order,

        m.module_id,
        m.code AS module_code,
        m.name AS module_name,
        m.order_index AS module_order,

        a.activity_id,
        a.code AS activity_code,
        a.title AS activity_title,
        a.type AS activity_type,
        a.order_index AS activity_order,
        a.required AS activity_required,

        COALESCE(uap.status, 'not_started') AS status,
        COALESCE(uap.attempts, 0) AS attempts,
        uap.score,
        uap.started_at,
        uap.completed_at,
        uap.last_seen_at,

        uad.id AS doc_id,
        uad.status AS doc_status,
        uad.document_title,
        uad.description AS doc_description,
        uad.file_url,
        uad.file_name,
        uad.file_type,
        uad.file_size,
        uad.storage_path,
        uad.user_note,
        uad.review_note,
        uad.reviewed_by,
        uad.reviewed_at,
        uad.created_at AS doc_created_at,
        uad.updated_at AS doc_updated_at

      FROM program p
      JOIN block b    ON b.program_id = p.program_id AND b.is_active = 1
      JOIN module m   ON m.block_id = b.block_id AND m.is_active = 1
      JOIN activity a ON a.module_id = m.module_id AND a.is_active = 1

      LEFT JOIN user_activity_progress uap
        ON uap.activity_id = a.activity_id
       AND uap.user_id = ?

      LEFT JOIN user_activity_docs uad
        ON uad.activity_id = a.activity_id
       AND uad.user_id = ?

      WHERE p.code = ?
        AND p.is_active = 1
      ORDER BY b.order_index ASC, m.order_index ASC, a.order_index ASC
      `,
      [uid, uid, programCode]
    );

    if (!rows || rows.length === 0) {
      // puede ser que el programa no exista o no tenga catálogo activo
      return res.status(404).json({ error: "Programa no encontrado o sin actividades" });
    }

    const program = {
      program_id: rows[0].program_id,
      code: rows[0].program_code,
      name: rows[0].program_name,
    };

    // Construimos activities con doc anidado (solo si existe doc_id)
    const activities = rows.map((r) => {
      const hasDoc = r.doc_id !== null && r.doc_id !== undefined;

      const doc = hasDoc
        ? {
            doc_id: r.doc_id,
            doc_status: r.doc_status,
            document_title: r.document_title,
            description: r.doc_description,
            file_url: r.file_url,
            file_name: r.file_name,
            file_type: r.file_type,
            file_size: r.file_size,
            storage_path: r.storage_path,
            user_note: r.user_note,
            review_note: r.review_note,
            reviewed_by: r.reviewed_by,
            reviewed_at: r.reviewed_at,
            created_at: r.doc_created_at,
            updated_at: r.doc_updated_at,
          }
        : null;

      return {
        activity_id: r.activity_id,
        activity_code: r.activity_code,
        activity_title: r.activity_title,
        activity_type: r.activity_type, // 'upload'
        activity_order: r.activity_order,
        required: !!r.activity_required,

        block_id: r.block_id,
        block_code: r.block_code,
        block_name: r.block_name,
        block_order: r.block_order,

        module_id: r.module_id,
        module_code: r.module_code,
        module_name: r.module_name,
        module_order: r.module_order,

        status: r.status,
        attempts: r.attempts,
        score: r.score,
        started_at: r.started_at,
        completed_at: r.completed_at,
        last_seen_at: r.last_seen_at,

        doc,
      };
    });

    const total = activities.length;
    const completed = activities.filter((a) => a.status === "completed").length;
    const pct = total ? Math.round((completed / total) * 100) : 0;

    return res.json({
      ok: true,
      userId,
      uid,
      userUid: uid,
      program,
      summary: {
        totalActivities: total,
        completedActivities: completed,
        progressPct: pct,
      },
      activities,
    });
  } catch (err) {
console.error("❌ getAdminProgramView:", {
  message: err?.message,
  sqlMessage: err?.sqlMessage,
  code: err?.code,
  errno: err?.errno,
  sqlState: err?.sqlState,
  sql: err?.sql,
});

return res.status(500).json({
  error: "Error al obtener vista del programa",
  debug: {
    code: err?.code,
    errno: err?.errno,
    sqlMessage: err?.sqlMessage,
  },
});

  }
};

// ─────────────────────────────────────────────────────────────
// PATCH Review doc (approve/reject + review_note + score opcional)
// ─────────────────────────────────────────────────────────────
exports.reviewDocUsuario = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const docId = toInt(req.params.docId);
    if (!Number.isFinite(docId)) return res.status(400).json({ error: "docId inválido" });

    const { status, score, review_note } = req.body || {};
    const newStatus = safeStr(status).trim(); // 'approved' | 'rejected' | 'submitted'
    const newScore = normalizeScore(score);
    const note = review_note === undefined ? null : safeStr(review_note);

    if (!["approved", "rejected", "submitted"].includes(newStatus)) {
      return res.status(400).json({ error: "status inválido (submitted|approved|rejected)" });
    }

    const reviewerUid = req?.firebaseUser?.uid || null;

    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT id, user_id, activity_id FROM user_activity_docs WHERE id = ? LIMIT 1",
      [docId]
    );
    const docRow = rows?.[0];
    if (!docRow) {
      await conn.rollback();
      return res.status(404).json({ error: "Documento no encontrado" });
    }

    const userUid = docRow.user_id; // YA es firebase uid (por tu esquema)
    const activityId = docRow.activity_id;

    // 1) update doc
    await conn.query(
      `
      UPDATE user_activity_docs
      SET
        status = ?,
        reviewed_by = ?,
        reviewed_at = NOW(),
        review_note = ?
      WHERE id = ?
      `,
      [newStatus, reviewerUid, note, docId]
    );

    // 2) sincronizar progreso según dictamen
    if (newStatus === "approved") {
      await conn.query(
        `
        INSERT INTO user_activity_progress
          (user_id, activity_id, status, score, attempts, started_at, completed_at, last_seen_at)
        VALUES
          (?, ?, 'completed', ?, 1, NOW(), NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = 'completed',
          score = COALESCE(VALUES(score), score),
          completed_at = COALESCE(completed_at, NOW()),
          last_seen_at = NOW()
        `,
        [userUid, activityId, newScore]
      );
    } else if (newStatus === "rejected") {
      await conn.query(
        `
        INSERT INTO user_activity_progress
          (user_id, activity_id, status, score, attempts, started_at, last_seen_at)
        VALUES
          (?, ?, 'in_progress', NULL, 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = 'in_progress',
          last_seen_at = NOW()
        `,
        [userUid, activityId]
      );
    } else {
      // submitted: no tocamos progreso (o podrías poner in_progress si quieres)
      await conn.query(
        `
        INSERT INTO user_activity_progress
          (user_id, activity_id, status, attempts, started_at, last_seen_at)
        VALUES
          (?, ?, 'in_progress', 1, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = IF(status='not_started','in_progress',status),
          last_seen_at = NOW()
        `,
        [userUid, activityId]
      );
    }

    await conn.commit();

    const [after] = await conn.query(
      `
      SELECT
        uad.*,
        a.code AS activity_code,
        a.title AS activity_title
      FROM user_activity_docs uad
      JOIN activity a ON a.activity_id = uad.activity_id
      WHERE uad.id = ? LIMIT 1
      `,
      [docId]
    );

    return res.json({
      ok: true,
      docId,
      uid: userUid,
      userUid,
      doc: after?.[0] || null,
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {}
    console.error("❌ reviewDocUsuario:", err?.sqlMessage || err);
    return res.status(500).json({ error: "Error al calificar evidencia" });
  } finally {
    conn.release();
  }
};
