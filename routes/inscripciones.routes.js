// routes/inscripciones.routes.js
const express = require("express");
const router = express.Router();
const inscCtrl = require("../controllers/inscripciones.controller");
const { authMiddleware } = require("../middlewares/auth");

// YA EXISTE (no tocar)
router.post("/final", authMiddleware, inscCtrl.guardarFinalAprobado);

// ✅ NUEVOS ENDPOINTS (lectura para certificados/reconocimientos)

// Usa el userId del token
router.get("/me/:cursoId/cert-data", authMiddleware, inscCtrl.getCertDataForMe);

// (Opcional, admin) pasar userId explícito en la URL
router.get("/:userId/:cursoId/cert-data", authMiddleware, inscCtrl.getCertDataByUser);

// ✅ NUEVO: conteo de cursos finalizados (DISTINCT curso_id) para el usuario autenticado
router.get("/me/completed-count", authMiddleware, inscCtrl.getCompletedCountForMe);

// ✅ PROGRESO (solo admin/mod): último intento por curso + resumen
router.get("/:userId/progreso", authMiddleware, inscCtrl.getProgresoByUserForAdmins);

// (opcional) que el propio usuario vea su progreso
router.get("/me/progreso", authMiddleware, inscCtrl.getProgresoForMe);

module.exports = router;
