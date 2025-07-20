const express = require("express");
const router = express.Router();
const docsCtrl = require("../controllers/documentos.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Solo aspirante puede subir sus documentos
router.post("/", authMiddleware, roleMiddleware(["aspirante"]), docsCtrl.guardarDocumentos);

// Cualquiera autenticado puede obtener documentos, con seguridad interna en el controller
router.get("/:userId", authMiddleware, docsCtrl.obtenerDocumentosPorUserId);

module.exports = router;
