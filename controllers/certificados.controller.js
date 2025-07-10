const db = require("../config/db");
const { v4: uuidv4 } = require("uuid");

// 🔥 Obtener todos los certificados (admin: todos, moderador: solo de su estado)
exports.getAll = (req, res) => {
  const { rol, estado } = req.user;

  let sql = "SELECT * FROM certificados";
  const params = [];

  if (rol === "moderador") {
    sql += " WHERE user_id IN (SELECT id FROM users WHERE estado = ?)";
    params.push(estado);
  }

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(results);
  });
};

// 🎯 Obtener certificados por user_id
exports.getByUserId = (req, res) => {
  const requestedUserId = req.params.userId;
  const { id: loggedUserId, rol, estado } = req.user;

  if (!requestedUserId || typeof requestedUserId !== "string") {
    return res.status(400).json({ error: "Parámetro userId inválido" });
  }

  if (rol === "aspirante" && requestedUserId !== loggedUserId) {
    return res.status(403).json({ error: "No tienes permiso para ver estos certificados" });
  }

  const sql = rol === "moderador"
    ? "SELECT c.* FROM certificados c JOIN users u ON c.user_id = u.id WHERE c.user_id = ? AND u.estado = ?"
    : "SELECT * FROM certificados WHERE user_id = ?";

  const params = rol === "moderador" ? [requestedUserId, estado] : [requestedUserId];

  db.query(sql, params, (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Certificados no encontrados" });
    res.json(results);
  });
};

// 🧠 Obtener propios certificados (aspirante)
exports.getMisCertificados = (req, res) => {
  const userId = req.user.id;

  db.query("SELECT * FROM certificados WHERE user_id = ?", [userId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "No tienes certificados registrados" });
    res.json(results);
  });
};

// ➕ Crear nuevo certificado (admin: siempre, moderador: solo si el user_id pertenece a su estado)
exports.create = (req, res) => {
  const { rol, estado } = req.user;
  const { user_id, nombre, tipo, fecha_expedicion, fecha_vencimiento } = req.body;

  if (!user_id || !nombre || !tipo || !fecha_expedicion) {
    return res.status(400).json({ error: "Faltan campos obligatorios" });
  }

  const continueInsert = () => {
    const id = uuidv4();
    const sql = `
      INSERT INTO certificados (id, user_id, nombre, tipo, fecha_expedicion, fecha_vencimiento)
      VALUES (?, ?, ?, ?, ?, ?)
    `;

    db.query(sql, [id, user_id, nombre, tipo, fecha_expedicion, fecha_vencimiento || null], (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Certificado creado correctamente", id });
    });
  };

  if (rol === "moderador") {
    const checkEstado = "SELECT estado FROM users WHERE id = ?";
    db.query(checkEstado, [user_id], (err, results) => {
      if (err) return res.status(500).json({ error: err.message });
      if (results.length === 0) return res.status(404).json({ error: "Usuario no encontrado" });

      if (results[0].estado !== estado) {
        return res.status(403).json({ error: "No puedes crear certificados para usuarios de otro estado" });
      }

      continueInsert();
    });
  } else {
    continueInsert(); // Admin
  }
};

// ✏️ Actualizar certificado por ID (admin: siempre, moderador: solo si pertenece a su estado)
exports.update = (req, res) => {
  const { rol, estado } = req.user;
  const certificadoId = req.params.id;
  const updateFields = { ...req.body };

  delete updateFields.id;
  delete updateFields.user_id;

  const updateNow = () => {
    const fields = Object.keys(updateFields).map(field => `${field} = ?`).join(", ");
    const values = Object.values(updateFields);
    values.push(certificadoId);

    const sql = `UPDATE certificados SET ${fields} WHERE id = ?`;
    db.query(sql, values, (err) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ message: "Certificado actualizado correctamente" });
    });
  };

  const sql = `
    SELECT c.*, u.estado
    FROM certificados c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `;

  db.query(sql, [certificadoId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Certificado no encontrado" });

    if (rol === "moderador" && results[0].estado !== estado) {
      return res.status(403).json({ error: "No puedes editar certificados de otro estado" });
    }

    updateNow();
  });
};

// 🗑️ Eliminar certificado por ID (admin: siempre, moderador: solo si pertenece a su estado)
exports.delete = (req, res) => {
  const { rol, estado } = req.user;
  const certificadoId = req.params.id;

  const sql = `
    SELECT c.id, u.estado
    FROM certificados c
    JOIN users u ON c.user_id = u.id
    WHERE c.id = ?
  `;

  db.query(sql, [certificadoId], (err, results) => {
    if (err) return res.status(500).json({ error: err.message });
    if (results.length === 0) return res.status(404).json({ error: "Certificado no encontrado" });

    if (rol === "moderador" && results[0].estado !== estado) {
      return res.status(403).json({ error: "No puedes eliminar certificados de otro estado" });
    }

    db.query("DELETE FROM certificados WHERE id = ?", [certificadoId], (err2, res2) => {
      if (err2) return res.status(500).json({ error: err2.message });
      res.json({ message: "Certificado eliminado correctamente" });
    });
  });
};
