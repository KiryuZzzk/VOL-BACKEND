const db = require("../config/db");

exports.guardarDocumentos = async (req, res) => {
  const { uid } = req.user; // viene del token
  const {
    curp_url,
    acta_nacimiento_url,
    ine_url,
    cv_url,
    nss_url,
    constancia_url,
    foto_url,
    certificado_medico_url,
    sobre_mi,
  } = req.body;

  if (!uid) return res.status(400).json({ error: "UID faltante" });

  try {
    const [existe] = await db.query(
      "SELECT id FROM documentos_usuario WHERE user_id = ?",
      [uid]
    );

    if (existe.length > 0) {
      // Update
      await db.query(
        `UPDATE documentos_usuario SET
          curp_url = ?, acta_nacimiento_url = ?, ine_url = ?, cv_url = ?,
          nss_url = ?, constancia_url = ?, foto_url = ?, certificado_medico_url = ?,
          sobre_mi = ?, ultima_actualizacion = CURRENT_TIMESTAMP
         WHERE user_id = ?`,
        [
          curp_url, acta_nacimiento_url, ine_url, cv_url,
          nss_url, constancia_url, foto_url, certificado_medico_url,
          sobre_mi, uid
        ]
      );
    } else {
      // Insert
      await db.query(
        `INSERT INTO documentos_usuario (
          id, user_id,
          curp_url, acta_nacimiento_url, ine_url, cv_url,
          nss_url, constancia_url, foto_url, certificado_medico_url, sobre_mi
        ) VALUES (
          UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
        )`,
        [
          uid,
          curp_url, acta_nacimiento_url, ine_url, cv_url,
          nss_url, constancia_url, foto_url, certificado_medico_url, sobre_mi
        ]
      );
    }

    res.status(200).json({ message: "Documentos guardados correctamente" });
  } catch (error) {
    console.error("❌ Error al guardar documentos:", error);
    res.status(500).json({ error: "Error al guardar documentos" });
  }
};

exports.obtenerDocumentosPorUserId = async (req, res) => {
  const { userId } = req.params;

  try {
    const [resultado] = await db.query(
      "SELECT * FROM documentos_usuario WHERE user_id = ? LIMIT 1",
      [userId]
    );

    if (resultado.length === 0) {
      return res.status(404).json({ error: "No se encontraron documentos para este usuario" });
    }

    res.json(resultado[0]);
  } catch (error) {
    console.error("❌ Error al obtener documentos:", error);
    res.status(500).json({ error: "Error al obtener documentos del usuario" });
  }
};
