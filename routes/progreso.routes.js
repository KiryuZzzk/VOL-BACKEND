const express = require("express");
const router = express.Router();

const catalogoCtrl = require("../controllers/progreso.catalogo.controller");
const progresoCtrl = require("../controllers/progreso.controller");
const { authMiddleware } = require("../middlewares/auth");

// 📚 CATÁLOGO (estructura)
router.get(
  "/catalogo/programas/:code/arbol",
  authMiddleware,
  catalogoCtrl.getProgramaArbol
);

// 📈 PROGRESO DEL USUARIO
router.get(
  "/me/programas/:code",
  authMiddleware,
  progresoCtrl.getMiProgresoPrograma
);

router.post(
  "/actividades/:activityId/iniciar",
  authMiddleware,
  progresoCtrl.iniciarActividad
);

router.post(
  "/actividades/:activityId/completar",
  authMiddleware,
  progresoCtrl.completarActividad
);

router.post(
  "/actividades/:activityId/heartbeat",
  authMiddleware,
  progresoCtrl.heartbeatActividad
);

module.exports = router;
