const admin = require("firebase-admin");
const db = require("../config/db");

// Registro de usuario (ya lo tenías)
exports.registerUser = (req, res) => {
  const data = req.body;

  // Extraer campos desde camelCase
  const {
    uid,
    correo,
    nombre,
    apellidoPat,
    apellidoMat,
    fechaNacimiento,
    curp,
    sexo,
    estadoCivil,
    telefono,
    celular,
    emergenciaNombre,
    emergenciaRelacion,
    emergenciaTelefono,
    emergenciaCelular,
    gradoEstudios,
    especificaEstudios,
    ocupacion,
    empresa,
    idiomas,
    porcentajeIdioma,
    licencias,
    tipoLicencia,
    pasaporte,
    otroDocumento,
    tipoSangre,
    rh,
    enfermedades,
    alergias,
    medicamentos,
    ejercicio,
    comoSeEntero,
    motivoInteres,
    voluntariadoPrevio,
    razonProyecto,
    estado,
    colonia,
    cp, // Código postal
    coordinacion
  } = data;

  if (!uid || !correo || !curp) {
    return res.status(400).json({ error: "Faltan campos obligatorios (uid, correo, curp)" });
  }

  const sqlInsertUser = `
    CALL insertar_usuario(
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `;

  const paramsUser = [
    uid,
    correo,
    nombre || null,
    apellidoPat || null,
    apellidoMat || null,
    fechaNacimiento || null,
    curp,
    sexo || null,
    estadoCivil || null,
    telefono || null,
    celular || null,
    emergenciaNombre || null,
    emergenciaRelacion || null,
    emergenciaTelefono || null,
    emergenciaCelular || null,
    gradoEstudios || null,
    especificaEstudios || null,
    ocupacion || null,
    empresa || null,
    idiomas || null,
    porcentajeIdioma || null,
    licencias || null,
    tipoLicencia || null,
    pasaporte || null,
    otroDocumento || null,
    tipoSangre || null,
    rh || null,
    enfermedades || null,
    alergias || null,
    medicamentos || null,
    ejercicio || null,
    comoSeEntero || null,
    motivoInteres || null,
    voluntariadoPrevio || null,
    razonProyecto || null,
    estado || null,
    colonia || null,
    cp || null,
    coordinacion || null
  ];

  db.query(sqlInsertUser, paramsUser, (err, results) => {
    if (err) {
      console.error("❌ Error en registro:", err);
      return res.status(500).json({ error: err.message || "Error al registrar usuario" });
    }

    const newUserId = results[0][0]?.id;
    if (!newUserId) {
      return res.status(500).json({ error: "No se pudo obtener el ID del nuevo usuario" });
    }

    const sqlInsertRole = `CALL insertar_rol_por_defecto(?)`;

    db.query(sqlInsertRole, [newUserId], (err2) => {
      if (err2) {
        console.error("❌ Error al asignar rol por defecto:", err2.message);
        return res.status(500).json({ error: "Usuario creado pero fallo al asignar rol" });
      }

      res.status(201).json({
        message: "Usuario registrado correctamente con rol aspirante",
        usuario: results[0][0]
      });
    });
  });
};


// Validar usuario con token Firebase y UID, devolver info interna

exports.validarUsuario = (req, res) => {
  const { id, estado, rol } = req.user;

  const sql = `
    SELECT u.id, u.nombre, u.apellido_pat, u.apellido_mat, r.nombre_rol AS rol, u.estado
    FROM users u
    JOIN roles r ON r.user_id = u.id
    WHERE u.id = ?
    LIMIT 1
  `;

  db.query(sql, [id], (err, results) => {
    if (err) {
      console.error("❌ Error en BD:", err.message);
      return res.status(500).json({ error: "Error al obtener datos del usuario" });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json(results[0]);
  });
};