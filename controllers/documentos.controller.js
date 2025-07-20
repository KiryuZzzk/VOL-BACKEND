const db = require("../config/db");
const admin = require("firebase-admin");

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

// Controlador para guardar la URL del documento y sus metadatos
const subirDocumento = async (req, res) => {
  try {
    const uid = await verificarToken(req);
    const { nombre, descripcion, tipo, categoria, fecha, url } = req.body;

    if (!url || !nombre || !tipo) {
      return res.status(400).json({ error: "Faltan campos obligatorios (url, nombre, tipo)." });
    }

    const [resultado] = await db.query(
      `INSERT INTO documentos (
        uid, nombre, descripcion, tipo, categoria, fecha, url
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [uid, nombre, descripcion, tipo, categoria, fecha, url]
    );

    res.status(201).json({
      mensaje: "Documento registrado correctamente",
      documentoId: resultado.insertId,
    });
  } catch (error) {
    console.error("❌ Error en subirDocumento:", error.message);
    res.status(401).json({ error: error.message });
  }
};

module.exports = {
  subirDocumento,
};
