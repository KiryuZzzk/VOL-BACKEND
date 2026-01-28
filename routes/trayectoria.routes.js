const express = require("express");
const router = express.Router();

const trayectoriaCtrl = require("../controllers/trayectoria.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

/**
 * ─────────────────────────────────────────────────────────────
 *  Usuario
 * ─────────────────────────────────────────────────────────────
 */

// Crear
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["aspirante", "admin", "moderador"]),
  trayectoriaCtrl.crearTrayectoria
);

// Mis trayectorias
router.get("/mios", authMiddleware, trayectoriaCtrl.obtenerMiTrayectoria);

// Borrado lógico (solo dueño)
router.delete("/:trajectoryId", authMiddleware, trayectoriaCtrl.borrarMiTrayectoria);

/**
 * ─────────────────────────────────────────────────────────────
 *  Admin / Moderador (revisión)
 * ─────────────────────────────────────────────────────────────
 */

// Lista global + filtros
router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  trayectoriaCtrl.getAllTrayectoria
);

// Actualizar status por params (compat)
router.patch(
  "/:trajectoryId/status",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  trayectoriaCtrl.actualizarStatusTrayectoria
);

// Actualizar status estilo "documentos/estado" (por body)
router.patch(
  "/estado",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  trayectoriaCtrl.actualizarEstadoTrayectoria
);

// Ver detalle puntual
router.get(
  "/:trajectoryId",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  trayectoriaCtrl.obtenerTrayectoriaPorIdAdmin
);

module.exports = router;

