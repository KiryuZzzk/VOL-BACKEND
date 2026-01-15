const multer = require("multer");
const path = require("path");
const db = require("../config/db");
const admin = require("firebase-admin");

// Multer en memoria (para subir directo a Firebase)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB (ajusta)
});

function getExt(filename = "") {
  const ext = path.extname(filename).toLowerCase();
  return ext || "";
}

async function ensureOwnerOrAdmin(req, trajectoryId) {
  const uid = req.user?.uid;
  const rol = req.user?.rol;

  const [rows] = await db.query(
    "SELECT uid FROM user_trajectory WHERE trajectory_id = ? LIMIT 1",
    [trajectoryId]
  );

  if (!rows.length) return { ok: false, code: 404, msg: "Registro no encontrado" };

  const ownerUid = rows[0].uid;

  if (rol === "admin" || rol === "moderador") return { ok: true, ownerUid };
  if (ownerUid === uid) return { ok: true, ownerUid };

  return { ok: false, code: 403, msg: "No autorizado" };
}

// POST /trayectoria/:trajectoryId/upload
const uploadTrayectoriaFile = async (req, res) => {
  try {
    const trajectoryId = Number(req.params.trajectoryId);
    if (!Number.isFinite(trajectoryId) || trajectoryId <= 0) {
      return res.status(400).json({ error: "trajectoryId inválido" });
    }

    const check = await ensureOwnerOrAdmin(req, trajectoryId);
    if (!check.ok) return res.status(check.code).json({ error: check.msg });

    if (!req.file) return res.status(400).json({ error: "No se recibió archivo" });

    const uid = check.ownerUid;
    const bucket = admin.storage().bucket();

    const originalName = req.file.originalname || "archivo";
    const ext = getExt(originalName);
    const safeName = originalName.replace(/[^\w.\-() ]+/g, "_");

    // Ruta en storage (ordenada)
    const storagePath = `trayectoria/${uid}/${trajectoryId}/${Date.now()}_${safeName}`;

    const file = bucket.file(storagePath);

    await file.save(req.file.buffer, {
      metadata: {
        contentType: req.file.mimetype || "application/octet-stream",
        metadata: {
          uid,
          trajectoryId: String(trajectoryId),
        },
      },
      resumable: false,
    });

    // URL pública firmada (si tu bucket NO es público)
    // Si tú ya haces getDownloadURL de otra forma, lo adaptamos.
    const [signedUrl] = await file.getSignedUrl({
      action: "read",
      expires: "2100-01-01",
    });

    const sql = `
      UPDATE user_trajectory
      SET
        file_url = ?,
        storage_path = ?,
        file_name = ?,
        file_type = ?,
        file_size_bytes = ?,
        submitted_at = COALESCE(submitted_at, CURRENT_TIMESTAMP),
        updated_at = CURRENT_TIMESTAMP
      WHERE trajectory_id = ?
    `;

    await db.query(sql, [
      signedUrl,
      storagePath,
      originalName,
      req.file.mimetype || null,
      req.file.size || null,
      trajectoryId,
    ]);

    return res.json({
      mensaje: "Archivo subido y guardado",
      trajectory_id: trajectoryId,
      file_url: signedUrl,
      storage_path: storagePath,
      file_name: originalName,
    });
  } catch (err) {
    console.error("❌ uploadTrayectoriaFile:", err);
    return res.status(500).json({ error: "Error al subir archivo" });
  }
};

module.exports = {
  upload,
  uploadTrayectoriaFile,
};
