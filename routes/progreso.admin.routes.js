// routes/progreso.admin.routes.js
const express = require("express");
const router = express.Router();

const { authMiddleware, roleMiddleware } = require("../middlewares/auth");
const adminCtrl = require("../controllers/progreso.admin.controller");

// 👮 Solo admin/moderador
const ADMIN_ROLES = ["admin", "moderador"];

router.get(
  "/admin/users/:userUid/programas",
  authMiddleware,
  roleMiddleware(ADMIN_ROLES),
  adminCtrl.getUserProgramEnrollments
);

router.get(
  "/admin/users/:userUid/programas/:code",
  authMiddleware,
  roleMiddleware(ADMIN_ROLES),
  adminCtrl.getUserProgressByProgram
);

router.get(
  "/admin/users/:userUid/docs",
  authMiddleware,
  roleMiddleware(ADMIN_ROLES),
  adminCtrl.getUserDocs
);

router.patch(
  "/admin/users/:userUid/docs/:docId/review",
  authMiddleware,
  roleMiddleware(ADMIN_ROLES),
  adminCtrl.reviewUserDoc
);

module.exports = router;
