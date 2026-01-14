const db = require("../config/db");

/**
 * Evidencias por actividad (user_activity_docs)
 *
 * Tabla sugerida (MySQL):
 *  - id, user_id, activity_id
 *  - document_title, description
 *  - file_url, file_name, file_type, file_size, storage_path
 *  - status (submitted/approved/rejected) opcional
 *  - created_at, updated_at
 *
 * Recomendación:
 *  - UNIQUE KEY (user_id, activity_id) si solo permites 1 archivo por actividad.
 */

async function resolveCodesByActivityId(activityId) {
  const [rows] = await db.query(
    `
    SELECT
      p.code  AS program_code,
      b.code  AS block_code,
      m.code  AS module_code
    FROM activity a
    JOIN module m ON m.module_id = a.module_id
    JOIN block  b ON b.block_id = m.block_id
    JOIN program p ON p.program_id = b.program_id
    WHERE a.activity_id = ?
    LIMIT 1
    `,
    [activityId]
  );

  return rows?.[0] || null;
}


function toInt(v) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : NaN;
}

exports.upsertActividadDoc = async (req, res) => {
  try {
    const userId = req.user?.id;
    const activityId = toInt(req.params.activityId);

    const codes = await resolveCodesByActivityId(activityId);

    if (!codes) {
      return res.status(404).json({ ok: false, message: "Actividad no encontrada" });
    }


    if (!userId) return res.status(401).json({ ok: false, message: "No autenticado" });
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return res.status(400).json({ ok: false, message: "activityId inválido" });
    }

    const {
      documentTitle = null,
      description = null,
      userNote = null,
      fileUrl,
      fileName,
      fileType = null,
      fileSize = null,
      storagePath = null,
    } = req.body || {};

    if (!fileUrl || !fileName) {
      return res.status(400).json({ ok: false, message: "fileUrl y fileName son requeridos" });
    }

    // ¿Ya existe evidencia para (userId, activityId)?
    const [rows] = await db.query(
      "SELECT id FROM user_activity_docs WHERE user_id = ? AND activity_id = ? LIMIT 1",
      [userId, activityId]
    );

    if (rows?.length) {
      const id = rows[0].id;
      await db.query(
        `UPDATE user_activity_docs
        SET
          program_code = ?,
          block_code = ?,
          module_code = ?,
          document_title = ?,
          description = ?,
          user_note = ?,
          file_url = ?,
          file_name = ?,
          file_type = ?,
          file_size = ?,
          storage_path = ?,
          status = COALESCE(status,'submitted'),
          updated_at = NOW()
        WHERE id = ?`,
        [
          codes.program_code,
          codes.block_code,
          codes.module_code,
          documentTitle,
          description,
          userNote,
          fileUrl,
          fileName,
          fileType,
          fileSize,
          storagePath,
          id,
        ]
      );


      const [after] = await db.query("SELECT * FROM user_activity_docs WHERE id = ? LIMIT 1", [id]);
      return res.json({ ok: true, doc: after?.[0] || null, updated: true });
    }

    
    const [ins] = await db.query(
      `INSERT INTO user_activity_docs
        (
          user_id, activity_id,
          program_code, block_code, module_code,
          document_title, description,
          file_url, file_name, file_type, file_size, storage_path,
          user_note,
          status, created_at, updated_at
        )
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', NOW(), NOW())`,
      [
        userId,
        activityId,
        codes.program_code,
        codes.block_code,
        codes.module_code,
        documentTitle,
        description,
        fileUrl,
        fileName,
        fileType,
        fileSize,
        storagePath,
        userNote,
      ]
    );


    const newId = ins?.insertId;
    const [created] = await db.query("SELECT * FROM user_activity_docs WHERE id = ? LIMIT 1", [newId]);

    return res.status(201).json({ ok: true, doc: created?.[0] || null, created: true });
  } catch (err) {
    console.error("upsertActividadDoc error:", err);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};

exports.obtenerDocActividadMio = async (req, res) => {
  try {
    const userId = req.user?.id;
    const activityId = toInt(req.params.activityId);

    if (!userId) return res.status(401).json({ ok: false, message: "No autenticado" });
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return res.status(400).json({ ok: false, message: "activityId inválido" });
    }

    const [rows] = await db.query(
      "SELECT * FROM user_activity_docs WHERE user_id = ? AND activity_id = ? ORDER BY id DESC LIMIT 1",
      [userId, activityId]
    );

    return res.json({ ok: true, doc: rows?.[0] || null });
  } catch (err) {
    console.error("obtenerDocActividadMio error:", err);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};

exports.eliminarDocActividadMio = async (req, res) => {
  try {
    const userId = req.user?.id;
    const activityId = toInt(req.params.activityId);

    if (!userId) return res.status(401).json({ ok: false, message: "No autenticado" });
    if (!Number.isFinite(activityId) || activityId <= 0) {
      return res.status(400).json({ ok: false, message: "activityId inválido" });
    }

    await db.query("DELETE FROM user_activity_docs WHERE user_id = ? AND activity_id = ?", [
      userId,
      activityId,
    ]);

    return res.json({ ok: true, deleted: true });
  } catch (err) {
    console.error("eliminarDocActividadMio error:", err);
    return res.status(500).json({ ok: false, message: "Error interno" });
  }
};
