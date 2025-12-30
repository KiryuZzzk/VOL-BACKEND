/**
 * scripts/testDb.js
 *
 * Prueba de conexión a MySQL usando config/db.js
 * Sirve para validar que:
 *  - .env está cargando bien
 *  - Railway / MySQL acepta la conexión
 *  - SSL / proxy están correctos
 *
 * Ejecutar con:
 *   node scripts/testDb.js
 */

const db = require("../config/db");

(async () => {
  let conn;
  try {
    console.log("🔌 Intentando conectar a la base de datos...");

    conn = await db.getConnection();

    const [rows] = await conn.query("SELECT 1 AS ok");

    console.log("✅ Conexión exitosa:");
    console.log(rows); // debería imprimir: [ { ok: 1 } ]
  } catch (err) {
    console.error("❌ Error al conectar a la base de datos:");
    console.error(err);
  } finally {
    if (conn) conn.release();
    await db.end();
    console.log("🔒 Conexión cerrada.");
  }
})();
