// routes/coordinaciones.routes.js
const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/coordinaciones.controller");
const { authMiddleware, requireRoles } = require("../middlewares/auth");

// Catálogo de coordinaciones (logueado)
router.get("/", authMiddleware, ctrl.getCoordinaciones);

// Mis coordinaciones (trayectoria)
router.get("/me", authMiddleware, ctrl.getMisCoordinaciones);

// Guardar selección (al terminar SV)
router.post("/me", authMiddleware, ctrl.setMisCoordinaciones);

// Cambiar estatus de usuario en coordinación (admin/coordinador)
// Ajusta estos strings a tus roles reales en tabla roles.nombre_rol
router.patch(
  "/:code/users/:userId/status",
  authMiddleware,
  requireRoles("admin", "moderador"),
  ctrl.updateStatusUsuarioEnCoordinacion
);

module.exports = router;
