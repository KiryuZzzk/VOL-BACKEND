const express = require("express");
const router = express.Router();

const catalogCtrl = require("../controllers/lms.catalog.controller");
const progressCtrl = require("../controllers/lms.progress.controller");
const { authMiddleware } = require("../middlewares/auth");

// CATÁLOGO
router.get("/catalog/programs/:code/tree", authMiddleware, catalogCtrl.getProgramTree);

// PROGRESO (ME)
router.get("/progress/me/programs/:code", authMiddleware, progressCtrl.getMyProgramProgress);

router.post("/progress/activities/:activityId/start", authMiddleware, progressCtrl.startActivity);
router.post("/progress/activities/:activityId/complete", authMiddleware, progressCtrl.completeActivity);
router.post("/progress/activities/:activityId/heartbeat", authMiddleware, progressCtrl.heartbeatActivity);

module.exports = router;
