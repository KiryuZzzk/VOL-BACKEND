const db = require("../config/db");

// Obtener todas las disponibilidades (admin: todas, moderador: solo su estado)
exports.getAll = (req, res) => {
  const { rol, estado } = req.user;

  let sql = "SELECT * FROM disponibilidad";
  const params = [];

  if (rol === "moderador") {
    sql += " WHERE estado = ?";
    params.push(estado);
  }

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

// Obtener disponibilidad por user_id (admin: todas, moderador: su estado, aspirante: su propio user_id)
exports.getByUserId = (req, res) => {
  const requestedUserId = req.params.userId;
  const { id: loggedUserId, rol, estado } = req.user;

  if (!requestedUserId || typeof requestedUserId !== "string") {
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  // Aspirante solo puede acceder a su propia disponibilidad
  if (rol === "aspirante" && requestedUserId !== loggedUserId) {
    return res.status(403).json({ error: "No tienes permiso para ver esta disponibilidad" });
  }

  // Moderador puede acceder solo si el user pertenece a su estado
  const query = rol === "moderador"
    ? `SELECT d.* FROM disponibilidad d JOIN users u ON d.user_id = u.id WHERE d.user_id = ? AND u.estado = ?`
    : `SELECT * FROM disponibilidad WHERE user_id = ?`;

  const params = rol === "moderador" ? [requestedUserId, estado] : [requestedUserId];

  db.query(query, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Disponibilidad no encontrada" });
    res.json(results[0]);
  });
};

// Obtener disponibilidad propia (solo aspirante)
exports.getMiDisponibilidad = (req, res) => {
  const userId = req.user.id;

  db.query("SELECT * FROM disponibilidad WHERE user_id = ?", [userId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Disponibilidad no encontrada" });
    res.json(results[0]);
  });
};

// Actualizar disponibilidad por user_id
exports.update = (req, res) => {
  const targetUserId = req.params.userId;
  const { id: loggedUserId, rol, estado } = req.user;
  const updateFields = { ...req.body };

  delete updateFields.user_id;

  // Aspirante solo puede actualizarse a sí mismo
  if (rol === "aspirante" && targetUserId !== loggedUserId) {
    return res.status(403).json({ error: "No tienes permiso para modificar esta disponibilidad" });
  }

  // Moderador debe verificar que el usuario objetivo esté en su estado
  if (rol === "moderador") {
    const checkSql = "SELECT estado FROM users WHERE id = ?";
    db.query(checkSql, [targetUserId], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

      if (results[0].estado !== estado) {
        return res.status(403).json({ error: "No puedes editar disponibilidad de otro estado" });
      }

      // Validación pasada
      return actualizar(targetUserId, updateFields, res);
    });
  } else {
    // Admin o aspirante autorizado
    return actualizar(targetUserId, updateFields, res);
  }
};

// 🔧 Función auxiliar para actualizar
function actualizar(userId, fields, res) {
  const columnas = Object.keys(fields).map(f => `${f} = ?`).join(", ");
  const valores = Object.values(fields);
  valores.push(userId);

  const sql = `UPDATE disponibilidad SET ${columnas} WHERE user_id = ?`;

  db.query(sql, valores, (err) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ message: "Disponibilidad actualizada correctamente" });
  });
}
