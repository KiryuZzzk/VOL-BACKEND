const express = require("express");
const router = express.Router();
const usersCtrl = require("../controllers/users.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Obtener todos los usuarios (solo admin/mod)
router.get("/", authMiddleware, roleMiddleware(["admin", "moderador"]), usersCtrl.getAll);

// Obtener tu propio perfil (aspirante)
router.get("/mi-perfil", authMiddleware, roleMiddleware(["aspirante"]), usersCtrl.getMiPerfil);

// Obtener un usuario por UUID (admin/mod/aspirante)
router.get("/:userId", authMiddleware, roleMiddleware(["admin", "moderador", "aspirante"]), usersCtrl.getByUserId);

// Actualizar usuario (por UUID)
router.put("/:userId", authMiddleware, usersCtrl.update);

module.exports = router;
