require("dotenv").config();
const mysql = require("mysql2/promise");

function parseMysqlUrl(databaseUrl) {
  const u = new URL(databaseUrl);

  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.replace("/", ""),
  };
}

let cfg;

if (process.env.DATABASE_URL) {
  cfg = parseMysqlUrl(process.env.DATABASE_URL);
} else {
  cfg = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT ? Number(process.env.DB_PORT) : 3306,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
  };
}

const pool = mysql.createPool({
  ...cfg,
  ssl: { rejectUnauthorized: false },
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Log de vida (déjalo mientras arreglas; luego lo quitas)
console.log("[DB] connecting to:", {
  host: cfg.host,
  port: cfg.port,
  user: cfg.user,
  database: cfg.database,
});

module.exports = pool;
