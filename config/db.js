require("dotenv").config();
const mysql = require("mysql2");

// 🌀 Pool de conexiones
const pool = mysql.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});

// 🧠 Log de estado del pool
pool.getConnection((err, connection) => {
  if (err) {
    switch (err.code) {
      case "PROTOCOL_CONNECTION_LOST":
        console.error("🔌 Conexión con la base de datos fue cerrada.");
        break;
      case "ER_CON_COUNT_ERROR":
        console.error("⚠️ Demasiadas conexiones a la base de datos.");
        break;
      case "ECONNREFUSED":
        console.error("⛔ Conexión a la base de datos rechazada.");
        break;
      default:
        console.error("❌ Error desconocido en conexión DB:", err.message);
    }
  } else {
    console.log("✅ Conexión a MySQL pool establecida.");
    if (connection) connection.release();
  }
});

// 🧪 Exportar el pool como promesa
module.exports = pool.promise();
