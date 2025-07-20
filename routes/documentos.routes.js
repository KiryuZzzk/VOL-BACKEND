const express = require("express");
const router = express.Router();
const docsCtrl = require("../controllers/documentos.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Guardar o actualizar documentos
router.post("/", authMiddleware, roleMiddleware(["aspirante"]), docsCtrl.guardarDocumentos);

// Obtener documentos de un usuario
router.get("/:userId", authMiddleware, docsCtrl.obtenerDocumentosPorUserId);

module.exports = router;