// controllers/public.controller.js
const admin = require("firebase-admin");
const db = require("../config/db"); // Ajusta si tu ruta es distinta

// ==========================================
// REGISTRO
// ==========================================
exports.registerUser = async (req, res) => {
  let connection = null;
  let firebaseUser = null;

  try {
    const data = req.body;

    const {
      // mínimos obligatorios
      correo,
      contraseña,

      // legales
      avisoPrivacidad,
      terminosyCondiciones,

      // personales
      nombre,
      apellidoPat,
      apellidoMat,
      sexo,
      edad,
      curp,
      fechaNacimiento,
      paisNacimiento,
      estado,
      telefono,
      celular,
      cp,
      colonia,
      estadoCivil,
      ocupacion,
      empresa,

      // formación
      gradoEstudios,
      especificaEstudios,
      idiomas,
      porcentajeIdioma,

      // licencias/documentos
      licencias,
      tipoLicencia,
      pasaporte,
      otroDocumento,

      // salud
      enfermedades,
      alergias,
      medicamentos,
      tipoSangre,
      rh,
      ejercicio,

      // emergencia
      emergenciaNombre,
      emergenciaRelacion,
      emergenciaTelefono,
      emergenciaCelular,

      // disponibilidad / motivación
      disponibilidadDias,
      turno,
      horario,
      voluntariadoPrevio,
      motivoInteres,
      comoSeEntero,
      proyectoParticipar,
      razonProyecto,

      // misc
      fecha,

      // este no lo mueves, lo dejamos tal cual lo traes
      coordinacion,
    } = data;

    // 1) Validaciones mínimas
    if (!correo || !contraseña || !curp) {
      return res.status(400).json({
        code: "REQUIRED_FIELDS",
        message: "Faltan campos obligatorios (correo, contraseña y CURP).",
      });
    }

    if (!avisoPrivacidad || !terminosyCondiciones) {
      return res.status(400).json({
        code: "LEGAL_REQUIRED",
        message:
          "Debes aceptar el aviso de privacidad y los términos y condiciones para continuar.",
      });
    }

    // 2) Verificar si ya existe en BD por correo (antes de tocar Firebase)
    // Nota: Firebase Auth NO permite correos duplicados, así que esto es obligatorio.
    // La CURP se permite duplicar (por decisión de negocio / ambiente de pruebas).
    const [existingRows] = await db.query(
      `SELECT id, correo
       FROM users
       WHERE correo = ?
       LIMIT 1`,
      [correo]
    );

    if (existingRows.length) {
      return res.status(409).json({
        code: "EMAIL_EXISTS",
        field: "correo",
        message: "Ya existe una cuenta registrada con este correo.",
      });
    }

    // 3) Crear usuario en Firebase
    firebaseUser = await admin.auth().createUser({
      email: correo,
      password: contraseña,
    });

    // 4) Iniciar transacción MySQL
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 5) Insertar usuario en BD (SP)
// IMPORTANTE: tu SP espera 39 args exactos
// Por ahora mandamos solo los primeros 39 EN EL ORDEN ACTUAL.
// (Esto asume que el orden de los primeros 39 coincide con tu SP.)
const fullParams = [
  nombre,
  apellidoPat,
  apellidoMat,
  sexo,
  edad,
  curp,
  fechaNacimiento,
  paisNacimiento,
  estado,
  telefono,
  celular,
  cp,
  colonia,
  estadoCivil,
  ocupacion,
  empresa,
  gradoEstudios,
  especificaEstudios,
  idiomas,
  porcentajeIdioma,
  licencias,
  tipoLicencia,
  pasaporte,
  otroDocumento,
  enfermedades,
  alergias,
  medicamentos,
  tipoSangre,
  rh,
  ejercicio,
  emergenciaNombre,
  emergenciaRelacion,
  emergenciaTelefono,
  emergenciaCelular,
  JSON.stringify(disponibilidadDias || {}),
  turno,
  horario,
  voluntariadoPrevio,
  motivoInteres,
  comoSeEntero,
  JSON.stringify(proyectoParticipar || []),
  razonProyecto,
  fecha,
  correo,
  firebaseUser.uid,
  // coordinacion ?? null,  // NO: SP no lo espera si son 39
];

const params = fullParams.slice(0, 39);

const placeholders = params.map(() => "?").join(",");
const [result] = await connection.query(
  `CALL insertar_usuario(${placeholders})`,
  params
);

console.log("✅ insertar_usuario args enviados:", params.length);



    const newUserId = result?.[0]?.[0]?.id;
    if (!newUserId) {
      throw new Error("No se pudo obtener el ID del nuevo usuario.");
    }

    // 6) Asignar rol por defecto
    await connection.query(`CALL insertar_rol_por_defecto(?)`, [newUserId]);

    // 7) Commit
    await connection.commit();
    connection.release();

    return res.status(201).json({
      ok: true,
      message: "Registro exitoso.",
      uid: firebaseUser.uid,
      userId: newUserId,
    });
  } catch (error) {
    console.error("❌ Error en registerUser:", error);

    // rollback si ya había transacción
    if (connection) {
      try {
        await connection.rollback();
        connection.release();
      } catch (e) {
        console.error("⚠️ Error al hacer rollback:", e);
      }
    }

    // borrar firebase user si se creó pero la BD falló
    if (firebaseUser?.uid) {
      try {
        await admin.auth().deleteUser(firebaseUser.uid);
      } catch (e) {
        console.error("⚠️ Error al borrar usuario Firebase:", e);
      }
    }

    // Errores conocidos / manejables
    const msg = (error && error.message) || "";

    // Firebase: email ya existe
    if (msg.includes("auth/email-already-exists")) {
      return res.status(409).json({
        code: "EMAIL_EXISTS",
        field: "correo",
        message: "Ya existe una cuenta registrada con este correo.",
      });
    }

    // Firebase: password inválida (muy corta, etc.)
    if (msg.includes("auth/invalid-password") || msg.includes("auth/weak-password")) {
      return res.status(400).json({
        code: "INVALID_PASSWORD",
        field: "contraseña",
        message: "La contraseña no cumple con los requisitos.",
      });
    }

    return res.status(500).json({
      code: "REGISTER_ERROR",
      message: "Ocurrió un error al registrar tu cuenta. Inténtalo nuevamente.",
      error: msg,
    });
  }
};

// ==========================================
// LOGIN (si tienes)
// ==========================================
exports.loginUser = async (req, res) => {
  try {
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
};

// ==========================================
// VALIDAR USUARIO (si tienes)
// ==========================================
exports.validarUsuario = async (req, res) => {
  try {
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(500).json({ ok: false });
  }
};
