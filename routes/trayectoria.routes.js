const express = require("express");
const router = express.Router();

const trayectoriaCtrl = require("../controllers/trayectoria.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Crear
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["aspirante", "admin", "moderador"]),
  trayectoriaCtrl.crearTrayectoria
);

// Mis trayectorias
router.get("/mios", authMiddleware, trayectoriaCtrl.obtenerMiTrayectoria);

// Admin/mod lista global
router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  trayectoriaCtrl.getAllTrayectoria
);

// Admin/mod status
router.patch(
  "/:trajectoryId/status",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  trayectoriaCtrl.actualizarStatusTrayectoria
);

router.delete("/trayectoria/:trajectoryId", authMiddleware, trayectoriaCtrl.borrarMiTrayectoria);



module.exports = router;
