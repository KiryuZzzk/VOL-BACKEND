const express = require("express");
const router = express.Router();
const publicController = require("../controllers/public.controller");
const { authFirebase } = require("../middlewares/auth"); // 👈 usa el nuevo

// Registro sin token
router.post("/register", publicController.registerUser);

// ✅ Validación de usuario con token Firebase (NO exige existir en BD en el middleware)
router.get("/validar-usuario", authFirebase, publicController.validarUsuario);

module.exports = router;