// controllers/public.controller.js
const admin = require("firebase-admin");
const db = require("../config/db"); // pool directo, no getDB()

// ─────────────────────────────────────────────────────────────
// Registro normal (lo dejo igual que lo tenías)
// ─────────────────────────────────────────────────────────────
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
    console.warn("⛔ registerUser: faltan campos obligatorios", { uid: !!uid, correo: !!correo, curp: !!curp });
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
      console.error("❌ registerUser: no se pudo obtener el ID del nuevo usuario");
      return res.status(500).json({ error: "No se pudo obtener el ID del nuevo usuario" });
    }

    await db.query(`CALL insertar_rol_por_defecto(?)`, [newUserId]);

    console.log("✅ registerUser: usuario creado con id:", newUserId);
    return res.status(201).json({
      message: "Usuario registrado correctamente con rol aspirante",
      usuario: result[0][0]
    });

  } catch (err) {
    console.error("❌ Error en registro:", err);
    return res.status(500).json({ error: err.message || "Error al registrar usuario" });
  }
};

// ─────────────────────────────────────────────────────────────
// Validar usuario (AHORA por UID del token; middleware: authFirebase)
// Devuelve:
//  - 200 con user (rol puede ser null si aún no tiene)
//  - 404 si UID no existe en BD
//  - 401 si el token no trae UID (mal token)
// ─────────────────────────────────────────────────────────────
exports.validarUsuario = async (req, res) => {
  try {
    const uid = req.firebaseUser?.uid; // <-- viene de authFirebase
    if (!uid) {
      console.warn("⛔ validarUsuario: token sin UID");
      return res.status(401).json({ error: "Token sin UID" });
    }

    console.log("🔎 validarUsuario: consultando por UID:", uid);

    const [results] = await db.query(
      `SELECT 
         u.id, u.uid, u.nombre, u.apellido_pat, u.apellido_mat, u.estado, 
         r.id AS rol_id, r.nombre_rol
       FROM users u
       LEFT JOIN roles r ON r.user_id = u.id
       WHERE u.uid = ?
       LIMIT 1`,
      [uid]
    );

    if (!results.length) {
      console.warn("⚠️ validarUsuario: UID válido pero NO existe en BD:", uid);
      return res.status(404).json({ error: "Usuario no registrado en BD" });
    }

    const row = results[0];
    const user = {
      id: row.id,
      uid: row.uid,
      nombre: row.nombre,
      apellido_pat: row.apellido_pat,
      apellido_mat: row.apellido_mat,
      estado: row.estado,
      rol: row.rol_id
        ? { id: row.rol_id, user_id: row.id, nombre_rol: row.nombre_rol }
        : null, // toleramos usuario sin rol asignado
    };

    console.log("✅ validarUsuario: usuario encontrado:", {
      id: user.id,
      uid: user.uid,
      rol: user.rol?.nombre_rol || null,
    });

    return res.json(user);
  } catch (err) {
    console.error("❌ validarUsuario: error en BD:", err.message);
    return res.status(500).json({ error: "Error al obtener datos del usuario" });
  }
};
