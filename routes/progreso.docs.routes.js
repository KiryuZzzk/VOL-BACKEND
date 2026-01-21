const express = require("express");
const router = express.Router();

const { authMiddleware, roleMiddleware } = require("../middlewares/auth");
const docsCtrl = require("../controllers/progreso.docs.controller");

// Evidencia (upload) por actividad:
// - POST crea o reemplaza evidencia (1 por actividad si tienes UNIQUE user_id+activity_id)
// - GET obtiene la evidencia del usuario autenticado para esa actividad
// - DELETE borra la evidencia del usuario autenticado para esa actividad

router.post(
  "/actividades/:activityId/docs",
  authMiddleware,
  roleMiddleware(["aspirante", "voluntario", "admin", "moderador"]),
  docsCtrl.upsertActividadDoc
);

router.get(
  "/actividades/:activityId/docs",
  authMiddleware,
  roleMiddleware(["aspirante", "voluntario", "admin", "moderador"]),
  docsCtrl.obtenerDocActividadMio
);

router.delete(
  "/actividades/:activityId/docs",
  authMiddleware,
  roleMiddleware(["aspirante", "voluntario", "admin", "moderador"]),
  docsCtrl.eliminarDocActividadMio
);

module.exports = router;

