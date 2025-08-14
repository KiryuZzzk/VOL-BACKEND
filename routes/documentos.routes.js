const express = require("express");
const router = express.Router();
const docsCtrl = require("../controllers/documentos.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Subir/actualizar documentos (aspirante/admin/mod)
router.post(
  "/",
  authMiddleware,
  roleMiddleware(["aspirante", "admin", "moderador"]),
  docsCtrl.guardarDocumentos
);

// Obtener TODOS (solo admin/mod)
router.get(
  "/",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  docsCtrl.getAll
);

// Estado de documento (admin/mod)
router.patch(
  "/estado",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  docsCtrl.actualizarEstadoDocumento
);

// 🔹 Mis documentos (usuario autenticado y registrado en BD)
router.get(
  "/mios",
  authMiddleware, // ya valida firebase + BD
  docsCtrl.obtenerMisDocumentos
);

// 🔹 Documentos por userId (solo admin/mod)
router.get(
  "/:userId",
  authMiddleware,
  roleMiddleware(["admin", "moderador"]),
  docsCtrl.obtenerDocumentosPorUserId
);

module.exports = router;
