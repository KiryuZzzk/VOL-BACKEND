const express = require("express");
const router = express.Router();
const usersCtrl = require("../controllers/users.controller");
const { authMiddleware, roleMiddleware, requireModeradorScopes } = require("../middlewares/auth");

// Obtener todos los usuarios (solo admin/mod)
router.get("/", authMiddleware, roleMiddleware(["admin", "moderador"]), requireModeradorScopes, usersCtrl.getAll);

// Obtener usuario por ID (admin/mod/aspirante)
router.get("/:userId", authMiddleware, roleMiddleware(["admin", "moderador", "aspirante"]), requireModeradorScopes, usersCtrl.getByUserId);

// Actualizar usuario (por ID)
router.put("/:userId", authMiddleware, requireModeradorScopes, usersCtrl.update);

// Elegir Coordinación
router.post("/:userId/coordinaciones", authMiddleware, requireModeradorScopes, usersCtrl.setCoordinaciones);

module.exports = router;
