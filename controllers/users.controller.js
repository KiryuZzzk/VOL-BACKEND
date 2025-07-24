const db = require("../config/db");

exports.getAll = async (req, res) => {
  const { rol, estado } = req.user;
  const { searchField, search } = req.query;

  console.log("🔍 Parámetros de búsqueda recibidos:", { rol, estado, searchField, search });

  const validFields = ["matricula", "correo", "curp"];
  let sql = "";
  let params = [];

  try {
    // Selección explícita de todos los campos menos id y uid
    const campos = [
      "matricula",
      "correo",
      "nombre",
      "apellido_pat AS apellido_paterno",
      "apellido_mat AS apellido_materno",
      "fecha_nacimiento",
      "curp",
      "sexo",
      "estado_civil",
      "telefono",
      "celular",
      "emergencia_nombre",
      "emergencia_relacion",
      "emergencia_telefono",
      "emergencia_celular",
      "grado_estudios",
      "especifica_estudios",
      "ocupacion",
      "empresa",
      "idiomas",
      "porcentaje_idioma",
      "licencias",
      "tipo_licencia",
      "pasaporte",
      "otro_documento",
      "tipo_sangre",
      "rh",
      "enfermedades",
      "alergias",
      "medicamentos",
      "ejercicio",
      "como_se_entero",
      "motivo_interes",
      "voluntariado_previo",
      "razon_proyecto",
      "estado_validacion",
      "fecha_registro",
      "estado",
      "colonia",
      "codigo_postal",
      "coordinacion",
    ].join(", ");

    if (rol === "moderador") {
      sql = `SELECT ${campos} FROM users WHERE estado = ?`;
      params.push(estado);
    } else if (rol === "admin") {
      sql = `SELECT ${campos} FROM users WHERE 1=1`;
    } else {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    if (search && search.trim() !== "" && validFields.includes(searchField)) {
      sql += ` AND ${searchField} LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    console.log("🛠 Ejecutando SQL:", sql);
    console.log("📦 Con parámetros:", params);

    const [results] = await db.query(sql, params);

    if (!Array.isArray(results)) {
      console.error("❌ Resultado inesperado de la consulta:", results);
      return res.status(500).json({ error: "Error interno en la consulta" });
    }

    res.json(results);
  } catch (err) {
    console.error("❌ Error en getAll:", err, err.stack);
    res.status(500).json({ error: "Error al obtener perfiles" });
  }
};



// Obtener usuario por ID (admin/mod/aspirante con restricciones)
exports.getByUserId = async (req, res) => {
  const requestedUserId = req.params.userId;
  const loggedUser = req.user;

  if (!requestedUserId || typeof requestedUserId !== "string") {
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  try {
    if (loggedUser.rol === "aspirante" && requestedUserId !== loggedUser.id) {
      return res.status(403).json({ error: "No tienes permiso para ver este perfil" });
    }

    if (loggedUser.rol === "moderador") {
      const sql = "SELECT nombre, apellido_pat, apellido_mat, curp, matricula, estado, telefono FROM users WHERE id = ? AND estado = ?";
      const [results] = await db.query(sql, [requestedUserId, loggedUser.estado]);
      if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado o fuera de tu alcance" });
      return res.json(results[0]);
    }

    // admin
    const sqlAdmin = "SELECT nombre, apellido_pat, apellido_mat, curp, matricula, estado, telefono FROM users WHERE id = ?";
    const [resultsAdmin] = await db.query(sqlAdmin, [requestedUserId]);
    if (resultsAdmin.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(resultsAdmin[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Actualizar usuario (solo el propio aspirante o admin/mod)
exports.update = async (req, res) => {
  const targetUserId = req.params.userId;
  const loggedUser = req.user;
  const updateFields = { ...req.body };

  // Solo aspirante puede editar su perfil, admin/mod pueden editar cualquier perfil
  if (loggedUser.rol === "aspirante" && targetUserId !== loggedUser.id) {
    return res.status(403).json({ error: "No tienes permiso para modificar este perfil" });
  }

  // Bloquear edición de campos sensibles
  delete updateFields.id;
  delete updateFields.matricula;
  delete updateFields.uid;
  delete updateFields.correo;
  delete updateFields.estado_validacion;

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({ error: "No se enviaron campos para actualizar o sólo campos no editables" });
  }

  try {
    const [existingUser] = await db.query("SELECT * FROM users WHERE id = ?", [targetUserId]);
    if (existingUser.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    const fields = Object.keys(updateFields).map(field => `${field} = ?`).join(", ");
    const values = Object.values(updateFields);
    values.push(targetUserId);

    const sql = `UPDATE users SET ${fields} WHERE id = ?`;
    await db.query(sql, values);

    res.json({ message: "Perfil actualizado correctamente" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
