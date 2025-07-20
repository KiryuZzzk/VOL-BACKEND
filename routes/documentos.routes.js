const express = require("express");
const router = express.Router();
const docsCtrl = require("../controllers/documentos.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Solo aspirante puede subir o actualizar sus documentos
router.post("/", authMiddleware, roleMiddleware(["aspirante"]), docsCtrl.guardarDocumentos);

// Cualquiera autenticado (aspirante, moderador, admin) puede obtener documentos con las reglas internas
router.get("/:userId", authMiddleware, docsCtrl.obtenerDocumentosPorUserId);

module.exports = router;