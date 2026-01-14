// controllers/progreso.programas.controller.js
const db = require("../config/db");

/**
 * Identidades:
 * - firebaseUid: VARCHAR(128) (lo usan user_program_enrollment / user_activity_progress)
 * - dbUserId: CHAR(36) UUID (users.id) (lo usa user_coordinaciones)
 */
function getUserKeys(req) {
  const firebaseUid = String(req.firebaseUser?.uid || "").trim() || null;
  const dbUserId = String(req.user?.id || req.dbUser?.id || "").trim() || null;
  return { firebaseUid, dbUserId };
}

function parseTags(tags_json) {
  if (!tags_json) return [];
  if (Array.isArray(tags_json)) return tags_json.map(String);

  if (typeof tags_json === "string") {
    try {
      const parsed = JSON.parse(tags_json);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }

  // mysql2 puede entregar objetos/Buffer raros; intentamos stringificar
  try {
    const parsed = JSON.parse(String(tags_json));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function splitTags(tags) {
  const sysTags = [];
  const contentTags = [];
  for (const t of tags || []) {
    const s = String(t || "").trim();
    if (!s) continue;
    if (s.startsWith("@")) sysTags.push(s);
    else contentTags.push(s);
  }
  return { sysTags, contentTags };
}

// Orden mínimo para requisitos de coordinación
const COORD_MIN_ORDER = {
  INTERESADO: 0,
  EN_PROCESO: 1,
  PENDIENTE_VALIDACION: 2,
  ACTIVO: 3,
};

/**
 * Reglas @req soportadas (MVP):
 * - @req:user:VOLUNTARIO
 * - @req:coord:<CODE>:<MIN_STATUS>   ej @req:coord:SOC:ACTIVO
 */
function canSeeProgram({ sysTags, isVolunteer, coordStatusByCode }) {
  for (const tag of sysTags) {
    if (!tag.startsWith("@req:")) continue;

    // @req:user:VOLUNTARIO
    if (tag.toUpperCase() === "@REQ:USER:VOLUNTARIO") {
      if (!isVolunteer) return false;
      continue;
    }

    // @req:coord:SOC:ACTIVO
    const parts = tag.split(":"); // ["@req","coord","SOC","ACTIVO"]
    if (parts.length >= 4 && String(parts[1] || "").toLowerCase() === "coord") {
      const code = String(parts[2] || "").trim().toUpperCase();
      const minStatus = String(parts[3] || "").trim().toUpperCase();

      const userStatus = coordStatusByCode.get(code);
      if (!userStatus) return false;

      const u = COORD_MIN_ORDER[String(userStatus).toUpperCase()];
      const m = COORD_MIN_ORDER[minStatus];
      if (u === undefined || m === undefined) return false;
      if (u < m) return false;

      continue;
    }

    // Si llega un @req desconocido -> fail closed (más seguro)
    return false;
  }

  return true;
}

/**
 * VOLUNTARIO = completó programa SV
 * (por user_program_enrollment.status = 'completed')
 *
 * Si por algún motivo aún no has marcado completed, dejamos un fallback:
 * - todas las actividades REQUIRED del programa SV completadas en user_activity_progress
 */
async function getIsVolunteer(firebaseUid) {
  if (!firebaseUid) return false;

  // 1) check rápido: enrollment completed
  const [rows] = await db.query(
    `
    SELECT 1
    FROM user_program_enrollment upe
    JOIN program p ON p.program_id = upe.program_id
    WHERE upe.user_id = ?
      AND p.code = 'SV'
      AND upe.status = 'completed'
    LIMIT 1
    `,
    [firebaseUid]
  );

  if (rows.length) return true;

  // 2) fallback: required activities completed (SV)
  // Nota: esto asume que activity.required existe (sí, tu catálogo la usa)
  const [reqRows] = await db.query(
    `
    SELECT COUNT(*) AS required_count
    FROM program p
    JOIN block b ON b.program_id = p.program_id AND b.is_active = 1
    JOIN module m ON m.block_id = b.block_id AND m.is_active = 1
    JOIN activity a ON a.module_id = m.module_id AND a.is_active = 1
    WHERE p.code = 'SV'
      AND a.required = 1
    `,
    []
  );

  const requiredCount = Number(reqRows?.[0]?.required_count || 0);
  if (!requiredCount) return false;

  const [doneRows] = await db.query(
    `
    SELECT COUNT(*) AS completed_required
    FROM program p
    JOIN block b ON b.program_id = p.program_id AND b.is_active = 1
    JOIN module m ON m.block_id = b.block_id AND m.is_active = 1
    JOIN activity a ON a.module_id = m.module_id AND a.is_active = 1
    JOIN user_activity_progress uap
      ON uap.activity_id = a.activity_id
     AND uap.user_id = ?
     AND uap.status = 'completed'
    WHERE p.code = 'SV'
      AND a.required = 1
    `,
    [firebaseUid]
  );

  const completedRequired = Number(doneRows?.[0]?.completed_required || 0);
  return completedRequired >= requiredCount;
}

/**
 * Mapa code -> status para coordinaciones del usuario (usa users.id UUID)
 */
async function getUserCoordStatusMap(dbUserId) {
  const map = new Map();
  if (!dbUserId) return map;

  const [rows] = await db.query(
    `
    SELECT c.code, uc.status
    FROM user_coordinaciones uc
    JOIN coordinaciones c ON c.coordinacion_id = uc.coordinacion_id
    WHERE uc.user_id = ?
      AND uc.is_active = 1
      AND c.is_active = 1
    `,
    [dbUserId]
  );

  for (const r of rows) {
    map.set(String(r.code).toUpperCase(), String(r.status).toUpperCase());
  }
  return map;
}

exports.getMisProgramas = async (req, res) => {
  const { firebaseUid, dbUserId } = getUserKeys(req);

  if (!firebaseUid) {
    // tu authMiddleware siempre debería darlo, pero por seguridad:
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    // Traer programas donde esté inscrito (enrolled)
    const [rows] = await db.query(
      `
      SELECT
        p.program_id,
        p.code,
        p.name,
        p.description,
        p.image,
        p.formacion,
        p.level,
        p.estimated_minutes,
        p.tags_json
      FROM user_program_enrollment upe
      JOIN program p ON p.program_id = upe.program_id
      WHERE upe.user_id = ?
        AND upe.status = 'enrolled'
        AND p.is_active = 1
      ORDER BY p.program_id ASC
      `,
      [firebaseUid]
    );

    const [isVolunteer, coordStatusByCode] = await Promise.all([
      getIsVolunteer(firebaseUid),
      getUserCoordStatusMap(dbUserId),
    ]);

    const filtered = [];
    for (const p of rows) {
      const tags = parseTags(p.tags_json);
      const { sysTags, contentTags } = splitTags(tags);

      const ok = canSeeProgram({
        sysTags,
        isVolunteer,
        coordStatusByCode,
      });

      if (!ok) continue;

      // devolvemos tags limpias para UI (sin @req/@aud)
      filtered.push({
        ...p,
        tags_json: contentTags,
      });
    }

    return res.json({
      programs: filtered,
      meta: {
        isVolunteer,
        coordinaciones: Object.fromEntries(coordStatusByCode),
      },
    });
  } catch (err) {
    console.error("❌ getMisProgramas:", err);
    return res.status(500).json({ error: "Error al obtener programas" });
  }
};
