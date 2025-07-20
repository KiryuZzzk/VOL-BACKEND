const admin = require("firebase-admin");
const db = require("../config/db");

if (!admin.apps.length) {
  console.log("🔐 Inicializando Firebase Admin SDK...");
  const serviceAccount = require("/etc/secrets/firebase-service-account.json");

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Middleware de autenticación
const authMiddleware = async (req, res, next) => {
const authHeader = req.headers.authorization || req.headers.Authorization;


  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    console.warn("⛔ No se encontró el token Bearer en la cabecera");
    return res.status(401).json({ error: "Falta token de autorización" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verifica el token con Firebase
    const decoded = await admin.auth().verifyIdToken(token);
    console.log("✅ Token verificado con Firebase:", {
      uid: decoded.uid,
      email: decoded.email,
      expira: new Date(decoded.exp * 1000).toISOString(),
    });

    const uid = decoded.uid;

    // Consulta si el UID está en la BD
    const [userResults] = await db.query(
      "SELECT id, estado FROM users WHERE uid = ? LIMIT 1",
      [uid]
    );

    if (userResults.length === 0) {
      console.warn("⚠️ UID válido pero no registrado en BD:", uid);
      return res.status(403).json({ error: "Usuario no registrado en BD" });
    }

    const { id, estado } = userResults[0];
    console.log("📇 Usuario encontrado en BD:", { id, estado });

    // Consulta el rol
    const [rolResults] = await db.query(
      "SELECT nombre_rol AS rol FROM roles WHERE user_id = ? LIMIT 1",
      [id]
    );

    if (rolResults.length === 0) {
      console.warn("⚠️ Usuario en BD pero sin rol asignado:", id);
      return res.status(403).json({ error: "Rol no asignado" });
    }

    const rol = rolResults[0].rol;

    // Todo correcto, se añade info al request
    req.user = {
      id,
      estado,
      rol,
      uid,
    };

    console.log("🛡️ Usuario autenticado:", req.user);
    next();

  } catch (error) {
    console.error("❌ Error al verificar token:", error.message);
    console.error("🔍 Detalles del error:", error);
    return res.status(403).json({ error: "Token inválido o expirado" });
  }
};

// Middleware de roles
const roleMiddleware = (rolesPermitidos = []) => {
  return (req, res, next) => {
    const rolUsuario = req.user?.rol;
    console.log("🔐 Verificando permisos para rol:", rolUsuario);

    if (!rolUsuario || !rolesPermitidos.includes(rolUsuario)) {
      console.warn("🚫 Acceso denegado para el rol:", rolUsuario);
      return res.status(403).json({ error: "No tienes permisos suficientes" });
    }

    console.log("✅ Permiso concedido para rol:", rolUsuario);
    next();
  };
};

module.exports = {
  authMiddleware,
  roleMiddleware,
};
