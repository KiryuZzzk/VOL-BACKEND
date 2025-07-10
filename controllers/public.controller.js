const admin = require("firebase-admin");
const db = require("../config/db");

// Registro de usuario (ya lo tenías)
exports.registerUser = (req, res) => {
  const {
    uid,
    correo,
    nombre,
    apellido_pat,
    apellido_mat,
    fecha_nacimiento,
    curp,
    sexo,
    estado_civil,
    telefono,
    celular,
    emergencia_nombre,
    emergencia_relacion,
    emergencia_telefono,
    emergencia_celular,
    grado_estudios,
    especifica_estudios,
    ocupacion,
    empresa,
    idiomas,
    porcentaje_idioma,
    licencias,
    tipo_licencia,
    pasaporte,
    otro_documento,
    tipo_sangre,
    rh,
    enfermedades,
    alergias,
    medicamentos,
    ejercicio,
    como_se_entero,
    motivo_interes,
    voluntariado_previo,
    razon_proyecto,
    estado,
    colonia,
    codigo_postal,
    coordinacion
  } = req.body;

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
    apellido_pat || null,
    apellido_mat || null,
    fecha_nacimiento || null,
    curp,
    sexo || null,
    estado_civil || null,
    telefono || null,
    celular || null,
    emergencia_nombre || null,
    emergencia_relacion || null,
    emergencia_telefono || null,
    emergencia_celular || null,
    grado_estudios || null,
    especifica_estudios || null,
    ocupacion || null,
    empresa || null,
    idiomas || null,
    porcentaje_idioma || null,
    licencias || null,
    tipo_licencia || null,
    pasaporte || null,
    otro_documento || null,
    tipo_sangre || null,
    rh || null,
    enfermedades || null,
    alergias || null,
    medicamentos || null,
    ejercicio || null,
    como_se_entero || null,
    motivo_interes || null,
    voluntariado_previo || null,
    razon_proyecto || null,
    estado || null,
    colonia || null,
    codigo_postal || null,
    coordinacion || null
  ];

  db.query(sqlInsertUser, paramsUser, (err, results) => {
if (err) {
  console.error("❌ Error en registro:", err);
  return res.status(500).json({ error: err.message || "Error al registrar usuario" });
}

    // El stored procedure devuelve en results[0][0] el id y matricula
    const newUserId = results[0][0]?.id;
    if (!newUserId) {
      return res.status(500).json({ error: "No se pudo obtener el ID del nuevo usuario" });
    }

    // Ahora llamamos al procedimiento para insertar el rol por defecto
    const sqlInsertRole = `CALL insertar_rol_por_defecto(?)`;

    db.query(sqlInsertRole, [newUserId], (err2) => {
      if (err2) {
        console.error("❌ Error al asignar rol por defecto:", err2.message);
        return res.status(500).json({ error: "Usuario creado pero fallo al asignar rol" });
      }

      // Todo salió bien
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