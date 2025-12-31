// controllers/public.controller.js
const admin = require("firebase-admin");
const db = require("../config/db"); // pool mysql2/promise

// ─────────────────────────────────────────────────────────────
// REGISTRO IDEAL
// - Front SOLO manda los datos (incluida contraseña)
// - Backend:
//   1) Valida datos mínimos
//   2) Verifica duplicados en BD (correo) antes de Firebase
//   3) Crea usuario en Firebase (Admin SDK)
//   4) Abre transacción MySQL -> CALL insertar_usuario + CALL insertar_rol_por_defecto
//   5) Si algo falla: ROLLBACK + deleteUser(uid) en Firebase
// ─────────────────────────────────────────────────────────────
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

      // resto de campos para SP
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
      cp,
      coordinacion,
    } = data;

    // 1) Validaciones básicas
    if (!correo || !contraseña || !curp) {
      return res.status(400).json({
        code: "MISSING_FIELDS",
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

    // 2) Verificar si ya existe en BD por CORREO (NO bloqueamos por CURP)
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

    // (Opcional) Detectar CURP duplicada sin bloquear (solo para logging)
    // Esto no detiene el registro; solo deja rastro en consola.
    const [curpRows] = await db.query(
      `SELECT id, curp 
       FROM users 
       WHERE curp = ?
       LIMIT 1`,
      [curp]
    );
    if (curpRows.length) {
      console.warn("⚠️ Registro con CURP duplicada (permitido):", curp);
    }

    // 3) Crear usuario en Firebase (Admin SDK)
    firebaseUser = await admin.auth().createUser({
      email: correo,
      password: contraseña,
      emailVerified: false,
      disabled: false,
    });

    const uid = firebaseUser.uid;
    console.log("👤 Usuario creado en Firebase:", uid);

    // 4) Abrir transacción MySQL
    connection = await db.getConnection();
    await connection.beginTransaction();

    // 5) Insertar usuario en BD con tu SP
    const [result] = await connection.query(
      `CALL insertar_usuario(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        cp,
        coordinacion,
      ]
    );

    const newUserId = result?.[0]?.[0]?.id;
    if (!newUserId) {
      throw new Error("No se pudo obtener el ID del nuevo usuario.");
    }

    // 6) Asignar rol por defecto en la misma transacción
    await connection.query(`CALL insertar_rol_por_defecto(?)`, [newUserId]);

    // 7) Commit y liberar conexión
    await connection.commit();
    connection.release();
    connection = null;

    console.log("✅ registerUser: usuario creado con id:", newUserId);

    return res.status(201).json({
      code: "REGISTER_OK",
      message: "Usuario registrado correctamente con rol aspirante.",
      usuario: {
        id: newUserId,
        uid,
        correo,
        nombre,
        apellidoPat,
        apellidoMat,
      },
    });
  } catch (err) {
    console.error("❌ Error en registro completo:", {
      message: err.message,
      code: err.code,
      errno: err.errno,
      sqlState: err.sqlState,
    });

    // Si hay transacción abierta, hacer rollback
    if (connection) {
      try {
        await connection.rollback();
      } catch (rollbackErr) {
        console.error("⚠️ Error haciendo rollback:", rollbackErr.message);
      }
      connection.release();
    }

    // Si ya se creó el usuario en Firebase pero la BD falló, borrarlo
    if (firebaseUser) {
      try {
        await admin.auth().deleteUser(firebaseUser.uid);
        console.log("🧹 Usuario Firebase eliminado por error en BD:", firebaseUser.uid);
      } catch (delErr) {
        console.error("⚠️ No se pudo borrar usuario Firebase:", delErr.message);
      }
    }

    // Mapear errores de Firebase
    if (err.code === "auth/email-already-exists") {
      return res.status(409).json({
        code: "EMAIL_EXISTS",
        field: "correo",
        message: "Ya existe una cuenta registrada con este correo.",
      });
    }

    if (err.code === "auth/invalid-password") {
      return res.status(400).json({
        code: "INVALID_PASSWORD",
        field: "contraseña",
        message: "La contraseña no cumple con los requisitos mínimos.",
      });
    }

    // Duplicados en BD (por si el SP o constraints revientan)
    if (err.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        code: "DB_DUPLICATE",
        message: "Ya existe un usuario con estos datos en la base de datos.",
      });
    }

    // Error genérico
    return res.status(500).json({
      code: "REGISTER_ERROR",
      message: err.message || "Error al registrar usuario.",
    });
  }
};

// ─────────────────────────────────────────────────────────────
// Validar usuario POR UID (usado con middleware authFirebase)
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
