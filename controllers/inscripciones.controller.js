const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");

// Mapa de nombres → código de curso
const COURSE_CODE_MAP = {
  "Primeros Auxilios": "PA",
  "Inducción a los Desastres": "ID",
  "Inducción a la Cruz Roja Mexicana": "CRM",
};

// Helper seguro
function nombreToCodigo(nombre = "") {
  const code = COURSE_CODE_MAP[String(nombre).trim()];
  if (!code) throw new Error("Nombre de curso no reconocido");
  return code;
}

/**
 * Body esperado:
 * {
 *   "curso_nombre": "Primeros Auxilios" | "Inducción a los Desastres" | "Inducción a la Cruz Roja Mexicana",
 *   "calificacion": 0..10 (decimal),
 *   "duracion": int (opcional, horas)
 * }
 * Reglas:
 * - Si calificacion >= 8.0 → upsert en `inscripciones`
 * - user_id se toma de req.user.id (ya autenticado)
 */
exports.guardarFinalAprobado = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { curso_nombre, calificacion, duracion } = req.body || {};
    if (!curso_nombre || typeof calificacion !== "number") {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const cursoCodigo = nombreToCodigo(curso_nombre);
    const cal = Number(calificacion.toFixed(2));
    const dur = Number.isInteger(duracion) ? duracion : 0;

    // Solo guardamos si es >= 8.0
    if (cal < 8.0) {
      return res.status(200).json({
        message: "Calificación inferior a 8.0, no se registra aprobación",
        aprobado: false,
      });
    }

    // UPSERT por (user_id, curso_id)
    const id = uuidv4();
    const sql = `
      INSERT INTO inscripciones (id, user_id, curso_id, calificacion, fecha_inscripcion, fecha_finalizacion, duracion)
      VALUES (?, ?, ?, ?, NOW(), NOW(), ?)
      ON DUPLICATE KEY UPDATE
        calificacion = VALUES(calificacion),
        fecha_finalizacion = VALUES(fecha_finalizacion),
        duracion = GREATEST(duracion, VALUES(duracion))
    `;

    await db.query(sql, [id, userId, cursoCodigo, cal, dur]);

    return res.status(201).json({
      message: "Inscripción/Finalización registrada",
      aprobado: true,
      data: { user_id: userId, curso_id: cursoCodigo, calificacion: cal, duracion: dur },
    });
  } catch (err) {
    console.error("❌ guardarFinalAprobado:", err);
    const msg = /no reconocido/i.test(err.message)
      ? "Curso inválido"
      : "Error interno al guardar inscripción";
    return res.status(500).json({ error: msg });
  }
};
