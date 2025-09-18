// controllers/inscripciones.controller.js
const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");

const DEBUG_INSCR = process.env.DEBUG_INSCR === "1"; // o true durante pruebas
const COLLATION = "utf8mb4_0900_ai_ci"; // definido por consistencia

// ====== Mapa de nombres → código de curso (se usa en guardarFinalAprobado y para “bonito” en progreso) ======
const COURSE_CODE_MAP = {
  "Primeros Auxilios": "PA",
  "Inducción a los Desastres": "ID",
  "Inducción a la Cruz Roja Mexicana": "CRM",
  "Regulación de emociones": "RE",
  "Acceso más Seguro": "AS",
};

// Inverso: código → nombre (para respuesta legible en progreso)
const CODE_TO_NAME_MAP = Object.fromEntries(
  Object.entries(COURSE_CODE_MAP).map(([nombre, codigo]) => [codigo, nombre])
);

function nombreToCodigo(nombre = "") {
  const code = COURSE_CODE_MAP[String(nombre).trim()];
  if (!code) throw new Error("Nombre de curso no reconocido");
  return code;
}

// ====== Helper: autoriza ADMIN/MOD ======
function isAdminOrModerator(req) {
  const roles = []
    .concat(req.user?.roles || [])
    .concat(req.user?.role ? [req.user.role] : [])
    .concat(req.user?.rol ? [req.user.rol] : [])
    .map((r) => String(r || "").toLowerCase());

  return roles.includes("admin") || roles.includes("moderador") || roles.includes("moderator");
}

// ====== ENDPOINT ya existente: registrar final/aprobado ======
exports.guardarFinalAprobado = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const { curso_nombre, calificacion, duracion } = req.body || {};

    if (DEBUG_INSCR) {
      console.info("➡️ [guardarFinalAprobado] input", {
        userId,
        body: req.body,
        authClaims: req.user,
        headers: {
          "content-type": req.headers["content-type"],
          "user-agent": req.headers["user-agent"],
          "x-forwarded-for": req.headers["x-forwarded-for"],
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

    // Regla de aprobación mínima 8.0
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
        id,
        userId,
        cursoCodigo,
        cal,
        dur,
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
    const msg = /no reconocido/i.test(err.message) ? "Curso inválido" : "Error interno al guardar inscripción";
    return res.status(500).json({ error: msg });
  }
};

// ====== Helpers y endpoints para certificados/reconocimientos ======

/**
 * Trae la última finalización (por fecha_finalizacion DESC) del user/curso.
 * Devuelve: { fullName, fecha_finalizacion, curso_id, calificacion }
 */
async function queryCertData(dbConn, userIdRaw, cursoIdRaw) {
  const userId = String(userIdRaw).trim();
  const cursoId = String(cursoIdRaw).trim().toUpperCase();

  const sql = `
    SELECT
      u.nombre, u.apellido_pat, u.apellido_mat,
      i.fecha_finalizacion, i.curso_id, i.calificacion
    FROM inscripciones i
    INNER JOIN users u
      ON BINARY u.id = BINARY i.user_id
    WHERE BINARY i.user_id = BINARY ?
      AND BINARY i.curso_id = BINARY ?
    ORDER BY i.fecha_finalizacion DESC
    LIMIT 1
  `;

  const [rows] = await dbConn.query(sql, [userId, cursoId]);
  if (!rows || rows.length === 0) return null;

  const r = rows[0];
  const fullName = [r.nombre, r.apellido_pat, r.apellido_mat]
    .filter(Boolean).join(" ").replace(/\s+/g, " ").trim();

  return {
    fullName,
    fecha_finalizacion: r.fecha_finalizacion,
    curso_id: r.curso_id,
    calificacion: Number(r.calificacion),
  };
}

/**
 * GET /inscripciones/me/:cursoId/cert-data
 * Toma el userId de req.user.id
 */
exports.getCertDataForMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { cursoId } = req.params;
    if (!userId || !cursoId) {
      return res.status(400).json({ error: "Faltan userId o cursoId" });
    }

    const data = await queryCertData(db, userId, cursoId);
    if (!data) return res.status(404).json({ error: "No hay finalización registrada para ese curso." });

    const { fullName, fecha_finalizacion, curso_id } = data;
    return res.json({ fullName, fecha_finalizacion, curso_id });
  } catch (e) {
    console.error("getCertDataForMe error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
};

/**
 * GET /inscripciones/:userId/:cursoId/cert-data
 * Versión para pasar userId explícito (útil en admin)
 */
exports.getCertDataByUser = async (req, res) => {
  try {
    const { userId, cursoId } = req.params;
    if (!userId || !cursoId) {
      return res.status(400).json({ error: "Faltan userId o cursoId" });
    }

    const data = await queryCertData(db, userId, cursoId);
    if (!data) return res.status(404).json({ error: "No hay finalización registrada para ese curso." });

    const { fullName, fecha_finalizacion, curso_id } = data;
    return res.json({ fullName, fecha_finalizacion, curso_id });
  } catch (e) {
    console.error("getCertDataByUser error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
};

/**
 * ✅ GET /inscripciones/me/completed-count
 * Cuenta cursos “aprobados/finalizados” del usuario autenticado.
 * Regla: COUNT(DISTINCT curso_id) con fecha_finalizacion IS NOT NULL y calificacion >= 8.0
 */
exports.getCompletedCountForMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const sql = `
      SELECT COUNT(DISTINCT i.curso_id) AS total
      FROM inscripciones i
      WHERE BINARY i.user_id = BINARY ?
        AND i.fecha_finalizacion IS NOT NULL
        AND i.calificacion >= 8.0
    `;

    const [rows] = await db.query(sql, [String(userId).trim()]);
    const total = rows?.[0]?.total ?? 0;

    return res.json({ total });
  } catch (e) {
    console.error("getCompletedCountForMe error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
};

// ====== NUEVO: Progreso por usuario (para ADMIN/MOD) y para “me” ======

/**
 * Devuelve último intento por curso + resumen (promedio, #aprobados) para un usuario.
 */
async function queryProgresoUltimosIntentos(dbConn, userIdRaw) {
  const userId = String(userIdRaw).trim();

  // Traer nombre completo del usuario
  const [urows] = await dbConn.query(
    `SELECT nombre, apellido_pat, apellido_mat FROM users WHERE BINARY id = BINARY ? LIMIT 1`,
    [userId]
  );
  const fullName = urows?.[0]
    ? [urows[0].nombre, urows[0].apellido_pat, urows[0].apellido_mat]
        .filter(Boolean).join(" ").replace(/\s+/g, " ").trim()
    : "";

  // Último intento por curso (por fecha_finalizacion más reciente)
  const sql = `
    SELECT i.curso_id, i.calificacion, i.fecha_finalizacion, i.duracion
    FROM inscripciones i
    INNER JOIN (
      SELECT user_id, curso_id, MAX(fecha_finalizacion) AS last_finish
      FROM inscripciones
      WHERE BINARY user_id = BINARY ?
      GROUP BY user_id, curso_id
    ) last
      ON BINARY last.user_id = BINARY i.user_id
      AND BINARY last.curso_id = BINARY i.curso_id
      AND last.last_finish = i.fecha_finalizacion
    WHERE BINARY i.user_id = BINARY ?
    ORDER BY i.fecha_finalizacion DESC
  `;

  const [rows] = await dbConn.query(sql, [userId, userId]);

  const cursos = (rows || []).map((r) => {
    const calNum = r.calificacion != null ? Number(Number(r.calificacion).toFixed(2)) : null;
    return {
      codigo: r.curso_id,
      nombre: CODE_TO_NAME_MAP[r.curso_id] || r.curso_id,
      calificacion: calNum,
      fecha_finalizacion: r.fecha_finalizacion,
      duracion: r.duracion ?? null,
      aprobado: calNum != null ? calNum >= 8.0 : false,
    };
  });

  const califsValidas = cursos
    .map((c) => (typeof c.calificacion === "number" ? c.calificacion : null))
    .filter((v) => v != null);

  const promedio = califsValidas.length
    ? Number((califsValidas.reduce((a, b) => a + b, 0) / califsValidas.length).toFixed(2))
    : null;

  const aprobados = cursos.filter((c) => c.aprobado).length;

  return {
    fullName,
    cursos,
    resumen: {
      total_cursos: cursos.length,
      aprobados,
      promedio,
    },
  };
}

/**
 * ✅ GET /inscripciones/:userId/progreso  (SOLO ADMIN/MOD)
 */
exports.getProgresoByUserForAdmins = async (req, res) => {
  try {
    if (!isAdminOrModerator(req)) {
      return res.status(403).json({ error: "No autorizado (se requiere rol admin o moderador)." });
    }
    const { userId } = req.params;
    if (!userId) return res.status(400).json({ error: "Falta userId" });

    const data = await queryProgresoUltimosIntentos(db, userId);
    return res.json({
      user_id: String(userId).trim(),
      nombre_completo: data.fullName,
      resumen: data.resumen,
      cursos: data.cursos,
    });
  } catch (e) {
    console.error("getProgresoByUserForAdmins error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
};

/**
 * ✅ GET /inscripciones/me/progreso  (para que el propio usuario vea su progreso)
 */
exports.getProgresoForMe = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const data = await queryProgresoUltimosIntentos(db, userId);
    return res.json({
      user_id: String(userId).trim(),
      nombre_completo: data.fullName,
      resumen: data.resumen,
      cursos: data.cursos,
    });
  } catch (e) {
    console.error("getProgresoForMe error:", e);
    return res.status(500).json({ error: "Error interno" });
  }
};
