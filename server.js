require("dotenv").config();
const express = require("express");
const mysql = require("mysql2");
const cors = require("cors");

const app = express();
const PORT = process.env.PORT || 5000;

// 💂‍♂️ Middleware CORS con configuración detallada
const corsOptions = {
  origin: [
    "http://localhost:3000", // 👩‍💻 Localhost para desarrollo
    "https://soyvoluntario.cruzrojamexicana.org.mx"  // 🌐 Tu dominio de producción (ajústalo cuando lo tengas)
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

// 🔐 Seguridad con API Key (opcional si usas Firebase Auth después)
const API_KEY = process.env.API_KEY || "supersecreto";
const authApiKey = (req, res, next) => {
  const apiKey = req.headers["x-api-key"];
  if (apiKey !== API_KEY) {
    return res.status(403).json({ error: "Acceso no autorizado" });
  }
  next();
};

// 🛢️ Conexión a base de datos MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
    // Opciones para evitar que la conexión muera
  connectTimeout: 10000,          // 10 segundos timeout
  multipleStatements: true,       // por si usas varios statements
  // keepAlive ayuda a mantener la conexión viva
  // pero mysql2 no tiene opción directa para keepAlive, así que manejamos reconexión abajo
});

db.connect((err) => {
  if (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
    process.exit(1);
  }
  console.log("✅ Conectado a MySQL");
});

// 🛣️ Rutas principales
const usersRoutes = require("./routes/users.routes");
const certificadosRoutes = require("./routes/certificados.routes");
const disponibilidadRoutes = require("./routes/disponibilidad.routes");
const publicRoutes = require("./routes/public.routes");

app.use("/users", usersRoutes);
app.use("/certificados", certificadosRoutes);
app.use("/disponibilidad", disponibilidadRoutes);
app.use("/public", publicRoutes);

// 🧪 Ruta base (test)
app.get("/", (req, res) => {
  res.send("✨ API de SoyVoluntario corriendo correctamente ✨");
});

// 🚀 Iniciar servidor
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});
