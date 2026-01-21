const express = require("express");
const router = express.Router();

const adminCtrl = require("../controllers/progreso.admin.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// ✅ solo admin/mod (idéntico a documentos)
router.get(
  "/admin/:userId/programas",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  adminCtrl.getProgramasUsuario
);

router.get(
  "/admin/:userId/programas/:programCode/progreso",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  adminCtrl.getProgresoProgramaUsuario
);

router.get(
  "/admin/:userId/docs",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  adminCtrl.getDocsUsuario
);

router.patch(
  "/admin/:userId/docs/:docId/review",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  adminCtrl.reviewDocUsuario
);

module.exports = router;
