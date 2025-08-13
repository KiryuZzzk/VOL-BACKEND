// middlewares/auth.js
const admin = require("firebase-admin");
const db = require("../config/db");

// Inicializa Admin una sola vez
if (!admin.apps.length) {
  console.log("🔐 Inicializando Firebase Admin SDK...");
const serviceAccount = require("/etc/secrets/firebase-service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

/**
 * 1) AUTENTICACIÓN (solo Firebase):
 *    - Verifica el ID token.
 *    - NO consulta la BD.
 *    - Cuelga req.firebaseUser = { uid, email }.
 *    - 401 si no hay token o es inválido/expirado.
 */
const authFirebase = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization || req.headers.Authorization || "";
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      console.warn("⛔ No se encontró el token Bearer en la cabecera");
      return res.status(401).json({ error: "Falta token de autorización" });
    }

    const token = authHeader.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(token, true); // true => respeta tokens revocados

    req.firebaseUser = {
      uid: decoded.uid,
      email: decoded.email || null,
    };

    console.log("✅ Token verificado con Firebase:", {
      uid: decoded.uid,
      email: decoded.email,
      expira: new Date(decoded.exp * 1000).toISOString(),
    });

    return next();
  } catch (error) {
    console.error("❌ Error en authFirebase (verificar token):", error.message);
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
};

/**
 * 2) Adjunta usuario/roles desde BD (NO bloquea):
 *    - Si existe en BD, cuelga req.dbUser y req.dbRoles (array de strings).
 *    - Si NO existe o hay error de BD, no bloquea; sigue el flujo.
 *    - Útil para que el controlador decida devolver 200 o 404 (p. ej. validar-usuario).
 */
const attachUserFromDB = async (req, res, next) => {
  try {
    const uid = req.firebaseUser?.uid;
    if (!uid) {
      console.warn("⚠️ attachUserFromDB: no hay firebaseUser.uid en el request");
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

    req.dbUser = user;
    req.dbRoles = roles.map((r) => r.nombre_rol);

    console.log("📇 Usuario encontrado en BD:", {
      id: user.id,
      estado: user.estado,
      roles: req.dbRoles,
    });

    return next();
  } catch (error) {
    console.error("❌ Error en attachUserFromDB:", error.message);
    // No bloqueamos; deja que el controlador/restricciones decidan.
    return next();
  }
};

/**
 * 3) AUTORIZACIÓN: exige que esté registrado en BD
 *    - 403 si no hay req.dbUser (no existe en BD).
 */
const requireRegistered = (req, res, next) => {
  if (!req.dbUser) {
    console.warn("🚫 Acceso denegado: usuario no registrado en BD");
    return res.status(403).json({ error: "Usuario no registrado en BD" });
  }
  return next();
};

/**
 * 4) AUTORIZACIÓN: exige tener al menos uno de los rolesPermitidos
 *    - 403 si no hay rol o no coincide.
 */
const requireRoles = (...rolesPermitidos) => (req, res, next) => {
  const roles = req.dbRoles || [];
  console.log("🔐 Verificando permisos. Roles del usuario:", roles, "→ Requiere uno de:", rolesPermitidos);

  const ok = rolesPermitidos.some((r) => roles.includes(r));
  if (!ok) {
    console.warn("🚫 Acceso denegado para roles:", roles, " Requeridos:", rolesPermitidos);
    return res.status(403).json({ error: "No tienes permisos suficientes" });
  }

  console.log("✅ Permiso concedido. Roles del usuario:", roles);
  return next();
};

module.exports = {
  authFirebase,       // verificación de identidad (Firebase)
  attachUserFromDB,   // adjunta perfil/roles si existe (no bloquea)
  requireRegistered,  // exige estar en BD
  requireRoles,       // exige rol(es)
};
