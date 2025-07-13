const db = require("../config/db");

// Obtener todos los usuarios (solo admin/moderador)
exports.getAll = async (req, res) => {
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

  try {
    const [results] = await db.query(sql, params);
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Obtener usuario por UUID (admin/mod/aspirante, con restricción para aspirantes)
exports.getByUserId = async (req, res) => {
  const requestedUserId = req.params.userId;
  const loggedUser = req.user;

  if (!requestedUserId || typeof requestedUserId !== "string") {
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  try {
    if (loggedUser.rol === "aspirante" && requestedUserId !== loggedUser.id) {
      return res.status(403).json({ error: "No tienes permiso para ver este perfil" });
    }

    if (loggedUser.rol === "moderador") {
      const sql = "SELECT * FROM users WHERE id = ? AND estado = ?";
      const [results] = await db.query(sql, [requestedUserId, loggedUser.estado]);
      if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado o fuera de tu alcance" });
      return res.json(results[0]);
    }

    // admin
    const [results] = await db.query("SELECT * FROM users WHERE id = ?", [requestedUserId]);
    if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(results[0]);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Obtener propio perfil (aspirante)
exports.getMiPerfil = async (req, res) => {
  const userId = req.user.id;

  try {
    const [results] = await db.query("SELECT * FROM users WHERE id = ?", [userId]);
    if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });
    res.json(results[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// Actualizar datos del usuario (por UUID, con permisos)
exports.update = async (req, res) => {
  const targetUserId = req.params.userId;
  const loggedUser = req.user;
  const updateFields = { ...req.body };

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

  try {
    const [existingUser] = await db.query("SELECT * FROM users WHERE id = ?", [targetUserId]);
    if (existingUser.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

    const fields = Object.keys(updateFields).map(field => `${field} = ?`).join(", ");
    const values = Object.values(updateFields);
    values.push(targetUserId);

    const sql = `UPDATE users SET ${fields} WHERE id = ?`;
    await db.query(sql, values);

    res.json({ message: "Perfil actualizado correctamente" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
