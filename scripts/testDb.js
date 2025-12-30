const db = require("../config/db");

(async () => {
  const conn = await db.getConnection();
  const [rows] = await conn.query("SELECT 1 as ok");
  console.log(rows);
  conn.release();
  await db.end();
})();
