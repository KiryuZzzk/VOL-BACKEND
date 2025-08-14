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
      console.log("🏃‍♂️ Ejecutando getAll...");
console.log("Campos a seleccionar:", campos);
    } else if (rol === "admin") {
      sql = `SELECT ${campos} FROM users WHERE 1=1`;
      console.log("🏃‍♂️ Ejecutando getAll...");
console.log("Campos a seleccionar:", campos);
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
  const requestedUserId = String(req.params.userId || "").trim();

  // Compat con tu middleware nuevo
  const requester = req.dbUser || req.user || {};
  const roles = req.dbRoles || (req.user ? [req.user.rol] : []);
  const hasRole = (r) => roles.includes(r);

  if (!requestedUserId || isNaN(Number(requestedUserId))) {
    console.warn("⛔ userId inválido:", requestedUserId);
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  console.log("👀 getByUserId -> solicitando:", requestedUserId, "| requester:", {
    id: requester.id,
    estado: requester.estado,
    roles,
  });

  // Reglas de autorización
  // 1) Aspirante solo puede ver su propio perfil
  if (hasRole("aspirante") && String(requestedUserId) !== String(requester.id)) {
    console.warn("🚫 Aspirante intentando ver perfil ajeno");
    return res.status(403).json({ error: "No tienes permiso para ver este perfil" });
  }

  // 2) Moderador solo puede ver usuarios de su mismo estado
  // (para esto haremos el filtro por estado debajo)
  const restrictByEstado = hasRole("moderador") && !hasRole("admin");

  // Campos completos del expediente (coinciden con lo que insertas en registerUser)
  const FULL_COLUMNS = `
    u.id, u.uid, u.correo,
    u.nombre, u.apellido_pat, u.apellido_mat, u.fecha_nacimiento,
    u.curp, u.sexo, u.estado_civil, u.telefono, u.celular,
    u.emergencia_nombre, u.emergencia_relacion, u.emergencia_telefono, u.emergencia_celular,
    u.grado_estudios, u.especifica_estudios, u.ocupacion, u.empresa,
    u.idiomas, u.porcentaje_idioma, u.licencias, u.tipo_licencia, u.pasaporte, u.otro_documento,
    u.tipo_sangre, u.rh, u.enfermedades, u.alergias, u.medicamentos, u.ejercicio,
    u.como_se_entero, u.motivo_interes, u.voluntariado_previo, u.razon_proyecto,
    u.estado, u.colonia, u.cp, u.coordinacion,
    u.matricula, u.estado_validacion, u.fecha_registro,
    r.nombre_rol
  `;

  // Query base
  let sql = `
    SELECT ${FULL_COLUMNS}
    FROM users u
    LEFT JOIN roles r ON r.user_id = u.id
    WHERE u.id = ?
  `;
  const params = [requestedUserId];

  // Si es moderador (no admin), restringimos por su estado
  if (restrictByEstado) {
    sql += " AND u.estado = ? ";
    params.push(requester.estado);
  }

  try {
    const [rows] = await db.query(sql, params);

    if (!rows.length) {
      const msg = restrictByEstado
        ? "Usuario no encontrado o fuera de tu alcance"
        : "Usuario no encontrado";
      console.warn("ℹ️ getByUserId vacío:", { requestedUserId, restrictByEstado });
      return res.status(404).json({ error: msg });
    }

    // Puedes devolver tal cual la fila; el front ya normaliza snake/camel y oculta uid/correo.
    const user = rows[0];

    console.log("✅ getByUserId OK → campos devueltos:", Object.keys(user).length);
    return res.json(user);
  } catch (err) {
    console.error("❌ getByUserId error:", err.message);
    return res.status(500).json({ error: err.message || "Error al obtener usuario" });
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
