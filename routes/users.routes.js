const express = require("express");
const router = express.Router();
const usersCtrl = require("../controllers/users.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Obtener todos los usuarios (solo admin/mod)
router.get("/", authMiddleware, roleMiddleware(["admin", "moderador"]), usersCtrl.getAll);

// Obtener usuario por ID (admin/mod/aspirante)
router.get("/:userId", authMiddleware, roleMiddleware(["admin", "moderador", "aspirante"]), usersCtrl.getByUserId);

// Actualizar usuario (por ID)
router.put("/:userId", authMiddleware, usersCtrl.update);

module.exports = router;
