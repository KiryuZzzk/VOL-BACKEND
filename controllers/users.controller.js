const getDB = require("../config/db");
const db = getDB(); // ← ahora pides la conexión activa

// Obtener todos los usuarios (solo admin/moderador)
// Moderador solo ve usuarios de su estado, admin ve todo
exports.getAll = (req, res) => {
  const { rol, estado } = req.user;

  let sql;
  let params = [];

  if (rol === "moderador") {
    sql = "SELECT * FROM users WHERE estado = ?";
    params = [estado];
  } else if (rol === "admin") {
    sql = "SELECT * FROM users";
  } else {
    return res.status(403).json({ error: "No tienes permisos suficientes para esta acción" });
  }

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

// Obtener usuario por UUID (admin/mod/aspirante, con restricción para aspirantes)
exports.getByUserId = (req, res) => {
  const requestedUserId = req.params.userId;
  const loggedUser = req.user;

  if (!requestedUserId || typeof requestedUserId !== "string") {
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  // Aspirante solo puede ver su propio perfil
  if (loggedUser.rol === "aspirante" && requestedUserId !== loggedUser.id) {
    return res.status(403).json({ error: "No tienes permiso para ver este perfil" });
  }

  // Moderador solo puede ver usuarios de su estado
  if (loggedUser.rol === "moderador") {
    const sql = "SELECT * FROM users WHERE id = ? AND estado = ?";
    db.query(sql, [requestedUserId, loggedUser.estado], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado o fuera de tu alcance" });
      res.json(results[0]);
    });
    return;
  }

  // Admin puede ver cualquier perfil
  db.query("SELECT * FROM users WHERE id = ?", [requestedUserId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(results[0]);
  });
};

// Obtener propio perfil (aspirante)
exports.getMiPerfil = (req, res) => {
  const userId = req.user.id;

  db.query("SELECT * FROM users WHERE id = ?", [userId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(results[0]);
  });
};

// Actualizar datos del usuario (por UUID, con permisos)
exports.update = (req, res) => {
  const targetUserId = req.params.userId;
  const loggedUser = req.user;
  const updateFields = { ...req.body }; // clona para no mutar req.body directamente

  // Solo el usuario puede modificar su propio perfil
  if (targetUserId !== loggedUser.id) {
    return res.status(403).json({ error: "No tienes permiso para modificar este perfil" });
  }

  // Bloquear edición de campos sensibles
  delete updateFields.id;
  delete updateFields.matricula;
  delete updateFields.uid;
  delete updateFields.correo;
  delete updateFields.estado_validacion;

  if (Object.keys(updateFields).length === 0) {
    return res.status(400).json({ error: "No se enviaron campos para actualizar o solo campos no editables" });
  }

  db.query("SELECT * FROM users WHERE id = ?", [targetUserId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    const fields = Object.keys(updateFields).map(field => `${field} = ?`).join(", ");
    const values = Object.values(updateFields);
    values.push(targetUserId);

    const sql = `UPDATE users SET ${fields} WHERE id = ?`;
    db.query(sql, values, (err2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: "Perfil actualizado correctamente" });
    });
  });
};
