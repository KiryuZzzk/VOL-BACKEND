require('dotenv').config();
const mysql = require("mysql2");

let db;

function handleDisconnect() {
  db = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
  });

  db.connect((err) => {
    if (err) {
      console.error("❌ Error al conectar a MySQL:", err.message);
      // Reintenta conexión en 2 segundos
      setTimeout(handleDisconnect, 2000);
    } else {
      console.log("✅ Conectado a MySQL");
    }
  });

  db.on("error", (err) => {
    console.error("⚠️ Error en conexión MySQL:", err.code || err.message);
    if (err.code === "PROTOCOL_CONNECTION_LOST" || err.code === "ECONNRESET") {
      console.log("🔁 Conexión perdida. Intentando reconectar...");
      handleDisconnect();
    } else {
      throw err;
    }
  });
}

handleDisconnect();

module.exports = () => db;
