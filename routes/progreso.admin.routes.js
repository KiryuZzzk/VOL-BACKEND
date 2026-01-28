const express = require("express");
const router = express.Router();

const progresoAdminController = require("../controllers/progreso.admin.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// ✅ NUEVO: Lista de programas (selector "Por programa")
router.get(
  "/programas",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.listProgramasAdmin
);

// ✅ NUEVO: Usuarios por programa (por ID)
router.get(
  "/programs/:programId/users",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.getUsersByProgramIdAdmin
);

// ✅ NUEVO: Usuarios por programa (por CODE)
router.get(
  "/programas/:programCode/users",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.getUsersByProgramCodeAdmin
);

// ✅ Programas inscritos
router.get(
  "/users/:userId/programas",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.getProgramasUsuario
);

// ✅ Vista completa del programa (actividades+progreso+doc+request)
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

// ✅ Review de solicitud (request)
router.patch(
  "/requests/:requestId/review",
  authMiddleware,
  roleMiddleware(["admin", "superadmin"]),
  progresoAdminController.reviewRequestUsuario
);

module.exports = router;
