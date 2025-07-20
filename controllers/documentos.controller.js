const db = require("../config/db");
const admin = require("firebase-admin");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

// Verifica el token Firebase
const verificarToken = async (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("No autorizado: token no proporcionado.");
  }

  const token = authHeader.split(" ")[1];
  const decodedToken = await admin.auth().verifyIdToken(token);
  return decodedToken.uid;
};

// Subida de archivo a carpeta local o bucket (modificable)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadPath = "uploads/documentos";
    fs.mkdirSync(uploadPath, { recursive: true });
    cb(null, uploadPath);
  },
  filename: (req, file, cb) => {
    const uniqueName = `${Date.now()}-${file.originalname}`;
    cb(null, uniqueName);
  },
});
const upload = multer({ storage });

// Controlador para subir documento
const subirDocumento = async (req, res) => {
  try {
    const uid = await verificarToken(req);
    const { nombre, descripcion, tipo, categoria, fecha } = req.body;
    const archivo = req.file;

    if (!archivo) {
      return res.status(400).json({ error: "Archivo no recibido" });
    }

    // Guarda info en la DB
    const [resultado] = await db.query(
      `INSERT INTO documentos (uid, nombre, descripcion, tipo, categoria, fecha, nombre_archivo, ruta_archivo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid,
        nombre,
        descripcion,
        tipo,
        categoria,
        fecha,
        archivo.originalname,
        archivo.path,
      ]
    );

    res.status(201).json({
      mensaje: "Documento guardado correctamente",
      documentoId: resultado.insertId,
    });
  } catch (error) {
    console.error("❌ Error en subirDocumento:", error.message);
    res.status(401).json({ error: error.message });
  }
};

module.exports = {
  upload,
  subirDocumento,
};
