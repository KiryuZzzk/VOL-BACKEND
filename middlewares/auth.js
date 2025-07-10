const admin = require("firebase-admin");
const db = require("../config/db");

// Inicializar Firebase Admin (solo una vez)
if (!admin.apps.length) {
  const serviceAccount = require("../config/firebase-service-account.json");
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Falta token de autorización" });
  }

  const token = authHeader.split(" ")[1];

  try {
    // Verifica token Firebase
    const decodedToken = await admin.auth().verifyIdToken(token);
    const firebaseUid = decodedToken.uid;

    // Busca el id interno y estado en tu base
    const sqlUser = "SELECT id, estado FROM users WHERE uid = ? LIMIT 1";
    db.query(sqlUser, [firebaseUid], (err, userResults) => {
      if (err) return res.status(500).json({ error: "Error al verificar usuario" });
      if (userResults.length === 0) return res.status(403).json({ error: "Usuario no registrado" });

      const { id, estado } = userResults[0];

      // Busca el rol
      const sqlRol = "SELECT nombre_rol AS rol FROM roles WHERE user_id = ? LIMIT 1";
      db.query(sqlRol, [id], (err2, rolResults) => {
        if (err2) return res.status(500).json({ error: "Error al verificar rol" });
        if (rolResults.length === 0) return res.status(403).json({ error: "Rol no asignado" });

        // Guarda el usuario autenticado en req.user
        req.user = {
          id,
          rol: rolResults[0].rol,
          estado,
        };

        console.log("🛡️ Usuario autenticado:", req.user);
        next();
      });
    });
  } catch (error) {
    console.error("❌ Token inválido o expirado:", error);
    return res.status(403).json({ error: "Token inválido o expirado" });
  }
};

const roleMiddleware = (allowedRoles) => {
  return (req, res, next) => {
    const userRole = req.user?.rol;
    if (!userRole || !allowedRoles.includes(userRole)) {
      return res.status(403).json({ error: "No tienes permisos suficientes" });
    }
    next();
  };
};

module.exports = { authMiddleware, roleMiddleware };
