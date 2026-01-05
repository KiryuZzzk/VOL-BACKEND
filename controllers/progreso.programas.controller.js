const db = require("../config/db");

const getUid = (req) =>
  req.firebaseUser?.uid || req.user?.uid || req.user?.user_id || null;

exports.getMisProgramas = async (req, res) => {
  const uid = String(getUid(req) || "").trim();
  if (!uid) return res.status(401).json({ error: "No autenticado" });

  try {
    const [rows] = await db.query(
      `
      SELECT p.program_id, p.code, p.name
      FROM user_program_enrollment upe
      JOIN program p ON p.program_id = upe.program_id
      WHERE upe.user_id = ? AND upe.status = 'enrolled'
      ORDER BY p.program_id ASC
      `,
      [uid]
    );

    return res.json({ programs: rows });
  } catch (err) {
    console.error("❌ getMisProgramas:", err);
    return res.status(500).json({ error: "Error al obtener programas" });
  }
};
