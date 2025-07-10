const admin = require("firebase-admin");
const db = require("../config/db");

// Inicializar Firebase Admin (una vez)
if (!admin.apps.length) {
  const serviceAccount = require("/etc/secrets/firebase-service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

// Middleware de autenticación
const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token de autorización" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // 1. Verifica el token de Firebase
    const decoded = await admin.auth().verifyIdToken(token);
    const firebaseUid = decoded.uid;

    // 2. Busca al usuario en la base de datos interna
    const sqlUser = "SELECT id, estado FROM users WHERE uid = ? LIMIT 1";
    db.query(sqlUser, [firebaseUid], (err, userResults) => {
      if (err) return res.status(500).json({ error: "Error al verificar usuario" });
      if (userResults.length === 0) return res.status(403).json({ error: "Usuario no registrado en DB" });

      const { id, estado } = userResults[0];

      // 3. Obtiene el rol del usuario
      const sqlRol = "SELECT nombre_rol AS rol FROM roles WHERE user_id = ? LIMIT 1";
      db.query(sqlRol, [id], (err2, rolResults) => {
        if (err2) return res.status(500).json({ error: "Error al obtener rol" });
        if (rolResults.length === 0) return res.status(403).json({ error: "Rol no asignado" });

        req.user = {
          id,
          estado,
          rol: rolResults[0].rol,
          uid: firebaseUid
        };

        console.log("🛡️ Usuario autenticado:", req.user);
        next();
      });
    });
  } catch (error) {
    console.error("❌ Token inválido o expirado:", error.message);
    return res.status(403).json({ error: "Token inválido o expirado" });
  }
};

const roleMiddleware = (rolesPermitidos) => {
  return (req, res, next) => {
    const rolUsuario = req.user?.rol;
    if (!rolUsuario || !rolesPermitidos.includes(rolUsuario)) {
      return res.status(403).json({ error: "No tienes permisos suficientes" });
    }
    next();
  };
};

module.exports = { authMiddleware, roleMiddleware };
