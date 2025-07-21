const db = require("../config/db");
const admin = require("firebase-admin");
const { v4: uuidv4 } = require("uuid");

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
  try {
    const uidFirebase = await verificarToken(req);
    const userIdInterno = await getUserIdInterno(uidFirebase);

    const {
      sobre_mi,
      curp_url,
      acta_nacimiento_url,
      ine_url,
      cv_url,
      nss_url,
      constancia_url,
      foto_url,
      certificado_medico_url,
    } = req.body;

    // Validar que al menos venga un documento o sobre_mi
    if (
      !curp_url &&
      !acta_nacimiento_url &&
      !ine_url &&
      !cv_url &&
      !nss_url &&
      !constancia_url &&
      !foto_url &&
      !certificado_medico_url &&
      !sobre_mi
    ) {
      return res.status(400).json({ error: "No se enviaron documentos o datos." });
    }

    // Genera UUID para id
    const idDocumento = uuidv4();

    // Campos para INSERT incluyendo id
    const insertCampos = [
      "id",
      "user_id",
      "curp_url",
      "acta_nacimiento_url",
      "ine_url",
      "cv_url",
      "nss_url",
      "constancia_url",
      "foto_url",
      "certificado_medico_url",
      "sobre_mi",
    ];

    const insertValores = [
      idDocumento,
      userIdInterno,
      curp_url || null,
      acta_nacimiento_url || null,
      ine_url || null,
      cv_url || null,
      nss_url || null,
      constancia_url || null,
      foto_url || null,
      certificado_medico_url || null,
      sobre_mi || null,
    ];

    // Para UPDATE solo actualizamos los campos que sí vienen
    const updateCampos = [];
    const updateValores = [];

    if (curp_url) {
      updateCampos.push("curp_url = ?");
      updateValores.push(curp_url);
    }
    if (acta_nacimiento_url) {
      updateCampos.push("acta_nacimiento_url = ?");
      updateValores.push(acta_nacimiento_url);
    }
    if (ine_url) {
      updateCampos.push("ine_url = ?");
      updateValores.push(ine_url);
    }
    if (cv_url) {
      updateCampos.push("cv_url = ?");
      updateValores.push(cv_url);
    }
    if (nss_url) {
      updateCampos.push("nss_url = ?");
      updateValores.push(nss_url);
    }
    if (constancia_url) {
      updateCampos.push("constancia_url = ?");
      updateValores.push(constancia_url);
    }
    if (foto_url) {
      updateCampos.push("foto_url = ?");
      updateValores.push(foto_url);
    }
    if (certificado_medico_url) {
      updateCampos.push("certificado_medico_url = ?");
      updateValores.push(certificado_medico_url);
    }
    if (typeof sobre_mi === "string") {
      updateCampos.push("sobre_mi = ?");
      updateValores.push(sobre_mi);
    }

    updateCampos.push("ultima_actualizacion = CURRENT_TIMESTAMP");

    const sql = `
      INSERT INTO documentos (${insertCampos.join(", ")})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      ${updateCampos.join(", ")}
    `;

    console.log("📤 Insertando en DB:", insertValores, updateValores);

    await db.query(sql, [...insertValores, ...updateValores]);

    res.status(201).json({ mensaje: "Documentos guardados exitosamente." });
  } catch (error) {
    console.error("❌ Error al guardar documentos:", error);
    res.status(500).json({ error: "Error interno al guardar documentos." });
  }
};

module.exports = {
  guardarDocumentos
};
