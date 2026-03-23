// routes/enrollment.admin.routes.js
// Gestión de inscripciones a programas — solo ADMIN

const express = require("express");
const router = express.Router();
const ctrl = require("../controllers/enrollment.admin.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

const adminOnly = [authMiddleware, roleMiddleware(["admin"])];

// GET  /admin/enrollment/programs           → lista programas (para select)
router.get("/programs", adminOnly, ctrl.listPrograms);

// GET  /admin/enrollment                    → lista inscripciones (con filtros)
router.get("/", adminOnly, ctrl.listEnrollments);

// POST /admin/enrollment                    → inscribir usuario(s)
router.post("/", adminOnly, ctrl.enrollUser);

// PATCH  /admin/enrollment/:userId/:programId → cambiar status
router.patch("/:userId/:programId", adminOnly, ctrl.updateStatus);

// DELETE /admin/enrollment/:userId/:programId → eliminar inscripción
router.delete("/:userId/:programId", adminOnly, ctrl.deleteEnrollment);

module.exports = router;
