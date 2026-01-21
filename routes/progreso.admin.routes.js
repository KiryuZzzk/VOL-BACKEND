const express = require("express");
const router = express.Router();

const progresoAdminController = require("../controllers/progreso.admin.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// ✅ Programas inscritos
router.get(
  "/users/:userId/programas",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.getProgramasUsuario
);

// ✅ Vista completa del programa (actividades+progreso+doc)
router.get(
  "/users/:userId/programas/:programCode",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.getAdminProgramView
);

// ✅ Review de evidencia (doc)
router.patch(
  "/docs/:docId/review",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.reviewDocUsuario
);

module.exports = router;
