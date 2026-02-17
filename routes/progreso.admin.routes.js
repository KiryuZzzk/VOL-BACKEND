const express = require("express");
const router = express.Router();

const progresoAdminController = require("../controllers/progreso.admin.controller");
const { authMiddleware, roleMiddleware, requireModeradorScopes } = require("../middlewares/auth");

// ✅ NUEVO: Lista de programas (selector "Por programa")
router.get(
  "/programas",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.listProgramasAdmin
);

// ✅ NUEVO: Usuarios por programa (por ID)
router.get(
  "/programs/:programId/users",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.getUsersByProgramIdAdmin
);

// ✅ NUEVO: Usuarios por programa (por CODE)
router.get(
  "/programas/:programCode/users",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.getUsersByProgramCodeAdmin
);

// ✅ Programas inscritos
router.get(
  "/users/:userId/programas",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.getProgramasUsuario
);

// ✅ Vista completa del programa (actividades+progreso+doc+request)
router.get(
  "/users/:userId/programas/:programCode",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.getAdminProgramView
);

// ✅ Review de evidencia (doc)
router.patch(
  "/docs/:docId/review",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.reviewDocUsuario
);

// ✅ Review de solicitud (request)
router.patch(
  "/requests/:requestId/review",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  requireModeradorScopes,
  progresoAdminController.reviewRequestUsuario
);

module.exports = router;
