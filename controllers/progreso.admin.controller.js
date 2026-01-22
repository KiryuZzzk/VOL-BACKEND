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

// Resuelve UID (firebase uid) a partir de userId (puede ser users.id o users.uid)
async function resolveFirebaseUidFromUserId(connOrDb, userId) {
  const v = safeStr(userId).trim();
  if (!v) return null;

  // 1) intenta por id interno
  let [rows] = await connOrDb.query("SELECT uid FROM users WHERE id = ? LIMIT 1", [v]);
  if (rows?.[0]?.uid) return rows[0].uid;

  // 2) fallback por uid
  [rows] = await connOrDb.query("SELECT uid FROM users WHERE uid = ? LIMIT 1", [v]);
  if (rows?.[0]?.uid) return rows[0].uid;

  return null;
}

// ─────────────────────────────────────────────────────────────
// GET: Programas inscritos del usuario (ADMIN)
// GET /progreso/admin/users/:userId/programas
// ─────────────────────────────────────────────────────────────
exports.getProgramasUsuario = async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });

    const uid = await resolveFirebaseUidFromUserId(db, userId);
    if (!uid) return res.status(404).json({ error: "Usuario no encontrado" });

    const [rows] = await db.query(
      `
      SELECT
        p.program_id,
        p.code,
        p.name,
        upe.status AS enrollment_status,
        upe.enrolled_at,
        upe.completed_at
      FROM user_program_enrollment upe
      JOIN program p ON p.program_id = upe.program_id
      WHERE upe.user_id = ?
      ORDER BY p.name ASC
      `,
      [uid]
    );

    return res.json({
      ok: true,
      userId,
      uid,
      programs: rows || [],
    });
  } catch (err) {
    console.error("❌ getProgramasUsuario:", {
      message: err?.message,
      sqlMessage: err?.sqlMessage,
      code: err?.code,
      errno: err?.errno,
      sqlState: err?.sqlState,
      sql: err?.sql,
    });

    return res.status(500).json({
      error: "Error al obtener programas del usuario",
      debug: {
        code: err?.code,
        errno: err?.errno,
        sqlMessage: err?.sqlMessage,
      },
    });
  }
};

// ─────────────────────────────────────────────────────────────
// GET: Vista completa del programa (ADMIN)
// GET /progreso/admin/users/:userId/programas/:programCode
// ─────────────────────────────────────────────────────────────
exports.getAdminProgramView = async (req, res) => {
  try {
    const userId = String(req.params.userId || "").trim();
    const programCode = String(req.params.programCode || "").trim().toUpperCase();

    if (!userId) return res.status(400).json({ error: "Parámetro userId inválido" });
    if (!programCode) return res.status(400).json({ error: "Parámetro programCode inválido" });

    const uid = await resolveFirebaseUidFromUserId(db, userId);
    if (!uid) return res.status(404).json({ error: "Usuario no encontrado" });

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
        a.name AS activity_title,
        a.type AS activity_type,
        a.order_index AS activity_order,
        a.required AS activity_required,
        a.min_score AS activity_min_score,

        COALESCE(uap.status, 'not_started') AS status,
        COALESCE(uap.attempts, 0) AS attempts,
        uap.score,
        uap.started_at,
        uap.completed_at,
        uap.last_seen_at,

        -- Docs (upload)
        uad.id AS doc_id,
        uad.status AS doc_status,
        uad.document_title,
        uad.description AS doc_description,
        uad.file_url,
        uad.file_name,
        uad.file_type,
        uad.file_size,
        uad.storage_path,

        -- Requests (solicitud)
        uar.request_id,
        uar.status AS request_status,
        uar.request_key,
        uar.request_title,
        uar.user_comment AS request_user_comment,
        uar.score AS request_score,
        uar.review_note AS request_review_note,
        uar.reviewed_by AS request_reviewed_by,
        uar.reviewed_at AS request_reviewed_at,
        uar.created_at AS request_created_at,
        uar.updated_at AS request_updated_at,

        -- Remaining doc fields
        uad.user_note,
        uad.review_note,
        uad.reviewed_by,
        uad.reviewed_at,
        uad.created_at AS doc_created_at,
        uad.updated_at AS doc_updated_at

      FROM program p
      JOIN block b ON b.program_id = p.program_id AND b.is_active = 1
      JOIN module m ON m.block_id = b.block_id AND m.is_active = 1
      JOIN activity a ON a.module_id = m.module_id AND a.is_active = 1

      LEFT JOIN user_activity_progress uap
        ON uap.activity_id = a.activity_id
       AND uap.user_id = ?

      LEFT JOIN user_activity_docs uad
        ON uad.activity_id = a.activity_id
       AND uad.user_id = ?

      LEFT JOIN user_activity_requests uar
        ON uar.activity_id = a.activity_id
       AND uar.user_id = ?

      WHERE p.code = ?
        AND p.is_active = 1

      ORDER BY b.order_index ASC, m.order_index ASC, a.order_index ASC
      `,
      [uid, uid, uid, programCode]
    );

    if (!rows || rows.length === 0) {
      return res.status(404).json({ error: "Programa no encontrado o sin actividades" });
    }

    const program = {
      program_id: rows[0].program_id,
      code: rows[0].program_code,
      name: rows[0].program_name,
    };

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

      const hasRequest = r.request_id !== null && r.request_id !== undefined;

      const request = hasRequest
        ? {
            request_id: r.request_id,
            status: r.request_status,
            request_key: r.request_key,
            request_title: r.request_title,
            user_comment: r.request_user_comment,
            score: r.request_score,
            review_note: r.request_review_note,
            reviewed_by: r.request_reviewed_by,
            reviewed_at: r.request_reviewed_at,
            created_at: r.request_created_at,
            updated_at: r.request_updated_at,
          }
        : null;

      return {
        activity_id: r.activity_id,
        activity_code: r.activity_code,
        activity_title: r.activity_title,
        activity_type: r.activity_type,
        activity_order: r.activity_order,
        required: !!r.activity_required,
        min_score: r.activity_min_score,

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

        request,
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
// PATCH Review doc (evidencia)
// PATCH /progreso/admin/docs/:docId/review
// ─────────────────────────────────────────────────────────────
exports.reviewDocUsuario = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const docId = toInt(req.params.docId);
    if (!Number.isFinite(docId)) return res.status(400).json({ error: "docId inválido" });

    const { status, score, review_note } = req.body || {};
    const newStatus = safeStr(status).trim(); // submitted | approved | rejected
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

    const doc = rows?.[0];
    if (!doc) {
      await conn.rollback();
      return res.status(404).json({ error: "Evidencia no encontrada" });
    }

    const userUid = doc.user_id;
    const activityId = doc.activity_id;

    // 1) actualizar doc
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
      // submitted
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
        a.name AS activity_title
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

    console.error("❌ reviewDocUsuario:", {
      message: err?.message,
      sqlMessage: err?.sqlMessage,
      code: err?.code,
      errno: err?.errno,
      sqlState: err?.sqlState,
      sql: err?.sql,
    });

    return res.status(500).json({
      error: "Error al calificar evidencia",
      debug: {
        code: err?.code,
        errno: err?.errno,
        sqlMessage: err?.sqlMessage,
      },
    });
  } finally {
    conn.release();
  }
};

// ─────────────────────────────────────────────────────────────
// PATCH Review request (solicitud)
// PATCH /progreso/admin/requests/:requestId/review
// ─────────────────────────────────────────────────────────────
exports.reviewRequestUsuario = async (req, res) => {
  const conn = await db.getConnection();
  try {
    const requestId = toInt(req.params.requestId);
    if (!Number.isFinite(requestId)) return res.status(400).json({ error: "requestId inválido" });

    const { status, score, review_note } = req.body || {};
    const newStatus = safeStr(status).trim(); // submitted | approved | rejected
    const newScore = normalizeScore(score);
    const note = review_note === undefined ? null : safeStr(review_note);

    if (!["approved", "rejected", "submitted"].includes(newStatus)) {
      return res.status(400).json({ error: "status inválido (submitted|approved|rejected)" });
    }

    const reviewerUid = req?.firebaseUser?.uid || null;

    await conn.beginTransaction();

    const [rows] = await conn.query(
      "SELECT request_id, user_id, activity_id FROM user_activity_requests WHERE request_id = ? LIMIT 1",
      [requestId]
    );

    const reqRow = rows?.[0];
    if (!reqRow) {
      await conn.rollback();
      return res.status(404).json({ error: "Solicitud no encontrada" });
    }

    const userUid = reqRow.user_id;
    const activityId = reqRow.activity_id;

    // 1) update request
    await conn.query(
      `
      UPDATE user_activity_requests
      SET
        status = ?,
        score = ?,
        reviewed_by = ?,
        reviewed_at = NOW(),
        review_note = ?
      WHERE request_id = ?
      `,
      [newStatus, newScore, reviewerUid, note, requestId]
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
      // submitted
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
        uar.*,
        a.code AS activity_code,
        a.name AS activity_title
      FROM user_activity_requests uar
      JOIN activity a ON a.activity_id = uar.activity_id
      WHERE uar.request_id = ? LIMIT 1
      `,
      [requestId]
    );

    return res.json({
      ok: true,
      requestId,
      uid: userUid,
      userUid,
      request: after?.[0] || null,
    });
  } catch (err) {
    try {
      await conn.rollback();
    } catch {}

    console.error("❌ reviewRequestUsuario:", {
      message: err?.message,
      sqlMessage: err?.sqlMessage,
      code: err?.code,
      errno: err?.errno,
      sqlState: err?.sqlState,
      sql: err?.sql,
    });

    return res.status(500).json({
      error: "Error al calificar solicitud",
      debug: {
        code: err?.code,
        errno: err?.errno,
        sqlMessage: err?.sqlMessage,
      },
    });
  } finally {
    conn.release();
  }
};
