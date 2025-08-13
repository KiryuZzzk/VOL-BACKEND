// middlewares/auth.js
const admin = require("firebase-admin");
const db = require("../config/db");

// ─────────────────────────────────────────────────────────────
// Inicialización Firebase Admin
// ─────────────────────────────────────────────────────────────
if (!admin.apps.length) {
  console.log("🔐 Inicializando Firebase Admin SDK...");
  // const serviceAccount = require("/etc/secrets/firebase-service-account.json");
  const serviceAccount = require("/config/firebase-service-account.json");
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

    return next();
  } catch (error) {
    console.error("❌ attachUserFromDB: error consultando BD:", error.message);
    // No bloqueamos; las rutas que exijan BD usarán los guards de abajo
    return next();
  }
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

// ─────────────────────────────────────────────────────────────
// ⚙️ COMPATIBILIDAD RETRO
// authMiddleware = authFirebase + attachUserFromDB + requireRegistered
// roleMiddleware([...roles]) = requireRoles(...roles)
// Para no romper tus rutas existentes.
// ─────────────────────────────────────────────────────────────
const authMiddleware = async (req, res, next) => {
  // Ejecutamos secuencialmente con logs
  return authFirebase(req, res, async (err1) => {
    if (err1) return; // respuesta ya enviada
    return attachUserFromDB(req, res, async (err2) => {
      if (err2) return;
      return requireRegistered(req, res, next);
    });
  });
};

const roleMiddleware = (rolesPermitidos = []) => {
  return requireRoles(...rolesPermitidos);
};

module.exports = {
  // Nuevos (recomendados para rutas nuevas):
  authFirebase,
  attachUserFromDB,
  requireRegistered,
  requireRoles,

  // Compatibilidad con tus rutas actuales:
  authMiddleware,
  roleMiddleware,
};
