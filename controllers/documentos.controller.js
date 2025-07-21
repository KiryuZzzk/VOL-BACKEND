const db = require("../config/db");
const admin = require("firebase-admin");

// Verifica el token Firebase
const verificarToken = async (req) => {
  const authHeader = req.headers.authorization;
  console.log("📡 Header Authorization:", authHeader); // 👈 LOG 1
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new Error("No autorizado: token no proporcionado.");
  }

  const token = authHeader.split(" ")[1];
  const decodedToken = await admin.auth().verifyIdToken(token);
  console.log("🔐 Token decodificado:", decodedToken); // 👈 LOG 2
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

// Obtener id interno de usuario desde uid Firebase
const getUserIdInterno = async (uid) => {
  console.log("🔍 Buscando ID interno para UID:", uid); // 👈 LOG 3
  const [results] = await db.query("SELECT id FROM users WHERE uid = ?", [uid]);
  if (results.length === 0) throw new Error("Usuario no encontrado en DB");
  console.log("✅ ID interno encontrado:", results[0].id); // 👈 LOG 4
  return results[0].id;
};

const guardarDocumentos = async (req, res) => {
  console.log("📥 Entrando a guardarDocumentos"); // 👈 LOG 5

  try {
    const uidFirebase = await verificarToken(req);
    const userIdInterno = await getUserIdInterno(uidFirebase);

    console.log("📦 Body recibido:", req.body); // 👈 LOG 6

    const { sobre_mi, ...rest } = req.body;

    const documentosAGuardar = tiposDocumentos
      .filter((key) => rest[`${key}_url`])
      .map((key) => ({
        uid: userIdInterno,
        nombre: key.toUpperCase(),
        descripcion: sobre_mi || null,
        tipo: "documento",
        categoria: "personal",
        fecha: new Date(),
        url: rest[`${key}_url`]
      }));

    console.log("🧾 Documentos que se van a guardar:", documentosAGuardar); // 👈 LOG 7

    if (documentosAGuardar.length === 0) {
      console.warn("⚠️ No se enviaron documentos válidos.");
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

    console.log("📤 Insertando en DB:", valores); // 👈 LOG 8

    await db.query(
      `INSERT INTO documentos (uid, nombre, descripcion, tipo, categoria, fecha, url) VALUES ?`,
      [valores]
    );

    res.status(201).json({ mensaje: "Documentos guardados exitosamente." });

  } catch (error) {
    console.error("❌ Error al guardar documentos:", error.message);
    res.status(500).json({
      error: "Error interno al guardar documentos.",
      detalle: error.message
    });
  }
};

module.exports = {
  guardarDocumentos
};
