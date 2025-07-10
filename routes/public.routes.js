const express = require("express");
const router = express.Router();
const publicController = require("../controllers/public.controller");

router.post("/register", publicController.registerUser);
router.get("/validar-usuario", publicController.validarUsuario);

module.exports = router;
