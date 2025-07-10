const express = require("express");
const router = express.Router();
const publicController = require("../controllers/public.controller");

router.post("/register", publicController.registerUser);

module.exports = router;
