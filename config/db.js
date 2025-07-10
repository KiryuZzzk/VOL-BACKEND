require('dotenv').config(); // <- esta línea carga las variables .env

const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT
});

db.connect((err) => {
  if (err) {
    console.error("❌ Error conectando a MySQL:", err.message);
    process.exit(1);
  } else {
    console.log("✅ Conectado a MySQL");
  }
});

module.exports = db;
