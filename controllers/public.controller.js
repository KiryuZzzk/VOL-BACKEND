// controllers/public.controller.js
const admin = require("firebase-admin");
const db = require("../config/db"); // pool directo, no getDB()

exports.registerUser = async (req, res) => {
  const data = req.body;

  const {
    uid, correo, nombre, apellidoPat, apellidoMat, fechaNacimiento,
    curp, sexo, estadoCivil, telefono, celular,
    emergenciaNombre, emergenciaRelacion, emergenciaTelefono, emergenciaCelular,
    gradoEstudios, especificaEstudios, ocupacion, empresa,
    idiomas, porcentajeIdioma, licencias, tipoLicencia, pasaporte, otroDocumento,
    tipoSangre, rh, enfermedades, alergias, medicamentos, ejercicio,
    comoSeEntero, motivoInteres, voluntariadoPrevio, razonProyecto,
    estado, colonia, cp, coordinacion
  } = data;

  if (!uid || !correo || !curp) {
    return res.status(400).json({ error: "Faltan campos obligatorios (uid, correo, curp)" });
  }

  try {
    const [result] = await db.query(
      `CALL insertar_usuario(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uid, correo, nombre, apellidoPat, apellidoMat, fechaNacimiento,
        curp, sexo, estadoCivil, telefono, celular,
        emergenciaNombre, emergenciaRelacion, emergenciaTelefono, emergenciaCelular,
        gradoEstudios, especificaEstudios, ocupacion, empresa,
        idiomas, porcentajeIdioma, licencias, tipoLicencia, pasaporte, otroDocumento,
        tipoSangre, rh, enfermedades, alergias, medicamentos, ejercicio,
        comoSeEntero, motivoInteres, voluntariadoPrevio, razonProyecto,
        estado, colonia, cp, coordinacion
      ]
    );

    const newUserId = result[0][0]?.id;
    if (!newUserId) {
      return res.status(500).json({ error: "No se pudo obtener el ID del nuevo usuario" });
    }

    await db.query(`CALL insertar_rol_por_defecto(?)`, [newUserId]);

    res.status(201).json({
      message: "Usuario registrado correctamente con rol aspirante",
      usuario: result[0][0]
    });

  } catch (err) {
    console.error("❌ Error en registro:", err);
    res.status(500).json({ error: err.message || "Error al registrar usuario" });
  }
};

exports.validarUsuario = async (req, res) => {
  const { id } = req.user;

  try {
    const [results] = await db.query(
      `SELECT u.id, u.nombre, u.apellido_pat, u.apellido_mat, r.nombre_rol AS rol, u.estado
       FROM users u
       JOIN roles r ON r.user_id = u.id
       WHERE u.id = ?
       LIMIT 1`,
      [id]
    );

    if (results.length === 0) {
      return res.status(404).json({ error: "Usuario no encontrado" });
    }

    res.json(results[0]);
  } catch (err) {
    console.error("❌ Error en BD:", err.message);
    res.status(500).json({ error: "Error al obtener datos del usuario" });
  }
};
