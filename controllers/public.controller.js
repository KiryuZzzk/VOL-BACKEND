const admin = require("firebase-admin");
const db = require("../config/db");
const crypto = require("crypto");

function genMatricula10() {
  // 10 chars; cámbialo si tú quieres otro formato
  return crypto.randomBytes(6).toString("hex").slice(0, 10).toUpperCase();
}

exports.registerUser = async (req, res) => {
  let connection = null;
  let firebaseUser = null;

  try {
    const data = req.body;

    const {
      // cuenta
      correo,
      contraseña,

      // legales
      avisoPrivacidad,
      terminosyCondiciones,

      // personales
      nombre,
      apellidoPat,
      apellidoMat,
      fechaNacimiento,
      curp,
      sexo,
      estadoCivil,
      telefono,
      celular,

      // emergencia
      emergenciaNombre,
      emergenciaRelacion,
      emergenciaTelefono,
      emergenciaCelular,

      // estudios/trabajo
      gradoEstudios,
      especificaEstudios,
      ocupacion,
      empresa,
      idiomas,
      porcentajeIdioma,

      // docs/licencias
      licencias,
      tipoLicencia,
      pasaporte,
      otroDocumento,

      // salud
      tipoSangre,
      rh,
      enfermedades,
      alergias,
      medicamentos,
      ejercicio,

      // motivación
      comoSeEntero,
      motivoInteres,
      voluntariadoPrevio,
      razonProyecto,

      // ubicación
      estado,
      colonia,
      cp,

      // coordinacion (la guardo porque tu tabla sí la tiene)
      coordinacion,

      // fecha del front (si viene)
      fecha,
    } = data;

    // ✅ Validaciones mínimas
    if (!correo || !contraseña) {
      return res.status(400).json({
        code: "REQUIRED_FIELDS",
        field: "correo",
        message: "Correo y contraseña son obligatorios.",
      });
    }

    if (!avisoPrivacidad || !terminosyCondiciones) {
      return res.status(400).json({
        code: "LEGAL_REQUIRED",
        message:
          "Debes aceptar el aviso de privacidad y los términos y condiciones.",
      });
    }

    // ✅ Bloquea SOLO correo duplicado (Firebase también lo hará)
    const [existingRows] = await db.query(
      `SELECT id FROM users WHERE correo = ? LIMIT 1`,
      [correo]
    );
    if (existingRows.length) {
      return res.status(409).json({
        code: "EMAIL_EXISTS",
        field: "correo",
        message: "Ya existe una cuenta registrada con este correo.",
      });
    }

    // ✅ Crear usuario en Firebase
    firebaseUser = await admin.auth().createUser({
      email: correo,
      password: contraseña,
    });

    // ✅ Insert en MySQL (sin SP)
    connection = await db.getConnection();
    await connection.beginTransaction();

    const id = crypto.randomUUID(); // char(36)
    const uid = firebaseUser.uid;
    const matricula = genMatricula10();

    // OJO: tu tabla dice fecha_nacimiento DATE y fecha_registro DATETIME
    const fechaRegistro = fecha ? new Date(fecha) : new Date();

    await connection.query(
      `
      INSERT INTO users (
        id, uid, matricula, correo,
        nombre, apellido_pat, apellido_mat,
        fecha_nacimiento, curp, sexo, estado_civil,
        telefono, celular,
        emergencia_nombre, emergencia_relacion, emergencia_telefono, emergencia_celular,
        grado_estudios, especifica_estudios,
        ocupacion, empresa,
        idiomas, porcentaje_idioma,
        licencias, tipo_licencia, pasaporte, otro_documento,
        tipo_sangre, rh,
        enfermedades, alergias, medicamentos, ejercicio,
        como_se_entero, motivo_interes, voluntariado_previo, razon_proyecto,
        estado_validacion, fecha_registro,
        estado, colonia, codigo_postal,
        coordinacion, coordinacion2, estatus
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      [
        id, uid, matricula, correo,
        nombre ?? null, apellidoPat ?? null, apellidoMat ?? null,
        fechaNacimiento || null, curp ?? null, sexo ?? null, estadoCivil ?? null,
        telefono ?? null, celular ?? null,
        emergenciaNombre ?? null, emergenciaRelacion ?? null, emergenciaTelefono ?? null, emergenciaCelular ?? null,
        gradoEstudios ?? null, especificaEstudios ?? null,
        ocupacion ?? null, empresa ?? null,
        idiomas ?? null, porcentajeIdioma ?? null,
        licencias ?? null, tipoLicencia ?? null, pasaporte ?? null, otroDocumento ?? null,
        tipoSangre ?? null, rh ?? null,
        enfermedades ?? null, alergias ?? null, medicamentos ?? null, ejercicio ?? null,
        comoSeEntero ?? null, motivoInteres ?? null, voluntariadoPrevio ?? null, razonProyecto ?? null,
        "inactivo", fechaRegistro,
        estado ?? null, colonia ?? null, cp ?? null,
        coordinacion ?? null, null, null,
      ]
    );

    await connection.commit();
    connection.release();

    return res.status(201).json({
      ok: true,
      message: "Registro exitoso.",
      uid,
      userId: id,
      matricula,
    });
  } catch (error) {
    console.error("❌ Error en registerUser:", error);

    if (connection) {
      try {
        await connection.rollback();
        connection.release();
      } catch (e) {
        console.error("⚠️ Error al hacer rollback:", e);
      }
    }

    // Si Firebase ya se creó pero MySQL falló, lo borramos para no dejar basura
    if (firebaseUser?.uid) {
      try {
        await admin.auth().deleteUser(firebaseUser.uid);
      } catch (e) {
        console.error("⚠️ Error al borrar usuario Firebase:", e);
      }
    }

    const msg = error?.message || "";

    // Firebase: email ya existe
    if (msg.includes("auth/email-already-exists")) {
      return res.status(409).json({
        code: "EMAIL_EXISTS",
        field: "correo",
        message: "Ya existe una cuenta registrada con este correo.",
      });
    }

    return res.status(500).json({
      code: "REGISTER_ERROR",
      message: "Ocurrió un error al registrar tu cuenta. Inténtalo nuevamente.",
      error: msg,
    });
  }
};
