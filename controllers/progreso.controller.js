const db = require("../config/db");
const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const unzipper = require("unzipper");
const { parseStringPromise } = require("xml2js");
const os = require("os");

/**
 * Devuelve ambos posibles identificadores del usuario:
 * - firebaseUid: string (Firebase Auth)
 * - dbUserId: number (users.id en MySQL)
 */
function getUserKeys(req) {
  const firebaseUid = String(req.firebaseUser?.uid || "").trim() || null;

  const dbUserIdRaw = req.user?.id ?? req.dbUser?.id ?? req.user?.user_id ?? null;

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
 * 🧪 FINAL QUIZ HELPERS
 * =======================
 * Regla: en final_quiz, el intento se "consume" al iniciar (no al enviar).
 * Esto permite el UX de "una vez que entras, ya cuenta como intento".
 */

async function getActivityMeta(activityId) {
  const [rows] = await db.query(
    `
    SELECT activity_id, type, config_json, min_score, is_active
    FROM activity
    WHERE activity_id = ?
    LIMIT 1
    `,
    [activityId]
  );
  if (!rows.length) return null;

  const a = rows[0];
  const config = safeJsonParse(a.config_json, {}) || {};
  return {
    activityId: a.activity_id,
    type: String(a.type || "").trim().toLowerCase(),
    minScore: normalizeScore(a.min_score),
    isActive: Number(a.is_active) !== 0,
    config,
  };
}

function normalizeMaxAttempts(raw, fallback = 1) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  // sane limits
  if (n < 1) return 1;
  if (n > 10) return 10;
  return Math.floor(n);
}

function pickRandomIndices(total, count) {
  const n = Math.max(0, Math.min(Number(total) || 0, 10000));
  const k = Math.max(0, Math.min(Number(count) || 0, n));
  const arr = Array.from({ length: n }, (_, i) => i);

  // Fisher–Yates shuffle partially
  for (let i = 0; i < k; i++) {
    const j = i + Math.floor(Math.random() * (n - i));
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr.slice(0, k);
}


/**
 * =======================
 * 🧩 SCORM HELPERS
 * =======================
 */

const SCORM_LAUNCH_ROOT = path.join(os.tmpdir(), "scorm_launch");

// 🔐 Secreto para firmar URLs del SCORM Player (misma env var que en server.js)
const SCORM_PLAYER_SECRET =
  process.env.SCORM_PLAYER_SECRET || process.env.API_KEY || "CHANGE_ME_IN_RENDER";

function signScormPlayerUrl({ activityId, key, launchRel, exp }) {
  const payload = `${activityId}|${key}|${launchRel}|${exp}`;
  return crypto.createHmac("sha256", SCORM_PLAYER_SECRET).update(payload).digest("hex");
}

function resolveZipAbsolutePath(scormPackageUrl) {
  if (!scormPackageUrl || typeof scormPackageUrl !== "string") return null;

  const noQuery = scormPackageUrl.split("?")[0].split("#")[0];
  const clean = noQuery.replace(/^\/+/, "");

  const candidates = [
    path.join(process.cwd(), clean),
    path.join(process.cwd(), "assets", clean),
    path.join(process.cwd(), "public", clean),
    path.join(process.cwd(), "public", "assets", "scorm", path.basename(clean)),
  ];

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function makeZipCacheKey(zipAbsPath) {
  const st = await fsp.stat(zipAbsPath);
  const base = `${zipAbsPath}::${st.size}::${st.mtimeMs}`;
  return crypto.createHash("sha1").update(base).digest("hex");
}

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

async function safeJoin(base, target) {
  const targetPath = path.resolve(base, target);
  if (!targetPath.startsWith(base)) {
    throw new Error("ZipSlip detected");
  }
  return targetPath;
}

// Extrae zip a targetDir (con protección ZipSlip) si targetDir no existe / está vacío
async function extractZipOnce(zipAbsPath, targetDir) {
  await ensureDir(targetDir);

  const existing = await fsp.readdir(targetDir).catch(() => []);
  if (existing.length > 0) return;

  const directory = await unzipper.Open.file(zipAbsPath);

  for (const entry of directory.files) {
    if (!entry || !entry.path) continue;
    if (entry.path.startsWith("__MACOSX")) continue;

    const destPath = await safeJoin(targetDir, entry.path);

    if (entry.type === "Directory") {
      await ensureDir(destPath);
      continue;
    }

    await ensureDir(path.dirname(destPath));

    await new Promise((resolve, reject) => {
      entry
        .stream()
        .pipe(fs.createWriteStream(destPath))
        .on("finish", resolve)
        .on("error", reject);
    });
  }
}

async function getLaunchFromManifest(extractedDir) {
  const manifestPath = path.join(extractedDir, "imsmanifest.xml");
  if (!fs.existsSync(manifestPath)) return null;

  const xml = await fsp.readFile(manifestPath, "utf8");
  const parsed = await parseStringPromise(xml);

  const manifest = parsed?.manifest;
  const orgs = manifest?.organizations?.[0];
  const defaultOrgId = orgs?.$?.default;
  const organizations = orgs?.organization || [];

  const org =
    organizations.find((o) => o?.$?.identifier === defaultOrgId) || organizations[0];

  const firstItem = org?.item?.[0];
  const identifierref = firstItem?.$?.identifierref;

  const resources = manifest?.resources?.[0]?.resource || [];
  const resource =
    resources.find((r) => r?.$?.identifier === identifierref) ||
    resources.find((r) => r?.$?.href) ||
    resources[0];

  const href = resource?.$?.href;
  if (!href) return null;

  return String(href).replace(/^\/+/, "");
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
        if (ent.name === "__MACOSX") continue;
        stack.push(abs);
      } else if (ent.isFile()) {
        if (predicate(abs)) return abs;
      }
    }
  }
  return null;
}

async function findLaunchFile(extractedDir) {
  // 0) Prefer manifest (SCORM 2004/1.2)
  const fromManifest = await getLaunchFromManifest(extractedDir);
  if (fromManifest) {
    const abs = path.join(extractedDir, fromManifest);
    if (fs.existsSync(abs)) return abs;
  }

  // 1) index.html
  const foundIndex = await findFileRecursive(extractedDir, (p) =>
    path.basename(p).toLowerCase() === "index.html"
  );
  if (foundIndex) return foundIndex;

  // 2) primer .html
  const foundHtml = await findFileRecursive(extractedDir, (p) =>
    p.toLowerCase().endsWith(".html")
  );
  return foundHtml;
}

function toRelativeUrlPath(extractedDir, absFile) {
  const rel = path.relative(extractedDir, absFile);
  return rel.split(path.sep).join("/");
}

/**
 * ✅ POST /scorm/activities/:activityId/mount
 * Devuelve launchUrl apuntando a /scorm/player (wrapper mismo-origen del SCO)
 */
exports.mountScormActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
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
      return res.status(400).json({ error: "Actividad sin config.scormPackageUrl" });
    }

    const zipAbsPath = await resolveZipAbsolutePath(scormPackageUrl);
    if (!zipAbsPath) {
      return res.status(404).json({
        error: `ZIP no encontrado en filesystem para: ${scormPackageUrl}`,
      });
    }

    const key = await makeZipCacheKey(zipAbsPath);
    const extractedDir = path.join(SCORM_LAUNCH_ROOT, key);

    await extractZipOnce(zipAbsPath, extractedDir);

    const launchAbs = await findLaunchFile(extractedDir);
    if (!launchAbs) {
      return res.status(400).json({
        error: "No se encontró archivo .html para lanzar (manifest/index.html)",
      });
    }

    const launchRel = toRelativeUrlPath(extractedDir, launchAbs);

    return res.json({
      ok: true,
      activityId,
      scormPackageUrl,
      cacheKey: key,
      launchFile: launchRel,
      // ✅ wrapper mismo-origen (backend) + URL firmada (expira)
      launchUrl: (() => {
        const exp = Date.now() + 15 * 60 * 1000; // 15 min
        const sig = signScormPlayerUrl({ activityId, key, launchRel, exp });
        return `/scorm/player?activityId=${activityId}&key=${key}&launch=${encodeURIComponent(
          launchRel
        )}&exp=${exp}&sig=${sig}`;
      })(),
    });
  } catch (err) {
    console.error("❌ mountScormActividad:", err);
    return res.status(500).json({ error: "Error al montar SCORM" });
  }
};

/**
 * ✅ POST /progreso/scorm/activities/:activityId/commit
 * body: { cmi: object, raw?: any }
 * Guarda snapshot del runtime en user_activity_progress.data_json.
 */
exports.scormCommitActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  const cmi = req.body?.cmi && typeof req.body.cmi === "object" ? req.body.cmi : null;
  const raw = req.body?.raw ?? null;

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });
  if (!cmi) return res.status(400).json({ error: "cmi requerido" });

  try {
    const snapshot = {
      scorm: {
        ts: new Date().toISOString(),
        cmi,
        raw,
      },
    };

    const data_json = normalizeJsonForDb(snapshot);

    await db.query(
      `
      INSERT INTO user_activity_progress
        (user_id, activity_id, status, attempts, score, data_json, started_at, last_seen_at)
      VALUES (?, ?, 'in_progress', 1, NULL, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        data_json = VALUES(data_json),
        last_seen_at = NOW()
      `,
      [uid, activityId, data_json]
    );

    return res.json({ ok: true });
  } catch (err) {
    console.error("❌ scormCommitActividad error:", err);
    return res.status(500).json({ error: "Error al guardar SCORM commit" });
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

exports.iniciarActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    const meta = await getActivityMeta(activityId);
    if (!meta) return res.status(404).json({ error: "Actividad no encontrada" });
    if (!meta.isActive) return res.status(400).json({ error: "Actividad inactiva" });

    // ─────────────────────────────────────────
    // FINAL QUIZ: consumir intento al INICIAR
    // ─────────────────────────────────────────
    if (meta.type === "final_quiz") {
      const maxAttempts = normalizeMaxAttempts(meta.config?.maxAttempts, 1);

      const [pRows] = await db.query(
        `
        SELECT status, attempts, data_json
        FROM user_activity_progress
        WHERE user_id = ? AND activity_id = ?
        LIMIT 1
        `,
        [uid, activityId]
      );

      const current = pRows[0] || null;
      const status = String(current?.status || "not_started");
      const attemptsUsed = Number(current?.attempts || 0);

      if (status === "completed") {
        return res.status(400).json({ error: "Examen ya completado" });
      }
      if (attemptsUsed >= maxAttempts) {
        return res.status(403).json({
          error: "Sin intentos disponibles",
          attemptsUsed,
          maxAttempts,
        });
      }

      // Consumimos intento ahora
      const nextAttempts = attemptsUsed + 1;

      // Persistimos selección fija (para que refresh no cambie el examen)
      const prevData = safeJsonParse(current?.data_json, {}) || {};
      const prevFinal = prevData?.final_quiz && typeof prevData.final_quiz === "object"
        ? prevData.final_quiz
        : {};

      const bank = Array.isArray(meta.config?.questionsBank) ? meta.config.questionsBank : [];
      const pickCount = Number(meta.config?.pickCount || 0) || 0;

      const pickedIndices =
        Array.isArray(prevFinal?.pickedIndices) && Number(prevFinal?.attemptNumber) === nextAttempts
          ? prevFinal.pickedIndices
          : pickRandomIndices(bank.length, pickCount);

      const dataToSave = {
        ...prevData,
        final_quiz: {
          ...prevFinal,
          attemptNumber: nextAttempts,
          maxAttempts,
          pickCount,
          pickedIndices,
          startedAt: new Date().toISOString(),
        },
      };

      await db.query(
        `
        INSERT INTO user_activity_progress
          (user_id, activity_id, status, attempts, data_json, started_at, last_seen_at)
        VALUES (?, ?, 'in_progress', ?, ?, NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = IF(status='completed', status, 'in_progress'),
          attempts = VALUES(attempts),
          data_json = COALESCE(VALUES(data_json), data_json),
          started_at = COALESCE(started_at, NOW()),
          last_seen_at = NOW()
        `,
        [uid, activityId, nextAttempts, normalizeJsonForDb(dataToSave)]
      );

      return res.json({
        ok: true,
        type: "final_quiz",
        attemptsUsed: nextAttempts,
        maxAttempts,
        pickedCount: pickedIndices.length,
      });
    }

    // ─────────────────────────────────────────
    // Default (otros tipos): comportamiento original
    // ─────────────────────────────────────────
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

exports.completarActividad = async (req, res) => {
  const uid = getProgressUserId(req);
  const activityId = normalizeActivityId(req.params.activityId);

  const score = normalizeScore(req.body?.score);
  const passed = req.body?.passed ?? true;
  const status = passed ? "completed" : "failed";
  const incomingData = req.body?.data_json;

  if (!uid) return res.status(401).json({ error: "No autenticado" });
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  try {
    const meta = await getActivityMeta(activityId);
    if (!meta) return res.status(404).json({ error: "Actividad no encontrada" });
    if (!meta.isActive) return res.status(400).json({ error: "Actividad inactiva" });

    // ─────────────────────────────────────────
    // FINAL QUIZ: NO incrementa intentos aquí.
    // Intentos se consumen al iniciar.
    // ─────────────────────────────────────────
    if (meta.type === "final_quiz") {
      const maxAttempts = normalizeMaxAttempts(meta.config?.maxAttempts, 1);

      const [pRows] = await db.query(
        `
        SELECT status, attempts, data_json
        FROM user_activity_progress
        WHERE user_id = ? AND activity_id = ?
        LIMIT 1
        `,
        [uid, activityId]
      );

      const current = pRows[0] || null;
      const attemptsUsed = Number(current?.attempts || 0);

      // Si alguien intenta completar sin iniciar, consumimos 1 intento aquí (fallback)
      if (attemptsUsed <= 0) {
        if (maxAttempts < 1) {
          return res.status(403).json({ error: "Sin intentos disponibles", attemptsUsed, maxAttempts });
        }
      } else if (attemptsUsed > maxAttempts) {
        return res.status(403).json({ error: "Sin intentos disponibles", attemptsUsed, maxAttempts });
      }

      const prevData = safeJsonParse(current?.data_json, {}) || {};
      const mergedData = {
        ...prevData,
        ...(typeof incomingData === "object" && incomingData ? incomingData : {}),
      };

      const data_json = normalizeJsonForDb(mergedData);

      await db.query(
        `
        INSERT INTO user_activity_progress
          (user_id, activity_id, status, attempts, score, data_json, started_at, completed_at, last_seen_at)
        VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          attempts = GREATEST(COALESCE(attempts,0), VALUES(attempts)),
          score = COALESCE(VALUES(score), score),
          data_json = COALESCE(VALUES(data_json), data_json),
          completed_at = NOW(),
          last_seen_at = NOW()
        `,
        [uid, activityId, status, Math.max(1, attemptsUsed || 1), score, data_json]
      );

      return res.json({ ok: true, status, type: "final_quiz", attemptsUsed: Math.max(1, attemptsUsed || 1), maxAttempts });
    }

    // ─────────────────────────────────────────
    // Default (otros tipos): comportamiento original (+1 intento por completion)
    // ─────────────────────────────────────────
    const data_json = normalizeJsonForDb(incomingData);

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

exports.choosePathActividad = async (req, res) => {
  const uidProgress = getProgressUserId(req);
  const { firebaseUid, dbUserId } = getUserKeys(req);
  const activityId = normalizeActivityId(req.params.activityId);

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

  const ALLOWED = new Set(["COM", "VOL", "MIG", "RDR", "APS", "TUM", "CAP", "PREV"]);
  const invalid = choices.filter((c) => !ALLOWED.has(c));
  if (invalid.length) {
    return res.status(400).json({ error: `choice(s) inválido(s): ${invalid.join(", ")}` });
  }

  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

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

    const enrollmentUserId =
      (Number.isFinite(dbUserId) && dbUserId) || firebaseUid || uidProgress;

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

/**
 * GET /progreso/me/resumen
 *
 * Resumen global del progreso del usuario (por Firebase UID).
 * - activitiesCompleted: cuántas activities tienen status='completed'
 * - daysActive: rango inclusivo entre primera actividad iniciada y última actividad tocada/terminada
 *
 * Fuente de verdad:
 *   user_activity_progress (status, started_at, completed_at, last_seen_at)
 *
 * Nota: NO depende de programas ni catálogo. Cero deuda técnica.
 */
exports.getMiResumen = async (req, res) => {
  const uid = getProgressUserId(req);

  if (!uid) return res.status(401).json({ error: "No autenticado" });

  try {
    const [rows] = await db.query(
      `
      SELECT
        SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS activitiesCompleted,
        MIN(COALESCE(started_at, completed_at, last_seen_at)) AS firstActivityAt,
        MAX(COALESCE(completed_at, last_seen_at, started_at)) AS lastActivityAt
      FROM user_activity_progress
      WHERE user_id = ?
      `,
      [uid]
    );

    const r = rows?.[0] || {};

    const activitiesCompleted = Number(r.activitiesCompleted || 0);

    // DÍAS: rango inclusivo en días. Si solo hay un día => 1.
    // Si no hay actividad => 0.
    const first = r.firstActivityAt ? new Date(r.firstActivityAt) : null;
    const last = r.lastActivityAt ? new Date(r.lastActivityAt) : null;

    let daysActive = 0;
    if (first && last && !Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime())) {
      const MS_PER_DAY = 24 * 60 * 60 * 1000;
      const diffMs = last.getTime() - first.getTime();
      const diffDays = Math.floor(diffMs / MS_PER_DAY);
      daysActive = Math.max(1, diffDays + 1);
    }

    return res.json({
      user_id: uid,
      activitiesCompleted,
      daysActive,
      firstActivityAt: r.firstActivityAt,
      lastActivityAt: r.lastActivityAt,
    });
  } catch (err) {
    console.error("getMiResumen error:", err);
    return res.status(500).json({ error: "Error obteniendo resumen de progreso" });
  }
};
