// middlewares/auth.js
const admin = require("firebase-admin");
const db = require("../config/db");

// ─────────────────────────────────────────────────────────────
// Inicialización Firebase Admin
// ─────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  console.log("🔐 Inicializando Firebase Admin SDK...");
  const serviceAccount = require("/etc/secrets/firebase-service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// ─────────────────────────────────────────────────────────────
// 1) AUTENTICACIÓN por Firebase (NO toca BD)
//    -> cuelga req.firebaseUser = { uid, email }
// ─────────────────────────────────────────────────────────────
const authFirebase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("⛔ Falta token Bearer en la cabecera");
      return res.status(401).json({ error: "Falta token de autorización" });
    }
    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token, true); // true: respeta tokens revocados

    req.firebaseUser = { uid: decoded.uid, email: decoded.email || null };

    console.log("✅ Token verificado con Firebase:", {
      uid: decoded.uid,
      email: decoded.email,
      expira: new Date(decoded.exp * 1000).toISOString(),
    });

    return next();
  } catch (error) {
    console.error("❌ authFirebase: error al verificar token:", error.message);
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};

// ─────────────────────────────────────────────────────────────
// 2) Adjunta datos desde BD (NO bloquea)
//    -> si existe en BD: req.dbUser, req.dbRoles (array)
//    -> COMPAT: también llena req.user para controladores legacy
// ─────────────────────────────────────────────────────────────
const attachUserFromDB = async (req, res, next) => {
  try {
    const uid = req.firebaseUser?.uid;
    if (!uid) {
      console.warn("⚠️ attachUserFromDB: no hay firebaseUser.uid");
      return next();
    }

    const [users] = await db.query(
      "SELECT id, estado FROM users WHERE uid = ? LIMIT 1",
      [uid]
    );

    if (!users.length) {
      console.warn("ℹ️ UID válido pero no registrado en BD:", uid);
      return next();
    }

    const user = users[0];
    const [roles] = await db.query(
      "SELECT nombre_rol FROM roles WHERE user_id = ?",
      [user.id]
    );

    req.dbUser  = user;
    req.dbRoles = roles.map(r => r.nombre_rol);

    console.log("📇 Usuario en BD:", { id: user.id, estado: user.estado, roles: req.dbRoles });

    // 🔁 COMPAT LEGACY: popular req.user para controladores antiguos
    req.user = {
      id: user.id,
      estado: user.estado,
      rol: req.dbRoles[0] || null,                 // primer rol como antes
      uid: req.firebaseUser?.uid || null,
      email: req.firebaseUser?.email || null,
    };
    console.log("↩️ Compat: req.user lleno para controladores legacy:", req.user);

    return next();
  } catch (error) {
    console.error("❌ attachUserFromDB: error consultando BD:", error.message);
    // No bloqueamos; las rutas que exijan BD usarán los guards de abajo
    return next();
  }
};

// ─────────────────────────────────────────────────────────────
// 2.5) Adjunta scopes de moderador desde BD (si aplica)
//    -> req.moderatorScopes = [{ estado, program_id, group_code }]
//    -> req.isModerador = boolean
//
// Reglas:
// - Sólo se cargan si el usuario tiene rol 'moderador'.
// - Si es moderador y no tiene scopes activos, por seguridad NO ve nada
//   (esto se puede forzar con requireModeradorScopes, opcional).
// ─────────────────────────────────────────────────────────────
const attachModeratorScopes = async (req, res, next) => {
  try {
    const uid = req.firebaseUser?.uid;
    const roles = req.dbRoles || [];
    const isModerador = roles.includes("moderador");

    req.isModerador = isModerador;
    req.moderatorScopes = [];

    if (!uid || !isModerador) return next();

    const [rows] = await db.query(
      `
      SELECT estado, program_id, group_code
      FROM moderator_scopes
      WHERE moderator_uid = ?
        AND is_active = 1
      `,
      [uid]
    );

    req.moderatorScopes = rows.map((r) => ({
      estado: r.estado ?? null, // NULL => cualquier estado
      program_id: r.program_id === null ? null : Number(r.program_id), // NULL => cualquier programa
      group_code: r.group_code ?? null, // NULL => cualquier grupo (incluye 'SIN_GRUPO')
    }));

    // Compat legacy (si tus controladores usan req.user)
    if (req.user) req.user.moderatorScopes = req.moderatorScopes;

    console.log("🧭 Moderator scopes cargados:", {
      uid,
      count: req.moderatorScopes.length,
      sample: req.moderatorScopes.slice(0, 5),
    });

    return next();
  } catch (error) {
    console.error("❌ attachModeratorScopes: error consultando scopes:", error.message);
    // Por seguridad, si falla, tratamos al moderador como "sin scopes"
    req.isModerador = (req.dbRoles || []).includes("moderador");
    req.moderatorScopes = [];
    if (req.user) req.user.moderatorScopes = [];
    return next();
  }
};

// ─────────────────────────────────────────────────────────────
// (Opcional) Fuerza que un moderador tenga scopes activos.
// Úsalo en rutas donde NO debe existir "moderador sin alcance".
// ─────────────────────────────────────────────────────────────
const requireModeradorScopes = (req, res, next) => {
  if (!req.isModerador) return next();
  const scopes = req.moderatorScopes || [];
  if (!scopes.length) {
    console.warn("🚫 requireModeradorScopes: moderador sin scopes activos:", req.firebaseUser?.uid);
    return res.status(403).json({ error: "Moderador sin permisos asignados" });
  }
  return next();
};

// ─────────────────────────────────────────────────────────────
// Helper: JOIN de autorización para moderadores (para usar en controllers)
//
// Uso típico:
//   const { join, params } = getModeradorScopeJoin(req, { userAlias:"u", enrollmentAlias:"upe" });
//   const [rows] = await db.query(`SELECT ... FROM users u JOIN user_program_enrollment upe ... ${join} WHERE ...`, params);
//
// Nota: para admin NO agregues este JOIN.
// ─────────────────────────────────────────────────────────────
const getModeradorScopeJoin = (req, opts = {}) => {
  const userAlias = opts.userAlias || "u";
  const enrollmentAlias = opts.enrollmentAlias || "upe";
  const scopesAlias = opts.scopesAlias || "ms";

  // Si no es moderador, no se agrega nada
  if (!req.isModerador) return { join: "", params: [] };

  const uid = req.firebaseUser?.uid;
  // Si no hay UID, mejor bloquear aguas abajo con requireRegistered / requireRoles
  if (!uid) return { join: "/* missing uid */", params: [] };

  const join = `
JOIN moderator_scopes ${scopesAlias}
  ON ${scopesAlias}.moderator_uid = ?
 AND ${scopesAlias}.is_active = 1
 AND (${scopesAlias}.estado IS NULL OR ${scopesAlias}.estado COLLATE utf8mb4_unicode_ci = ${userAlias}.estado COLLATE utf8mb4_unicode_ci)
 AND (${scopesAlias}.program_id IS NULL OR ${scopesAlias}.program_id = ${enrollmentAlias}.program_id)
 AND (${scopesAlias}.group_code IS NULL OR ${scopesAlias}.group_code COLLATE utf8mb4_unicode_ci = ${enrollmentAlias}.group_code COLLATE utf8mb4_unicode_ci)
`;

  return { join, params: [uid] };
};

// ─────────────────────────────────────────────────────────────
// 3) AUTORIZACIÓN: exige estar registrado en BD
// ─────────────────────────────────────────────────────────────
const requireRegistered = (req, res, next) => {
  if (!req.dbUser) {
    console.warn("🚫 requireRegistered: usuario no registrado en BD");
    return res.status(403).json({ error: "Usuario no registrado en BD" });
  }
  return next();
};

// ─────────────────────────────────────────────────────────────
// 4) AUTORIZACIÓN: exige tener al menos uno de los rolesPermitidos
// ─────────────────────────────────────────────────────────────
const requireRoles = (...rolesPermitidos) => (req, res, next) => {
  const roles = req.dbRoles || [];
  console.log("🔐 requireRoles: usuario tiene", roles, " | se requieren:", rolesPermitidos);
  const ok = rolesPermitidos.some(r => roles.includes(r));
  if (!ok) {
    console.warn("🚫 requireRoles: acceso denegado. Roles:", roles, " Requeridos:", rolesPermitidos);
    return res.status(403).json({ error: "No tienes permisos suficientes" });
  }
  console.log("✅ requireRoles: permiso concedido");
  return next();
};

// (Opcional) 5) Dueño del recurso o rol permitido
const requireSelfOrRoles = (...rolesPermitidos) => (req, res, next) => {
  const pathId = Number(req.params.userId);
  const dbUser = req.dbUser;
  const roles = req.dbRoles || [];

  console.log("👤 requireSelfOrRoles → pathId:", pathId, " dbUser:", dbUser?.id, " roles:", roles, " req:", rolesPermitidos);

  if (!dbUser?.id) {
    console.warn("🚫 requireSelfOrRoles: no hay dbUser en request");
    return res.status(403).json({ error: "Usuario no registrado en BD" });
  }

  if (!Number.isNaN(pathId) && pathId === Number(dbUser.id)) {
    console.log("✅ requireSelfOrRoles: acceso concedido por ser el dueño del recurso");
    return next();
  }

  const ok = rolesPermitidos.some(r => roles.includes(r));
  if (ok) {
    console.log("✅ requireSelfOrRoles: acceso concedido por rol");
    return next();
  }

  console.warn("🚫 requireSelfOrRoles: acceso denegado. Roles del usuario:", roles, "Requeridos:", rolesPermitidos);
  return res.status(403).json({ error: "No tienes permisos suficientes" });
};

// ─────────────────────────────────────────────────────────────
// ⚙️ COMPATIBILIDAD RETRO
// authMiddleware = authFirebase + attachUserFromDB + requireRegistered
// roleMiddleware([...roles]) = requireRoles(...roles)
// ─────────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  // Ejecutamos en cadena; cada middleware decide si responde o llama next()
  return authFirebase(req, res, () => {
    return attachUserFromDB(req, res, () => {
      return attachModeratorScopes(req, res, () => {
        return requireRegistered(req, res, next);
      });
    });
  });
};

const roleMiddleware = (rolesPermitidos = []) => requireRoles(...rolesPermitidos);

module.exports = {
  // Nuevos (recomendados para rutas nuevas):
  authFirebase,
  attachUserFromDB,
  attachModeratorScopes,
  requireModeradorScopes,
  getModeradorScopeJoin,
  requireRegistered,
  requireRoles,
  requireSelfOrRoles, // opcional si decides usarlo

  // Compatibilidad con rutas actuales:
  authMiddleware,
  roleMiddleware,
};

