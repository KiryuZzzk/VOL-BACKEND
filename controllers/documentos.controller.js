const db = require("../config/db");
// const admin = require("firebase-admin"); // Ya no re-verificamos aquí
const { v4: uuidv4 } = require("uuid");

/** Campos esperados en tabla `documentos` (o en `users` si ahí quedaron) */
const DOC_COLS = `
  curp_url, curp_aprobado,
  acta_nacimiento_url, acta_nacimiento_aprobado,
  ine_url, ine_aprobado,
  cv_url, cv_aprobado,
  nss_url, nss_aprobado,
  constancia_url, constancia_aprobado,
  foto_url, foto_aprobado,
  certificado_medico_url, certificado_medico_aprobado,
  sobre_mi,
  fecha_creacion,
  ultima_actualizacion
`;

/** Util: mezcla info de usuario + documentos en un objeto “plano” */
function mergeUserAndDocs(userRow = {}, docsRow = {}) {
  const out = {
    id: userRow.id,
    matricula: userRow.matricula,
    curp: userRow.curp,
    correo: userRow.correo,
    ...docsRow,
  };
  // Normaliza aprobados null → false
  [
    "curp_aprobado",
    "acta_nacimiento_aprobado",
    "ine_aprobado",
    "cv_aprobado",
    "nss_aprobado",
    "constancia_aprobado",
    "foto_aprobado",
    "certificado_medico_aprobado",
  ].forEach((k) => {
    if (out[k] == null) out[k] = false;
  });
  return out;
}

/** ─────────────────────────────────────────────────────────────
 *  Crear/actualizar documentos (aspirante/admin/mod)
 *  Usa req.user.id (inyectado por authMiddleware)
 *  IMPORTANTE: para que el UPSERT funcione por usuario, asegúrate
 *  de tener UNIQUE KEY en documentos.user_id
 *  ALTER TABLE documentos ADD UNIQUE KEY uniq_user (user_id);
 *  ───────────────────────────────────────────────────────────── */
const guardarDocumentos = async (req, res) => {
  try {
    const userIdInterno = req.user?.id;
    if (!userIdInterno) {
      return res.status(401).json({ error: "No autenticado" });
    }

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

    // Genera UUID solo si realmente insertamos una nueva fila
    const idDocumento = uuidv4();

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
      (typeof sobre_mi === "string" ? sobre_mi : null),
    ];

    const updateCampos = [];
    const updateValores = [];

    if (curp_url) { updateCampos.push("curp_url = ?"); updateValores.push(curp_url); }
    if (acta_nacimiento_url) { updateCampos.push("acta_nacimiento_url = ?"); updateValores.push(acta_nacimiento_url); }
    if (ine_url) { updateCampos.push("ine_url = ?"); updateValores.push(ine_url); }
    if (cv_url) { updateCampos.push("cv_url = ?"); updateValores.push(cv_url); }
    if (nss_url) { updateCampos.push("nss_url = ?"); updateValores.push(nss_url); }
    if (constancia_url) { updateCampos.push("constancia_url = ?"); updateValores.push(constancia_url); }
    if (foto_url) { updateCampos.push("foto_url = ?"); updateValores.push(foto_url); }
    if (certificado_medico_url) { updateCampos.push("certificado_medico_url = ?"); updateValores.push(certificado_medico_url); }
    if (typeof sobre_mi === "string") { updateCampos.push("sobre_mi = ?"); updateValores.push(sobre_mi); }

    // siempre actualiza timestamp
    updateCampos.push("ultima_actualizacion = CURRENT_TIMESTAMP");

    const sql = `
      INSERT INTO documentos (${insertCampos.join(", ")})
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
      ${updateCampos.join(", ")}
    `;

    console.log("📤 guardarDocumentos → INSERT/UPDATE", { userIdInterno, insertValores, updateValores });

    await db.query(sql, [...insertValores, ...updateValores]);

    return res.status(201).json({ mensaje: "Documentos guardados exitosamente." });
  } catch (error) {
    console.error("❌ guardarDocumentos:", error);
    return res.status(500).json({ error: "Error interno al guardar documentos." });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Admin/Mod: listar todos (ya lo tenías)
 *  ───────────────────────────────────────────────────────────── */
const getAll = async (req, res) => {
  const { rol, estado } = req.user;
  const { searchField, search } = req.query;

  console.log("🔍 getAll docs → filtros:", { rol, estado, searchField, search });

  const validFields = ["matricula", "correo", "curp"];
  try {
    const camposUsuarios = [
      "users.id",
      "users.nombre",
      "users.matricula",
      "users.correo",
      "users.curp"
    ];

    const camposDocumentos = [
      "documentos.curp_url",
      "documentos.curp_aprobado",
      "documentos.acta_nacimiento_url",
      "documentos.acta_nacimiento_aprobado",
      "documentos.ine_url",
      "documentos.ine_aprobado",
      "documentos.cv_url",
      "documentos.cv_aprobado",
      "documentos.nss_url",
      "documentos.nss_aprobado",
      "documentos.constancia_url",
      "documentos.constancia_aprobado",
      "documentos.foto_url",
      "documentos.foto_aprobado",
      "documentos.certificado_medico_url",
      "documentos.certificado_medico_aprobado",
      "documentos.sobre_mi",
      "documentos.fecha_creacion",
      "documentos.ultima_actualizacion"
    ];

    const campos = [...camposUsuarios, ...camposDocumentos].join(", ");

    let sql = `
      SELECT ${campos}
      FROM users
      JOIN documentos ON users.id = documentos.user_id
    `;
    const params = [];

    if (rol === "moderador") {
      sql += " WHERE users.estado = ?";
      params.push(estado);
    } else if (rol !== "admin") {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    if (search && search.trim() !== "" && validFields.includes(searchField)) {
      sql += (rol === "moderador" ? " AND" : " WHERE") + ` users.${searchField} LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    console.log("🛠 getAll docs SQL:", sql, params);

    const [results] = await db.query(sql, params);
    if (!Array.isArray(results)) {
      return res.status(500).json({ error: "Error interno en la consulta" });
    }
    return res.json(results);
  } catch (err) {
    console.error("❌ getAll docs:", err);
    return res.status(500).json({ error: "Error al obtener perfiles" });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Admin/Mod: actualizar estado aprobado/rechazado de un documento
 *  ───────────────────────────────────────────────────────────── */
const actualizarEstadoDocumento = async (req, res) => {
  try {
    const { user_matricula, documento, estado } = req.body;

    if (!user_matricula || !documento || typeof estado !== "boolean") {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const campoAprobado = `${documento}_aprobado`;
    const [usuario] = await db.query("SELECT id FROM users WHERE matricula = ?", [user_matricula]);
    if (!usuario.length) return res.status(404).json({ error: "Usuario no encontrado" });

    const sql = `
      UPDATE documentos
      SET ${campoAprobado} = ?, ultima_actualizacion = CURRENT_TIMESTAMP
      WHERE user_id = ?
    `;

    await db.query(sql, [estado, usuario[0].id]);
    return res.status(200).json({ mensaje: "Estado actualizado correctamente." });
  } catch (e) {
    console.error("❌ actualizarEstadoDocumento:", e);
    return res.status(500).json({ error: "Error al actualizar estado del documento" });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Mis documentos (usuario autenticado)
 *  ───────────────────────────────────────────────────────────── */
const obtenerMisDocumentos = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    console.log("📄 obtenerMisDocumentos → user_id:", userId);

    const [userRows] = await db.query(
      "SELECT id, matricula, curp, correo FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    // Busca en documentos; si no hay fila, intentamos en users (por compat)
    let [docsRows] = await db.query(
      `SELECT ${DOC_COLS} FROM documentos WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    if (!docsRows.length) {
      console.warn("ℹ️ obtenerMisDocumentos: sin fila en documentos; probando en users");
      [docsRows] = await db.query(
        `SELECT ${DOC_COLS} FROM users WHERE id = ? LIMIT 1`,
        [userId]
      );
    }

    const payload = mergeUserAndDocs(userRows[0], docsRows[0] || {});
    return res.json(payload);
  } catch (err) {
    console.error("❌ obtenerMisDocumentos:", err);
    return res.status(500).json({ error: "Error al obtener documentos" });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Documentos por userId (admin/mod)
 *  ───────────────────────────────────────────────────────────── */
const obtenerDocumentosPorUserId = async (req, res) => {
  try {
    const requestedUserId = String(req.params.userId || "").trim();
    if (!requestedUserId) {
      return res.status(400).json({ error: "Parámetro userId inválido" });
    }

    const [userRows] = await db.query(
      "SELECT id, matricula, curp, correo FROM users WHERE id = ? LIMIT 1",
      [requestedUserId]
    );
    if (!userRows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    let [docsRows] = await db.query(
      `SELECT ${DOC_COLS} FROM documentos WHERE user_id = ? LIMIT 1`,
      [requestedUserId]
    );
    if (!docsRows.length) {
      [docsRows] = await db.query(
        `SELECT ${DOC_COLS} FROM users WHERE id = ? LIMIT 1`,
        [requestedUserId]
      );
    }

    const payload = mergeUserAndDocs(userRows[0], docsRows[0] || {});
    return res.json(payload);
  } catch (err) {
    console.error("❌ obtenerDocumentosPorUserId:", err);
    return res.status(500).json({ error: "Error al obtener documentos" });
  }
};

module.exports = {
  guardarDocumentos,
  getAll,
  actualizarEstadoDocumento,
  obtenerMisDocumentos,
  obtenerDocumentosPorUserId,
};
