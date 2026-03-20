// routes/catalog.admin.routes.js
// Gestión del catálogo de cursos — SOLO admin (sin moderadores)

const express = require("express");
const router = express.Router();

const ctrl = require("../controllers/catalog.admin.controller");
const { authMiddleware, roleMiddleware } = require("../middlewares/auth");

// Middleware común a todas las rutas de este archivo
const adminOnly = [authMiddleware, roleMiddleware(["admin"])];

// ── Programas ──────────────────────────────────────────────────
// GET  /admin/catalog/programs               → lista todos los programas
router.get("/programs", adminOnly, ctrl.listPrograms);

// GET  /admin/catalog/programs/:code/tree    → árbol completo (incluye inactivos)
router.get("/programs/:code/tree", adminOnly, ctrl.getProgramTree);

// POST /admin/catalog/programs               → crear / upsert programa
router.post("/programs", adminOnly, ctrl.createProgram);

// PATCH /admin/catalog/programs/:code        → editar campos de un programa
router.patch("/programs/:code", adminOnly, ctrl.patchProgram);

// ── Bloques ────────────────────────────────────────────────────
// POST  /admin/catalog/programs/:code/blocks → añadir / upsert bloque
router.post("/programs/:code/blocks", adminOnly, ctrl.createBlock);

// PATCH /admin/catalog/blocks/:blockId       → editar campos de un bloque
router.patch("/blocks/:blockId", adminOnly, ctrl.patchBlock);

// ── Módulos ────────────────────────────────────────────────────
// POST  /admin/catalog/blocks/:blockId/modules → añadir / upsert módulo
router.post("/blocks/:blockId/modules", adminOnly, ctrl.createModule);

// PATCH /admin/catalog/modules/:moduleId     → editar campos de un módulo
router.patch("/modules/:moduleId", adminOnly, ctrl.patchModule);

// ── Actividades ────────────────────────────────────────────────
// POST  /admin/catalog/modules/:moduleId/activities → añadir / upsert actividad
router.post("/modules/:moduleId/activities", adminOnly, ctrl.createActivity);

// PATCH /admin/catalog/activities/:activityId → editar campos de una actividad
router.patch("/activities/:activityId", adminOnly, ctrl.patchActivity);

module.exports = router;
