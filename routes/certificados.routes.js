const express = require("express");
const router = express.Router();
const certificadosCtrl = require("../controllers/certificados.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// 🧠 Obtener tus propios certificados (participante)
router.get(
  "/mis-certificados",
  authMiddleware,
  roleMiddleware(["aspirante","admin","moderador"]),
  certificadosCtrl.getMisCertificados
);

// 🎯 Obtener certificados por user_id (admin/moderador/participante con restricción)
router.get(
  "/:userId",
  authMiddleware,
  roleMiddleware(["admin", "moderador", "aspirante"]),
  certificadosCtrl.getByUserId
);

// 📚 Obtener todos los certificados (solo admin/moderador)
router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  certificadosCtrl.getAll
);

// ➕ Crear nuevo certificado (solo admin/moderador)
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  certificadosCtrl.create
);

// 🛠️ Actualizar certificado por ID (solo admin/moderador)
router.put(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  certificadosCtrl.update
);

// ❌ Eliminar certificado por ID (solo admin/moderador)
router.delete(
  "/:id",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  certificadosCtrl.delete
);

module.exports = router;
