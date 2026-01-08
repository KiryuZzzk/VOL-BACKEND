// progreso.controller.js
const db = require("../config/db");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");

// ⚠️ Requiere instalar unzipper si no lo tienes:
// npm i unzipper
const unzipper = require("unzipper");

/**
 * Devuelve ambos posibles identificadores del usuario:
 * - firebaseUid: string (Firebase Auth)
 * - dbUserId: number (users.id en MySQL)
 */
function getUserKeys(req) {
  const firebaseUid = String(req.firebaseUser?.uid || "").trim() || null;

  const dbUserIdRaw =
    req.user?.id ?? req.dbUser?.id ?? req.user?.user_id ?? null;

  const dbUserId =
    dbUserIdRaw === null || dbUserIdRaw === undefined || dbUserIdRaw === ""
      ? null
      : Number(dbUserIdRaw);

  return {
    firebaseUid,
    dbUserId: Number.isFinite(dbUserId) ? dbUserId : null,
  };
}

/**
 * 🔥 CLAVE: para progreso usamos UN SOLO user_id consistente.
 * Preferimos firebaseUid (porque tu plataforma ya vive en Firebase Auth),
 * y si no existe, caemos a dbUserId como string.
 */
function getProgressUserId(req) {
  const { firebaseUid, dbUserId } = getUserKeys(req);
  if (firebaseUid) return firebaseUid;
  if (dbUserId) return String(dbUserId);
  return null;
}

function normalizeJsonForDb(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === "string") return value.trim() ? value : null;
  try {
    return JSON.stringify(value);
  } catch {
    return null;
  }
}

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  const s = String(value).trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function normalizeScore(value) {
  if (value === undefined || value === null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeActivityId(raw) {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * =======================
 * 🧩 SCORM HELPERS
 * =======================
 */

// Root folder donde vamos a “montar” SCORM ya extraído.
// OJO: esto NO es /public; lo servimos con express.static directo a este folder.
const SCORM_LAUNCH_ROOT = path.join(process.cwd(), "scorm_launch");

// Busca el ZIP en rutas típicas basadas en tu URL pública:
// - "/assets/scorm/archivo.zip"
// Lo intentamos resolver a:
// - <cwd>/assets/scorm/archivo.zip
// - <cwd>/public/assets/scorm/archivo.zip
async function resolveZipAbsolutePath(scormPackageUrl) {
  const url = String(scormPackageUrl || "").trim();
  if (!url) return null;

  // soporta "/assets/..." o "assets/..."
  const rel = url.startsWith("/") ? url.slice(1) : url;

  const candidates = [
    path.join(process.cwd(), rel),
    path.join(process.cwd(), "public", rel),
  ];

  for (const abs of candidates) {
    try {
      const st = await fsp.stat(abs);
      if (st.isFile()) return abs;
    } catch {
      // ignore
    }
  }
  return null;
}

// Crea key estable por zip (path + size + mtime) para cachear extracción
async function makeZipCacheKey(zipAbsPath) {
  const st = await fsp.stat(zipAbsPath);
  const base = `${zipAbsPath}::${st.size}::${st.mtimeMs}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

// Extrae zip a targetDir si targetDir no existe / está vacío
async function extractZipOnce(zipAbsPath, targetDir) {
  await ensureDir(targetDir);

  // Heurística rápida: si ya hay archivos, asumimos extraído
  const existing = await fsp.readdir(targetDir).catch(() => []);
  if (existing.length > 0) return;

  await new Promise((resolve, reject) => {
    fs.createReadStream(zipAbsPath)
      .pipe(unzipper.Extract({ path: targetDir }))
      .on("close", resolve)
      .on("error", reject);
  });
}

// Recorrido recursivo para encontrar un archivo (prioriza index.html)
async function findLaunchFile(extractedDir) {
  // 1) si existe index.html en root o en subcarpetas
  const foundIndex = await findFileRecursive(extractedDir, (p) =>
    path.basename(p).toLowerCase() === "index.html"
  );
  if (foundIndex) return foundIndex;

  // 2) primer .html que exista
  const foundHtml = await findFileRecursive(extractedDir, (p) =>
    p.toLowerCase().endsWith(".html")
  );
  return foundHtml;
}

async function findFileRecursive(root, predicate) {
  const stack = [root];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const ent of entries) {
      const abs = path.join(dir, ent.name);

      if (ent.isDirectory()) {
        // evita carpetas basura comunes
        if (ent.name === "__MACOSX") continue;
        stack.push(abs);
      } else if (ent.isFile()) {
        if (predicate(abs)) return abs;
      }
    }
  }
  return null;
}

// Convierte absPath dentro de extractedDir a ruta relativa con slashes para URL
function toRelativeUrlPath(extractedDir, absFile) {
  const rel = path.relative(extractedDir, absFile);
  // windows-safe
  return rel.split(path.sep).join("/");
}

/**
 * ✅ POST /scorm/activities/:activityId/mount
 * - Lee activity.config_json
 * - Toma config.scormPackageUrl (ZIP)
 * - Descomprime en cache
 * - Encuentra launchFile (index.html / primer html)
 * - Regresa launchUrl = /scorm/launch/<key>/<launchFile>
 *
 * Requiere que en tu server (app.js) agregues:
 *   const path = require("path");
 *   app.use("/scorm/launch", express.static(path.join(process.cwd(), "scorm_launch")));
 */
exports.mountScormActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    // 1) Leer activity + config_json
    const [rows] = await db.query(
      `
      SELECT activity_id, config_json, type, is_active
      FROM activity
      WHERE activity_id = ?
      LIMIT 1
      `,
      [activityId]
    );

    if (!rows.length) return res.status(404).json({ error: "Actividad no encontrada" });

    const activity = rows[0];
    if (Number(activity.is_active) === 0) {
      return res.status(400).json({ error: "Actividad inactiva" });
    }

    const config = safeJsonParse(activity.config_json, {}) || {};
    const scormPackageUrl = config?.scormPackageUrl || null;

    if (!scormPackageUrl) {
      return res.status(400).json({
        error: "Actividad sin config.scormPackageUrl",
      });
    }

    // 2) Resolver zip en filesystem
    const zipAbsPath = await resolveZipAbsolutePath(scormPackageUrl);
    if (!zipAbsPath) {
      return res.status(404).json({
        error: `ZIP no encontrado en filesystem para: ${scormPackageUrl}`,
      });
    }

    // 3) Cache key + extraction dir
    const key = await makeZipCacheKey(zipAbsPath);
    const extractedDir = path.join(SCORM_LAUNCH_ROOT, key);

    // 4) Extraer (si no existe)
    await extractZipOnce(zipAbsPath, extractedDir);

    // 5) Encontrar launch file
    const launchAbs = await findLaunchFile(extractedDir);
    if (!launchAbs) {
      return res.status(400).json({
        error: "No se encontró archivo .html para lanzar (index.html o similar)",
      });
    }

    const launchRel = toRelativeUrlPath(extractedDir, launchAbs);

    // 6) Responder URL pública (tu express.static la sirve)
    return res.json({
      ok: true,
      activityId,
      scormPackageUrl,
      cacheKey: key,
      launchFile: launchRel,
      launchUrl: `/scorm/launch/${key}/${launchRel}`,
    });
  } catch (err) {
    console.error("❌ mountScormActividad:", err);
    return res.status(500).json({ error: "Error al montar SCORM" });
  }
};

/**
 * GET /progreso/me/programas/:code
 * Devuelve el progreso del usuario para un programa
 */
exports.getMiProgresoPrograma = async (req, res) => {
  const uid = getProgressUserId(req);
  const programCode = String(req.params.code || "").trim().toUpperCase();

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!programCode) return res.status(400).json({ error: "code requerido" });

  try {
    const [rows] = await db.query(
      `
      SELECT
        a.activity_id,
        a.code AS activity_code,
        a.name AS activity_name,
        a.required,
        a.min_score,
        a.is_final_exam,

        COALESCE(uap.status, 'not_started') AS status,
        COALESCE(uap.attempts, 0) AS attempts,
        uap.score,
        uap.data_json,
        uap.started_at,
        uap.completed_at,
        uap.last_seen_at
      FROM program p
      JOIN block b ON b.program_id = p.program_id AND b.is_active = 1
      JOIN module m ON m.block_id = b.block_id AND m.is_active = 1
      JOIN activity a ON a.module_id = m.module_id AND a.is_active = 1
      LEFT JOIN user_activity_progress uap
        ON uap.activity_id = a.activity_id
       AND uap.user_id = ?
      WHERE p.code = ?
        AND p.is_active = 1
      ORDER BY
        b.order_index ASC,
        m.order_index ASC,
        a.order_index ASC
      `,
      [uid, programCode]
    );

    return res.json({
      user_id: uid,
      programCode,
      activities: rows,
    });
  } catch (err) {
    console.error("❌ getMiProgresoPrograma error:", err);
    return res.status(500).json({ error: "Error al obtener progreso" });
  }
};

/**
 * POST /progreso/actividades/:activityId/iniciar
 * Marca actividad como in_progress
 */
exports.iniciarActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, started_at, last_seen_at)
      VALUES (?, ?, 'in_progress', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = IF(status='completed', status, 'in_progress'),
        started_at = COALESCE(started_at, NOW()),
        last_seen_at = NOW()
      `,
      [uid, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ iniciarActividad error:", err);
    return res.status(500).json({ error: "Error al iniciar actividad" });
  }
};

/**
 * POST /progreso/actividades/:activityId/completar
 * body opcional:
 * {
 *   score?: number,
 *   passed?: boolean,     // default true
 *   data_json?: any
 * }
 */
exports.completarActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  const score = normalizeScore(req.body?.score);
  const passed = req.body?.passed ?? true;
  const status = passed ? "completed" : "failed";
  const data_json = normalizeJsonForDb(req.body?.data_json);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, data_json, started_at, completed_at, last_seen_at)
      VALUES (?, ?, ?, 1, ?, ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        attempts = COALESCE(attempts,0) + 1,
        score = COALESCE(VALUES(score), score),
        data_json = COALESCE(VALUES(data_json), data_json),
        completed_at = NOW(),
        last_seen_at = NOW()
      `,
      [uid, activityId, status, score, data_json]
    );

    return res.json({ ok: true, status });
  } catch (err) {
    console.error("❌ completarActividad error:", err);
    return res.status(500).json({ error: "Error al completar actividad" });
  }
};

/**
 * POST /progreso/actividades/:activityId/heartbeat
 * Solo actualiza last_seen_at
 */
exports.heartbeatActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, started_at, last_seen_at)
      VALUES (?, ?, 'in_progress', NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        last_seen_at = NOW()
      `,
      [uid, activityId]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ heartbeatActividad error:", err);
    return res.status(500).json({ error: "Error heartbeat" });
  }
};

/**
 * ✅ POST /progreso/actividades/:activityId/choose
 * Para activities type="path":
 * body:
 * { choice: "COM" | "VOL" | ... }
 * o
 * { choices: ["COM","VOL"] }
 *
 * Hace:
 * 1) valida choice(s)
 * 2) inscribe al usuario al/los programa(s) elegido(s)
 * 3) marca la activity como completed guardando data_json con la elección
 */
exports.choosePathActividad = async (req, res) => {
  const uidProgress = getProgressUserId(req);
  const { firebaseUid, dbUserId } = getUserKeys(req);
  const activityId = normalizeActivityId(req.params.activityId);

  // Acepta:
  // body.choice: "COM"
  // body.choices: ["COM","VOL"]
  const rawChoices = Array.isArray(req.body?.choices)
    ? req.body.choices
    : req.body?.choice
    ? [req.body.choice]
    : [];

  const choices = [
    ...new Set(
      rawChoices
        .map((x) => String(x || "").trim().toUpperCase())
        .filter(Boolean)
    ),
  ];

  if (!uidProgress) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });
  if (!choices.length) return res.status(400).json({ error: "choice/choices requerido" });

  // Lista blanca opcional
  const ALLOWED = new Set(["COM", "VOL", "MIG", "RDR", "APS", "TUM", "CAP", "PREV"]);
  const invalid = choices.filter((c) => !ALLOWED.has(c));
  if (invalid.length) {
    return res.status(400).json({ error: `choice(s) inválido(s): ${invalid.join(", ")}` });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    // 1) Resolver program_id de TODOS los choices
    const [pRows] = await conn.query(
      `
      SELECT program_id, code, is_active
      FROM program
      WHERE code IN (${choices.map(() => "?").join(",")})
      `,
      choices
    );

    const found = new Map(pRows.map((p) => [String(p.code).toUpperCase(), p]));
    const missing = choices.filter((c) => !found.has(c));
    if (missing.length) {
      await conn.rollback();
      return res.status(404).json({ error: `Programa(s) no encontrado(s): ${missing.join(", ")}` });
    }

    const inactive = choices.filter((c) => Number(found.get(c)?.is_active) === 0);
    if (inactive.length) {
      await conn.rollback();
      return res.status(400).json({ error: `Programa(s) inactivo(s): ${inactive.join(", ")}` });
    }

    // 2) User id para enrollment
    const enrollmentUserId =
      (Number.isFinite(dbUserId) && dbUserId) || firebaseUid || uidProgress;

    // 3) Enrolar TODOS
    for (const c of choices) {
      const program = found.get(c);
      await conn.query(
        `
        INSERT INTO user_program_enrollment (user_id, program_id, status, enrolled_at)
        VALUES (?, ?, 'enrolled', NOW())
        ON DUPLICATE KEY UPDATE
          status = 'enrolled'
        `,
        [enrollmentUserId, program.program_id]
      );
    }

    // 4) Marcar actividad PATH como completada con data_json incluyendo choices
    const data_json = normalizeJsonForDb({
      completedBy: "path_choice",
      choices,
      enrolledPrograms: choices.map((c) => ({
        code: c,
        programId: found.get(c).program_id,
      })),
    });

    await conn.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, data_json, started_at, completed_at, last_seen_at)
      VALUES (?, ?, 'completed', 1, NULL, ?, NOW(), NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        status = 'completed',
        attempts = COALESCE(attempts,0) + 1,
        data_json = COALESCE(VALUES(data_json), data_json),
        completed_at = NOW(),
        last_seen_at = NOW()
      `,
      [uidProgress, activityId, data_json]
    );

    await conn.commit();

    return res.json({
      ok: true,
      choices,
      enrollmentUserId,
      enrolledPrograms: choices.map((c) => ({
        code: c,
        programId: found.get(c).program_id,
      })),
    });
  } catch (err) {
    try { await conn.rollback(); } catch {}
    console.error("❌ choosePathActividad error:", err);
    return res.status(500).json({ error: "Error al elegir camino" });
  } finally {
    conn.release();
  }
};
