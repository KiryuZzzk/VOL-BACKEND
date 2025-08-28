// inscripciones.controller.js
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");

const DEBUG_INSCR = process.env.DEBUG_INSCR === "1"; // o true duro mientras pruebas

// Mapa de nombres → código de curso
const COURSE_CODE_MAP = {
  "Primeros Auxilios": "PA",
  "Inducción a los Desastres": "ID",
  "Inducción a la Cruz Roja Mexicana": "CRM",
  "Regulación de emociones": "RE",
};

function nombreToCodigo(nombre = "") {
  const code = COURSE_CODE_MAP[String(nombre).trim()];
  if (!code) throw new Error("Nombre de curso no reconocido");
  return code;
}

exports.guardarFinalAprobado = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { curso_nombre, calificacion, duracion } = req.body || {};

    if (DEBUG_INSCR) {
      console.info("➡️ [guardarFinalAprobado] input", {
        userId,
        body: req.body,
        // OJO: no loguees el token completo en producción
        authClaims: req.user, // si aquí guardas claims útiles del JWT
        headers: {
          'content-type': req.headers['content-type'],
          'user-agent': req.headers['user-agent'],
          'x-forwarded-for': req.headers['x-forwarded-for'],
        },
      });
    }

    if (!curso_nombre || typeof calificacion !== "number") {
      return res.status(400).json({
        error: "Datos incompletos",
        ...(DEBUG_INSCR && { recibido: { curso_nombre, calificacion, duracion } }),
      });
    }

    let cursoCodigo;
    try {
      cursoCodigo = nombreToCodigo(curso_nombre);
    } catch (e) {
      if (DEBUG_INSCR) {
        return res.status(400).json({
          error: "Curso inválido",
          recibido: curso_nombre,
          aceptados: Object.keys(COURSE_CODE_MAP),
        });
      }
      return res.status(500).json({ error: "Curso inválido" });
    }

    const cal = Number(calificacion.toFixed(2));
    const dur = Number.isInteger(duracion) ? duracion : 0;

    if (cal < 8.0) {
      if (DEBUG_INSCR) {
        console.info("ℹ️ [guardarFinalAprobado] cal < 8.0 → no se registra", { cal });
      }
      return res.status(200).json({
        message: "Calificación inferior a 8.0, no se registra aprobación",
        aprobado: false,
      });
    }

    const id = uuidv4();
    const sql = `
      INSERT INTO inscripciones (id, user_id, curso_id, calificacion, fecha_inscripcion, fecha_finalizacion, duracion)
      VALUES (?, ?, ?, ?, NOW(), NOW(), ?)
      ON DUPLICATE KEY UPDATE
        calificacion = VALUES(calificacion),
        fecha_finalizacion = VALUES(fecha_finalizacion),
        duracion = GREATEST(duracion, VALUES(duracion))
    `;

    if (DEBUG_INSCR) {
      console.info("📝 [guardarFinalAprobado] UPSERT params", {
        id, userId, cursoCodigo, cal, dur
      });
    }

    await db.query(sql, [id, userId, cursoCodigo, cal, dur]);

    return res.status(201).json({
      message: "Inscripción/Finalización registrada",
      aprobado: true,
      data: { user_id: userId, curso_id: cursoCodigo, calificacion: cal, duracion: dur },
      ...(DEBUG_INSCR && { recibido: { curso_nombre } }),
    });
  } catch (err) {
    console.error("❌ guardarFinalAprobado:", err);
    const msg = /no reconocido/i.test(err.message)
      ? "Curso inválido"
      : "Error interno al guardar inscripción";
    return res.status(500).json({ error: msg });
  }
};
