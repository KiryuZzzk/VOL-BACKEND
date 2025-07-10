const express = require("express");
const router = express.Router();
const publicController = require("../controllers/public.controller");
const { authMiddleware } = require("../middlewares/auth");

// Registro sin token
router.post("/register", publicController.registerUser);

// Validación de usuario con token (requiere estar autenticado)
router.get("/validar-usuario", authMiddleware, publicController.validarUsuario);

module.exports = router;
