require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// Middlewares
app.use(cors());
app.use(express.json());

// Seguridad con API Key (opcional si usas Firebase Auth después)
const API_KEY = process.env.API_KEY || "supersecreto";
const authApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Acceso no autorizado" });
  }
  next();
};

// Base de datos MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

db.connect((err) => {
  if (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
    process.exit(1);
  }
  console.log("✅ Conectado a MySQL");
});

// Rutas principales

const usersRoutes = require("./routes/users.routes");
const certificadosRoutes = require("./routes/certificados.routes");
const disponibilidadRoutes = require("./routes/disponibilidad.routes");
const publicRoutes = require("./routes/public.routes");


app.use("/users", usersRoutes);
app.use("/certificados", certificadosRoutes);
app.use("/disponibilidad", disponibilidadRoutes);
app.use("/public", publicRoutes)

// Ruta base (test)
app.get("/", (req, res) => {
  res.send("✨ API de SoyVoluntario corriendo correctamente ✨");
});

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
