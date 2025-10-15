// controllers/users.controller.js
const db = require("../config/db");

/**
 * GET /users
 * - Admin: ve a todos
 * - Moderador: solo de su mismo estado
 * Soporta filtros opcionales: ?searchField=matricula|correo|curp&search=VALOR
 */
exports.getAll = async (req, res) => {
  const { rol, estado } = req.user;
  const { searchField, search } = req.query;

  console.log("🔍 Parámetros de búsqueda recibidos:", { rol, estado, searchField, search });

  const validFields = ["matricula", "correo", "curp"];
  let sql = "";
  const params = [];

  try {
    // Selección explícita de campos (incluye id)
    const campos = [
      "u.id AS id", // necesario para PUT /users/:id
      "u.matricula",
      "u.correo",
      "u.nombre",
      "u.apellido_pat AS apellido_paterno",
      "u.apellido_mat AS apellido_materno",
      "u.fecha_nacimiento",
      "u.curp",
      "u.sexo",
      "u.estado_civil",
      "u.telefono",
      "u.celular",
      "u.emergencia_nombre",
      "u.emergencia_relacion",
      "u.emergencia_telefono",
      "u.emergencia_celular",
      "u.grado_estudios",
      "u.especifica_estudios",
      "u.ocupacion",
      "u.empresa",
      "u.idiomas",
      "u.porcentaje_idioma",
      "u.licencias",
      "u.tipo_licencia",
      "u.pasaporte",
      "u.otro_documento",
      "u.tipo_sangre",
      "u.rh",
      "u.enfermedades",
      "u.alergias",
      "u.medicamentos",
      "u.ejercicio",
      "u.como_se_entero",
      "u.motivo_interes",
      "u.voluntariado_previo",
      "u.razon_proyecto",
      "u.estado_validacion",
      "u.fecha_registro",
      "u.estado",
      "u.colonia",
      "u.codigo_postal",
      "u.coordinacion",
    ].join(", ");

    if (rol === "moderador") {
      sql = `SELECT ${campos} FROM users u WHERE u.estado = ?`;
      params.push(estado);
    } else if (rol === "admin") {
      sql = `SELECT ${campos} FROM users u WHERE 1=1`;
    } else {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    if (search && search.trim() !== "" && validFields.includes(searchField)) {
      sql += ` AND u.${searchField} LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    sql += " ORDER BY u.fecha_registro DESC";

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

/**
 * GET /users/:userId
 * Reglas:
 * - Aspirante: solo puede ver su propio perfil
 * - Moderador: solo usuarios de su mismo estado (a menos que también sea admin)
 * - Admin: sin restricción
 */
exports.getByUserId = async (req, res) => {
  const requestedUserId = String(req.params.userId || "").trim();

  // Con tu middleware:
  const requester = req.dbUser || req.user || {};
  const roles = req.dbRoles || (req.user ? [req.user.rol] : []);
  const hasRole = (r) => roles.includes(r);

  if (!requestedUserId) {
    console.warn("⛔ userId vacío");
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  console.log("👀 getByUserId -> solicitando:", requestedUserId, "| requester:", {
    id: requester.id,
    estado: requester.estado,
    roles,
  });

  // 1) Aspirante solo puede ver su propio perfil
  if (hasRole("aspirante") && String(requestedUserId) !== String(requester.id)) {
    console.warn("🚫 Aspirante intentando ver perfil ajeno");
    return res.status(403).json({ error: "No tienes permiso para ver este perfil" });
  }

  // 2) Moderador restringido por estado (si no es admin)
  const restrictByEstado = hasRole("moderador") && !hasRole("admin");

  const FULL_COLUMNS = `
    u.id, u.uid, u.correo,
    u.nombre, u.apellido_pat, u.apellido_mat, u.fecha_nacimiento,
    u.curp, u.sexo, u.estado_civil, u.telefono, u.celular,
    u.emergencia_nombre, u.emergencia_relacion, u.emergencia_telefono, u.emergencia_celular,
    u.grado_estudios, u.especifica_estudios, u.ocupacion, u.empresa,
    u.idiomas, u.porcentaje_idioma, u.licencias, u.tipo_licencia, u.pasaporte, u.otro_documento,
    u.tipo_sangre, u.rh, u.enfermedades, u.alergias, u.medicamentos, u.ejercicio,
    u.como_se_entero, u.motivo_interes, u.voluntariado_previo, u.razon_proyecto,
    u.estado, u.colonia, u.codigo_postal AS cp, u.coordinacion,
    u.matricula, u.estado_validacion, u.fecha_registro,
    r.nombre_rol
  `;

  // Query base por ID
  let sql = `
    SELECT ${FULL_COLUMNS}
    FROM users u
    LEFT JOIN roles r ON r.user_id = u.id
    WHERE u.id = ?
  `;
  const params = [requestedUserId];

  if (restrictByEstado) {
    sql += " AND u.estado = ? ";
    params.push(requester.estado);
  }

  try {
    let [rows] = await db.query(sql, params);

    // Fallback por uid del requester (por si front envía algo raro)
    if (!rows.length && req.firebaseUser?.uid) {
      console.warn("ℹ️ No se encontró por id; intentando por uid del requester");
      let sqlUid = `
        SELECT ${FULL_COLUMNS}
        FROM users u
        LEFT JOIN roles r ON r.user_id = u.id
        WHERE u.uid = ?
      `;
      const paramsUid = [req.firebaseUser.uid];
      if (restrictByEstado) {
        sqlUid += " AND u.estado = ? ";
        paramsUid.push(requester.estado);
      }
      const respUid = await db.query(sqlUid, paramsUid);
      rows = respUid[0] || [];
    }

    if (!rows.length) {
      const msg = restrictByEstado
        ? "Usuario no encontrado o fuera de tu alcance"
        : "Usuario no encontrado";
      console.warn("ℹ️ getByUserId vacío:", { requestedUserId, restrictByEstado });
      return res.status(404).json({ error: msg });
    }

    const user = rows[0];
    console.log("✅ getByUserId OK → campos devueltos:", Object.keys(user));
    return res.json(user);
  } catch (err) {
    console.error("❌ getByUserId error:", err);
    return res.status(500).json({ error: err.message || "Error al obtener usuario" });
  }
};

/**
 * PUT /users/:userId
 * Reglas:
 * - Aspirante solo puede editar su propio perfil
 * - Admin/mod pueden editar cualquier perfil
 * Se bloquean campos sensibles: id, matricula, uid, correo, estado_validacion
 */
exports.update = async (req, res) => {
  const targetUserId = req.params.userId;
  const loggedUser = req.user;
  const body = { ...req.body };

  // Aspirante solo su propio perfil
  if (loggedUser.rol === "aspirante" && String(targetUserId) !== String(loggedUser.id)) {
    return res.status(403).json({ error: "No tienes permiso para modificar este perfil" });
  }

  // Campos bloqueados pase lo que pase
  delete body.id;
  delete body.matricula;
  delete body.uid;
  delete body.correo;
  delete body.estado_validacion;

  // Mapa de llaves “API” -> columnas reales en la tabla `users`
  const FIELD_MAP = {
    nombre: "nombre",
    apellido_paterno: "apellido_pat",
    apellido_materno: "apellido_mat",
    fecha_nacimiento: "fecha_nacimiento",
    curp: "curp",
    sexo: "sexo",
    estado_civil: "estado_civil",
    telefono: "telefono",
    celular: "celular",
    emergencia_nombre: "emergencia_nombre",
    emergencia_relacion: "emergencia_relacion",
    emergencia_telefono: "emergencia_telefono",
    emergencia_celular: "emergencia_celular",
    grado_estudios: "grado_estudios",
    especifica_estudios: "especifica_estudios",
    ocupacion: "ocupacion",
    empresa: "empresa",
    idiomas: "idiomas",
    porcentaje_idioma: "porcentaje_idioma",
    licencias: "licencias",
    tipo_licencia: "tipo_licencia",
    pasaporte: "pasaporte",
    otro_documento: "otro_documento",
    tipo_sangre: "tipo_sangre",
    rh: "rh",
    enfermedades: "enfermedades",
    alergias: "alergias",
    medicamentos: "medicamentos",
    ejercicio: "ejercicio",
    como_se_entero: "como_se_entero",
    motivo_interes: "motivo_interes",
    voluntariado_previo: "voluntariado_previo",
    razon_proyecto: "razon_proyecto",
    estado: "estado",
    colonia: "colonia",
    codigo_postal: "codigo_postal",
    coordinacion: "coordinacion",
    // Si más adelante agregas campos nuevos, mapea aquí:
    // nuevo_campo_api: "columna_real",
  };

  // Construir whitelist a partir del mapa
  const allowedApiKeys = Object.keys(FIELD_MAP);

  // Filtrar solo llaves permitidas y mapear a columnas reales
  const entries = Object.entries(body).filter(([k]) => allowedApiKeys.includes(k));

  if (!entries.length) {
    return res.status(400).json({
      error: "No se enviaron campos válidos para actualizar",
    });
  }

  // Normalizaciones ligeras (opcional)
  const normalize = (k, v) => {
    if (v === "") return null; // vacíos a NULL
    if (k === "curp" && typeof v === "string") return v.trim().toUpperCase();
    if (k === "fecha_nacimiento" && typeof v === "string") return v.trim(); // espera YYYY-MM-DD
    return v;
  };

  // SET y valores
  const setClauses = [];
  const values = [];

  for (const [apiKey, val] of entries) {
    const column = FIELD_MAP[apiKey];
    setClauses.push(`${column} = ?`);
    values.push(normalize(apiKey, val));
  }

  values.push(targetUserId);

  try {
    // Verificar existencia
    const [existingUser] = await db.query("SELECT id FROM users WHERE id = ?", [targetUserId]);
    if (!Array.isArray(existingUser) || existingUser.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const sql = `UPDATE users SET ${setClauses.join(", ")} WHERE id = ?`;
    await db.query(sql, values);

    return res.json({ message: "Perfil actualizado correctamente" });
  } catch (err) {
    console.error("❌ update error:", err);
    return res.status(500).json({ error: err.message || "Error al actualizar usuario" });
  }
};

exports.setCoordinaciones = async (req, res) => {
  try {
    const targetUserId = String(req.params.userId || "").trim();
    let { coordinacion, coordinacion2 } = req.body || {};

    if (!targetUserId) {
      return res.status(400).json({ error: "userId inválido" });
    }

    // Auth context (asumimos que un middleware ya llenó req.user)
    const requester = req.user || {};
    const isSelf = String(requester.id) === targetUserId;
    const rol = (requester.rol || "").toLowerCase();
    const isAdminOrMod = rol === "admin" || rol === "moderador";

    if (!isSelf && !isAdminOrMod) {
      return res.status(403).json({ error: "Sin permiso" });
    }

    // Normaliza inputs
    const norm = (v) => String(v || "").trim().toUpperCase();
    coordinacion = norm(coordinacion);
    coordinacion2 = norm(coordinacion2);

    const VALID = ["CAP", "COM", "APS", "MIG", "PREV", "RDR", "VOL"];
    const valid = (k) => VALID.includes(k);

    // Deben ser dos y distintas
    if (!valid(coordinacion) || !valid(coordinacion2) || coordinacion === coordinacion2) {
      return res.status(400).json({ error: "Debes elegir dos áreas válidas y distintas" });
    }

    // Trae estatus y elecciones actuales
    const [rows] = await db.query(
      "SELECT estatus, coordinacion AS c1, coordinacion2 AS c2 FROM users WHERE id = ?",
      [targetUserId]
    );
    if (!rows?.length) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    const { estatus, c1, c2 } = rows[0];
    const isActive = String(estatus || "").toLowerCase() === "activo";

    // Solo usuarios ACTIVO pueden elegir (admin/mod puede forzar)
    if (!isActive && !isAdminOrMod) {
      return res.status(403).json({ error: "Tu perfil no está activo" });
    }

    // Inmutables para aspirante (si ya tenía), salvo admin/mod
    const already = !!(c1 || c2);
    if (already && !isAdminOrMod) {
      return res.status(409).json({
        error: "Ya tienes áreas registradas. Solicita cambio a un administrador.",
      });
    }

    // Guarda
    await db.query(
      "UPDATE users SET coordinacion = ?, coordinacion2 = ? WHERE id = ?",
      [coordinacion, coordinacion2, targetUserId]
    );

    return res.json({
      message: "Coordinaciones guardadas",
      coordinacion,
      coordinacion2,
    });
  } catch (err) {
    console.error("setCoordinaciones error:", err);
    return res.status(500).json({ error: "Error al guardar coordinaciones" });
  }
};
