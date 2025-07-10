const express = require("express");
const router = express.Router();
const publicController = require("../controllers/public.controller");
const { authMiddleware } = require("../middlewares/auth");

router.post("/register", publicController.registerUser);
router.get("/validar-usuario", authMiddleware, publicController.validarUsuario);

module.exports = router;
