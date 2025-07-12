// server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const app = express();

// ⚙️ Configuración CORS segura
const corsOptions = {
  origin: [
    "http://localhost:3000",
    "https://soyvoluntario.cruzrojamexicana.org.mx"
  ],
  methods: "GET,POST,PUT,DELETE,OPTIONS",
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-firebase-uid",
    "x-api-key"
  ],
  credentials: true
};

app.use(cors(corsOptions));
app.use(express.json());

// 🔐 API Key opcional (si deseas bloquear algunas rutas internas)
const API_KEY = process.env.API_KEY || "supersecreto";
const authApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Acceso no autorizado" });
  }
  next();
};

// 🧠 Base de datos (no necesitas conectarte manualmente con pool)
const db = require("./config/db");

// 📦 Rutas
const usersRoutes = require("./routes/users.routes");
const certificadosRoutes = require("./routes/certificados.routes");
const disponibilidadRoutes = require("./routes/disponibilidad.routes");
const publicRoutes = require("./routes/public.routes");

app.use("/users", usersRoutes);
app.use("/certificados", certificadosRoutes);
app.use("/disponibilidad", disponibilidadRoutes);
app.use("/public", publicRoutes);

// Ruta raíz
app.get("/", (req, res) => {
  res.send("✨ API de SoyVoluntario corriendo correctamente ✨");
});

// 🚀 Levantar servidor
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
