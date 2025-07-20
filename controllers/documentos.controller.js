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

const tiposDocumentos = [
  "curp",
  "acta_nacimiento",
  "ine",
  "cv",
  "nss",
  "constancia",
  "foto",
  "certificado_medico"
];

// Nuevo controlador que guarda múltiples documentos
const guardarDocumentos = async (req, res) => {
  try {
    const uid = await verificarToken(req);
    const { sobre_mi, ...rest } = req.body;

    const documentosAGuardar = tiposDocumentos
      .filter((key) => rest[`${key}_url`])
      .map((key) => ({
        uid,
        nombre: key.toUpperCase(),
        descripcion: sobre_mi || null,
        tipo: "documento", // puedes ajustar si quieres pdf, imagen, etc.
        categoria: "personal", // también puedes hacerlo dinámico si gustas
        fecha: new Date(), // o puedes tomarla del frontend
        url: rest[`${key}_url`]
      }));

    if (documentosAGuardar.length === 0) {
      return res.status(400).json({ error: "No se enviaron documentos válidos." });
    }

    const valores = documentosAGuardar.map((doc) => [
      doc.uid,
      doc.nombre,
      doc.descripcion,
      doc.tipo,
      doc.categoria,
      doc.fecha,
      doc.url
    ]);

    await db.query(
      `INSERT INTO documentos (uid, nombre, descripcion, tipo, categoria, fecha, url) VALUES ?`,
      [valores]
    );

    res.status(201).json({ mensaje: "Documentos guardados exitosamente." });

  } catch (error) {
    console.error("❌ Error al guardar documentos:", error.message);
    res.status(500).json({ error: "Error interno al guardar documentos." });
  }
};

module.exports = {
  guardarDocumentos
};
