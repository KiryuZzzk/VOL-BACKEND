const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");

/** Campos esperados en tabla `documentos` */
const DOC_COLS = `
  curp_url, curp_aprobado, curp_estado,
  acta_nacimiento_url, acta_nacimiento_aprobado, acta_nacimiento_estado,
  ine_url, ine_aprobado, ine_estado,
  cv_url, cv_aprobado, cv_estado,
  nss_url, nss_aprobado, nss_estado,
  constancia_url, constancia_aprobado, constancia_estado,
  foto_url, foto_aprobado, foto_estado,
  certificado_medico_url, certificado_medico_aprobado, certificado_medico_estado,
  sobre_mi,
  fecha_creacion,
  ultima_actualizacion
`;

/** Util: mezcla info de usuario + documentos en un objeto “plano” */
function mergeUserAndDocs(userRow = {}, docsRow = {}) {
  const out = {
    id: userRow.id,
    matricula: userRow.matricula,
    curp: userRow.curp,
    correo: userRow.correo,
    ...docsRow,
  };

  // ✅ Normaliza solo los aprobados (boolean). NO toques *_estado.
  [
    "curp_aprobado",
    "acta_nacimiento_aprobado",
    "ine_aprobado",
    "cv_aprobado",
    "nss_aprobado",
    "constancia_aprobado",
    "foto_aprobado",
    "certificado_medico_aprobado",
  ].forEach((k) => {
    if (out[k] == null) out[k] = 0;
  });

  return out;
}

function normalizeEstado(estado) {
  // acepta string o boolean (compat)
  if (typeof estado === "string") {
    const s = estado.toLowerCase().trim();
    if (!["pendiente", "validado", "rechazado"].includes(s)) return null;
    return s;
  }
  if (typeof estado === "boolean") return estado ? "validado" : "pendiente";
  return null;
}

function aprobadoFromEstado(estadoStr) {
  return estadoStr === "validado" ? 1 : 0;
}

const DOC_MAP = {
  curp: { url: "curp_url", aprobado: "curp_aprobado", estado: "curp_estado" },
  acta_nacimiento: { url: "acta_nacimiento_url", aprobado: "acta_nacimiento_aprobado", estado: "acta_nacimiento_estado" },
  ine: { url: "ine_url", aprobado: "ine_aprobado", estado: "ine_estado" },
  cv: { url: "cv_url", aprobado: "cv_aprobado", estado: "cv_estado" },
  nss: { url: "nss_url", aprobado: "nss_aprobado", estado: "nss_estado" },
  constancia: { url: "constancia_url", aprobado: "constancia_aprobado", estado: "constancia_estado" },
  foto: { url: "foto_url", aprobado: "foto_aprobado", estado: "foto_estado" },
  certificado_medico: { url: "certificado_medico_url", aprobado: "certificado_medico_aprobado", estado: "certificado_medico_estado" },
};

/** ─────────────────────────────────────────────────────────────
 *  Crear/actualizar documentos (usuario autenticado)
 *  Regla: si sube/re-sube archivo => estado = 'pendiente' y aprobado=0
 *  ───────────────────────────────────────────────────────────── */
const guardarDocumentos = async (req, res) => {
  try {
    const userIdInterno = req.user?.id;
    if (!userIdInterno) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const {
      sobre_mi,
      curp_url,
      acta_nacimiento_url,
      ine_url,
      cv_url,
      nss_url,
      constancia_url,
      foto_url,
      certificado_medico_url,
    } = req.body;

    if (
      !curp_url &&
      !acta_nacimiento_url &&
      !ine_url &&
      !cv_url &&
      !nss_url &&
      !constancia_url &&
      !foto_url &&
      !certificado_medico_url &&
      !sobre_mi
    ) {
      return res.status(400).json({ error: "No se enviaron documentos o datos." });
    }

    // Genera UUID solo si insertamos una nueva fila
    const idDocumento = uuidv4();

    // Insert base
    const insertCampos = [
      "id",
      "user_id",
      "curp_url",
      "curp_aprobado",
      "curp_estado",
      "acta_nacimiento_url",
      "acta_nacimiento_aprobado",
      "acta_nacimiento_estado",
      "ine_url",
      "ine_aprobado",
      "ine_estado",
      "cv_url",
      "cv_aprobado",
      "cv_estado",
      "nss_url",
      "nss_aprobado",
      "nss_estado",
      "constancia_url",
      "constancia_aprobado",
      "constancia_estado",
      "foto_url",
      "foto_aprobado",
      "foto_estado",
      "certificado_medico_url",
      "certificado_medico_aprobado",
      "certificado_medico_estado",
      "sobre_mi",
    ];

    const insertValores = [
      idDocumento,
      userIdInterno,

      curp_url || null,
      0,
      curp_url ? "pendiente" : null,

      acta_nacimiento_url || null,
      0,
      acta_nacimiento_url ? "pendiente" : null,

      ine_url || null,
      0,
      ine_url ? "pendiente" : null,

      cv_url || null,
      0,
      cv_url ? "pendiente" : null,

      nss_url || null,
      0,
      nss_url ? "pendiente" : null,

      constancia_url || null,
      0,
      constancia_url ? "pendiente" : null,

      foto_url || null,
      0,
      foto_url ? "pendiente" : null,

      certificado_medico_url || null,
      0,
      certificado_medico_url ? "pendiente" : null,

      typeof sobre_mi === "string" ? sobre_mi : null,
    ];

    const updateCampos = [];
    const updateValores = [];

    // helper: si cambias URL => pending + aprobado=0
    const setUrlPending = (urlCol, apCol, estCol, val) => {
      updateCampos.push(`${urlCol} = ?`);
      updateValores.push(val);

      updateCampos.push(`${apCol} = 0`);
      updateCampos.push(`${estCol} = 'pendiente'`);
    };

    if (curp_url) setUrlPending("curp_url", "curp_aprobado", "curp_estado", curp_url);
    if (acta_nacimiento_url) setUrlPending("acta_nacimiento_url", "acta_nacimiento_aprobado", "acta_nacimiento_estado", acta_nacimiento_url);
    if (ine_url) setUrlPending("ine_url", "ine_aprobado", "ine_estado", ine_url);
    if (cv_url) setUrlPending("cv_url", "cv_aprobado", "cv_estado", cv_url);
    if (nss_url) setUrlPending("nss_url", "nss_aprobado", "nss_estado", nss_url);
    if (constancia_url) setUrlPending("constancia_url", "constancia_aprobado", "constancia_estado", constancia_url);
    if (foto_url) setUrlPending("foto_url", "foto_aprobado", "foto_estado", foto_url);
    if (certificado_medico_url) setUrlPending("certificado_medico_url", "certificado_medico_aprobado", "certificado_medico_estado", certificado_medico_url);

    if (typeof sobre_mi === "string") {
      updateCampos.push("sobre_mi = ?");
      updateValores.push(sobre_mi);
    }

    // siempre actualiza timestamp
    updateCampos.push("ultima_actualizacion = CURRENT_TIMESTAMP");

    const sql = `
      INSERT INTO documentos (${insertCampos.join(", ")})
      VALUES (${insertCampos.map(() => "?").join(", ")})
      ON DUPLICATE KEY UPDATE
      ${updateCampos.join(", ")}
    `;

    await db.query(sql, [...insertValores, ...updateValores]);

    return res.status(201).json({ mensaje: "Documentos guardados exitosamente." });
  } catch (error) {
    console.error("❌ guardarDocumentos:", error);
    return res.status(500).json({ error: "Error interno al guardar documentos." });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Admin/Mod: listar todos
 *  ───────────────────────────────────────────────────────────── */
const getAll = async (req, res) => {
  try {
    if (!req.user) {
      return res.status(401).json({ error: "No autenticado" });
    }

    const { rol, estado } = req.user;
    const { searchField, search } = req.query;

    console.log("🔍 getAll docs → filtros:", { rol, estado, searchField, search });

    const validFields = ["matricula", "correo", "curp"];

const camposUsuarios = [
  "users.id",
  "users.uid",
  "users.nombre",
  "users.apellido_pat AS apellido_paterno",
  "users.apellido_mat AS apellido_materno",
  "users.matricula",
  "users.correo",
  "users.curp",
];

const camposDocumentos = [
  "documentos.curp_url",
  "documentos.curp_aprobado",
  "documentos.curp_estado",

  "documentos.acta_nacimiento_url",
  "documentos.acta_nacimiento_aprobado",
  "documentos.acta_nacimiento_estado",

  "documentos.ine_url",
  "documentos.ine_aprobado",
  "documentos.ine_estado",

  "documentos.cv_url",
  "documentos.cv_aprobado",
  "documentos.cv_estado",

  "documentos.nss_url",
  "documentos.nss_aprobado",
  "documentos.nss_estado",

  "documentos.constancia_url",
  "documentos.constancia_aprobado",
  "documentos.constancia_estado",

  "documentos.foto_url",
  "documentos.foto_aprobado",
  "documentos.foto_estado",

  "documentos.certificado_medico_url",
  "documentos.certificado_medico_aprobado",
  "documentos.certificado_medico_estado",

  "documentos.sobre_mi",
  "documentos.fecha_creacion",
  "documentos.ultima_actualizacion",
];


    const campos = [...camposUsuarios, ...camposDocumentos].join(", ");

    let sql = `
  SELECT ${campos}
  FROM users
  LEFT JOIN documentos ON users.id = documentos.user_id
`;
const params = [];

if (rol === "moderador") {
  // ✅ Aplica alcance por moderator_scopes + enrollment
  const scope = buildModeratorScopeSql(req, { userAlias: "users", enrollmentAlias: "upe", scopesAlias: "ms" });
  sql = `
    SELECT ${campos}
    FROM users
    ${scope.fromJoin}
    LEFT JOIN documentos ON users.id = documentos.user_id
  `;
  params.push(...scope.params);
  sql += " WHERE 1=1 ";
} else if (rol !== "admin") {
  return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
}
if (search && search.trim() !== "" && validFields.includes(searchField)) {
      sql += (rol === "moderador" ? " AND" : " WHERE") + ` users.${searchField} LIKE ?`;
      params.push(`%${search.trim()}%`);
    }

    console.log("🛠 getAll docs SQL:", sql, params);

    const [results] = await db.query(sql, params);
    return res.json(Array.isArray(results) ? results : []);
  } catch (err) {
    console.error("❌ getAll docs:", err?.sqlMessage || err);
    return res.status(500).json({
      error: "Error al obtener perfiles",
      detail: err?.sqlMessage || err?.message || "unknown",
    });
  }
};


// ─────────────────────────────────────────────────────────────
// Helper: fragmento SQL para aplicar alcance de moderador (estado/programa/grupo)
// Basado en:
// - users.estado
// - user_program_enrollment.program_id + group_code (upe.user_id guarda users.uid)
// - moderator_scopes (moderator_uid = Firebase UID del moderador)
//
// Reglas de comodín (NULL):
// - ms.estado NULL => cualquier estado
// - ms.program_id NULL => cualquier programa
// - ms.group_code NULL => cualquier grupo (incluye 'SIN_GRUPO')
//
// Retorna: { fromJoin, whereExtra, params }
// ─────────────────────────────────────────────────────────────
function buildModeratorScopeSql(req, opts = {}) {
  const userAlias = opts.userAlias || "users";
  const enrollmentAlias = opts.enrollmentAlias || "upe";
  const scopesAlias = opts.scopesAlias || "ms";

  const rol = normRol(req.user?.rol);
  if (rol !== "moderador") return { fromJoin: "", whereExtra: "", params: [] };

  const moderatorUid = req?.firebaseUser?.uid || null;
  if (!moderatorUid) return { fromJoin: "", whereExtra: " AND 1=0 ", params: [] };

  // OJO: upe.user_id guarda users.uid (Firebase UID), NO users.id
  const fromJoin = `
    JOIN user_program_enrollment ${enrollmentAlias}
      ON ${enrollmentAlias}.user_id COLLATE utf8mb4_unicode_ci = ${userAlias}.uid COLLATE utf8mb4_unicode_ci
    JOIN moderator_scopes ${scopesAlias}
      ON ${scopesAlias}.moderator_uid = ?
     AND ${scopesAlias}.is_active = 1
     AND (${scopesAlias}.estado IS NULL OR ${scopesAlias}.estado COLLATE utf8mb4_unicode_ci = ${userAlias}.estado COLLATE utf8mb4_unicode_ci)
     AND (${scopesAlias}.program_id IS NULL OR ${scopesAlias}.program_id = ${enrollmentAlias}.program_id)
     AND (${scopesAlias}.group_code IS NULL OR ${scopesAlias}.group_code COLLATE utf8mb4_unicode_ci = ${enrollmentAlias}.group_code COLLATE utf8mb4_unicode_ci)
  `;

  return { fromJoin, whereExtra: "", params: [moderatorUid] };
}

async function assertUserInModeratorScopeByUserId(req, userId) {
  const rol = normRol(req.user?.rol);
  if (rol !== "moderador") return true;

  const moderatorUid = req?.firebaseUser?.uid || null;
  if (!moderatorUid) return false;

  const [rows] = await db.query(
    `
    SELECT 1
    FROM users u
    JOIN user_program_enrollment upe
      ON upe.user_id COLLATE utf8mb4_unicode_ci = u.uid COLLATE utf8mb4_unicode_ci
    JOIN moderator_scopes ms
      ON ms.moderator_uid = ?
     AND ms.is_active = 1
     AND (ms.estado IS NULL OR ms.estado COLLATE utf8mb4_unicode_ci = u.estado COLLATE utf8mb4_unicode_ci)
     AND (ms.program_id IS NULL OR ms.program_id = upe.program_id)
     AND (ms.group_code IS NULL OR ms.group_code COLLATE utf8mb4_unicode_ci = upe.group_code COLLATE utf8mb4_unicode_ci)
    WHERE u.id = ?
    LIMIT 1
    `,
    [moderatorUid, userId]
  );

  return !!rows?.length;
}

async function assertUserInModeratorScopeByMatricula(req, matricula) {
  const rol = normRol(req.user?.rol);
  if (rol !== "moderador") return true;

  const moderatorUid = req?.firebaseUser?.uid || null;
  if (!moderatorUid) return false;

  const [rows] = await db.query(
    `
    SELECT 1
    FROM users u
    JOIN user_program_enrollment upe
      ON upe.user_id COLLATE utf8mb4_unicode_ci = u.uid COLLATE utf8mb4_unicode_ci
    JOIN moderator_scopes ms
      ON ms.moderator_uid = ?
     AND ms.is_active = 1
     AND (ms.estado IS NULL OR ms.estado COLLATE utf8mb4_unicode_ci = u.estado COLLATE utf8mb4_unicode_ci)
     AND (ms.program_id IS NULL OR ms.program_id = upe.program_id)
     AND (ms.group_code IS NULL OR ms.group_code COLLATE utf8mb4_unicode_ci = upe.group_code COLLATE utf8mb4_unicode_ci)
    WHERE u.matricula = ?
    LIMIT 1
    `,
    [moderatorUid, matricula]
  );

  return !!rows?.length;
}

// helper pequeño
function normRol(r) {
  return String(r || "").trim().toLowerCase();
}

/** ─────────────────────────────────────────────────────────────
 *  Admin/Mod: actualizar estado (pendiente|validado|rechazado)
 *  ✅ Ahora respeta alcance por estado
 *  ───────────────────────────────────────────────────────────── */
const actualizarEstadoDocumento = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const rol = normRol(req.user.rol);
    const estadoMod = req.user.estado;

    if (!["admin", "moderador"].includes(rol)) {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    const { user_matricula, documento, estado } = req.body;

    if (!user_matricula || !documento) {
      return res.status(400).json({ error: "Datos incompletos" });
    }

    const cols = DOC_MAP[String(documento || "").trim()];
    if (!cols) return res.status(400).json({ error: "Documento inválido" });

    const estadoStr = normalizeEstado(estado);
    if (!estadoStr) return res.status(400).json({ error: "Estado inválido" });

    // ✅ Resuelve usuario (y verifica alcance si es moderador)
if (rol === "moderador") {
  const ok = await assertUserInModeratorScopeByMatricula(req, user_matricula);
  if (!ok) {
    return res.status(404).json({ error: "Usuario no encontrado o fuera de tu alcance" });
  }
}

const [urows] = await db.query(
  "SELECT id FROM users WHERE matricula = ? LIMIT 1",
  [user_matricula]
);
if (!urows?.length) {
      return res.status(404).json({
        error: rol === "moderador" ? "Usuario no encontrado o fuera de tu alcance" : "Usuario no encontrado",
      });
    }

    const userId = urows[0].id;

    // check archivo existe
    const [drows] = await db.query(
      `SELECT ${cols.url} AS urlActual FROM documentos WHERE user_id = ? LIMIT 1`,
      [userId]
    );
    if (!drows?.length) return res.status(404).json({ error: "Registro de documentos no encontrado" });
    if (!drows[0]?.urlActual) return res.status(400).json({ error: "No hay archivo para ese documento" });

    const aprobadoBool = aprobadoFromEstado(estadoStr);

    const sql = `
      UPDATE documentos
      SET ${cols.estado} = ?, ${cols.aprobado} = ?
      WHERE user_id = ?
      LIMIT 1
    `;
    await db.query(sql, [estadoStr, aprobadoBool, userId]);

    return res.json({
      ok: true,
      user_matricula,
      documento,
      estado: estadoStr,
      aprobado: !!aprobadoBool,
    });
  } catch (err) {
    console.error("❌ actualizarEstadoDocumento:", err);
    return res.status(500).json({ error: "Error interno" });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Mis documentos (usuario autenticado)
 *  ───────────────────────────────────────────────────────────── */
const obtenerMisDocumentos = async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ error: "No autenticado" });

    const [userRows] = await db.query(
      "SELECT id, matricula, curp, correo FROM users WHERE id = ? LIMIT 1",
      [userId]
    );
    if (!userRows.length) return res.status(404).json({ error: "Usuario no encontrado" });

    let [docsRows] = await db.query(
      `SELECT ${DOC_COLS} FROM documentos WHERE user_id = ? LIMIT 1`,
      [userId]
    );

    const payload = mergeUserAndDocs(userRows[0], docsRows[0] || {});
    return res.json(payload);
  } catch (err) {
    console.error("❌ obtenerMisDocumentos:", err);
    return res.status(500).json({ error: "Error al obtener documentos" });
  }
};

/** ─────────────────────────────────────────────────────────────
 *  Documentos por userId (admin/mod)
 *  ───────────────────────────────────────────────────────────── */
const obtenerDocumentosPorUserId = async (req, res) => {
  try {
    if (!req.user) return res.status(401).json({ error: "No autenticado" });

    const rol = normRol(req.user.rol);
    const estadoMod = req.user.estado;

    if (!["admin", "moderador"].includes(rol)) {
      return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
    }

    const requestedUserId = String(req.params.userId || "").trim();
    if (!requestedUserId) return res.status(400).json({ error: "Parámetro userId inválido" });

    // ✅ verifica alcance si es moderador (estado/programa/grupo)
if (rol === "moderador") {
  const ok = await assertUserInModeratorScopeByUserId(req, requestedUserId);
  if (!ok) {
    return res.status(404).json({ error: "Usuario no encontrado o fuera de tu alcance" });
  }
}

const [userRows] = await db.query(
  "SELECT id, matricula, curp, correo FROM users WHERE id = ? LIMIT 1",
  [requestedUserId]
);
if (!userRows.length) {
      return res.status(404).json({
        error: rol === "moderador" ? "Usuario no encontrado o fuera de tu alcance" : "Usuario no encontrado",
      });
    }

    let [docsRows] = await db.query(
      `SELECT ${DOC_COLS} FROM documentos WHERE user_id = ? LIMIT 1`,
      [requestedUserId]
    );

    const payload = mergeUserAndDocs(userRows[0], docsRows[0] || {});
    return res.json(payload);
  } catch (err) {
    console.error("❌ obtenerDocumentosPorUserId:", err);
    return res.status(500).json({ error: "Error al obtener documentos" });
  }
};


module.exports = {
  guardarDocumentos,
  getAll,
  actualizarEstadoDocumento,
  obtenerMisDocumentos,
  obtenerDocumentosPorUserId,
};
