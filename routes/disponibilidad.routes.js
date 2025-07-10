const express = require("express");
const router = express.Router();
const disponibilidadCtrl = require("../controllers/disponibilidad.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Obtener todas las disponibilidades (solo admin/moderador)
router.get("/", authMiddleware, roleMiddleware(["admin", "moderador"]), disponibilidadCtrl.getAll);

// Obtener la disponibilidad propia (aspirante)
router.get("/mi-disponibilidad", authMiddleware, roleMiddleware(["aspirante"]), disponibilidadCtrl.getMiDisponibilidad);

// Obtener disponibilidad por user_id (admin/moderador/aspirante)
router.get("/:userId", authMiddleware, roleMiddleware(["admin", "moderador", "aspirante"]), disponibilidadCtrl.getByUserId);

// Actualizar disponibilidad por user_id
router.put("/:userId", authMiddleware, disponibilidadCtrl.update);

module.exports = router;
