const express = require("express");
const router = express.Router();
const inscCtrl = require("../controllers/inscripciones.controller");
const { authMiddleware } = require("../middlewares/auth");

// Guarda/actualiza la inscripción al aprobar examen final (rol indiferente)
router.post("/final", authMiddleware, inscCtrl.guardarFinalAprobado);

module.exports = router;
