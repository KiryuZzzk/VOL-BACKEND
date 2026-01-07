const db = require("../config/db");

/**
 * Devuelve ambos posibles identificadores del usuario:
 * - firebaseUid: string (Firebase Auth)
 * - dbUserId: number (users.id en MySQL)
 *
 * Tu middleware actual (middlewares/auth.js) ya suele poner:
 * - req.firebaseUser.uid
 * - req.user.id  (si encontró usuario en DB)
 */
function getUserKeys(req) {
  const firebaseUid = String(req.firebaseUser?.uid || "").trim();

  // DB user id (numérico)
  const dbUserIdRaw =
    req.user?.id ?? req.dbUser?.id ?? req.user?.user_id ?? null;

  // Normaliza a number si aplica
  const dbUserId =
    dbUserIdRaw === null || dbUserIdRaw === undefined || dbUserIdRaw === ""
      ? null
      : Number(dbUserIdRaw);

  return {
    firebaseUid: firebaseUid || null,
    dbUserId: Number.isFinite(dbUserId) ? dbUserId : null,
  };
}

exports.getMisProgramas = async (req, res) => {
  const { firebaseUid, dbUserId } = getUserKeys(req);

  if (!firebaseUid && !dbUserId) {
    return res.status(401).json({ error: "No autenticado" });
  }

  try {
    // Soporta:
    // - user_program_enrollment.user_id = users.id (num)
    // - user_program_enrollment.user_id = firebase uid (string)
    const where = [];
    const params = [];

    if (dbUserId) {
      where.push("upe.user_id = ?");
      params.push(dbUserId);
    }
    if (firebaseUid) {
      where.push("upe.user_id = ?");
      params.push(firebaseUid);
    }

    const [rows] = await db.query(
      `
      SELECT
        p.program_id,
        p.code,
        p.name,
        p.description,
        p.image,
        p.formacion,
        p.level,
        p.estimated_minutes,
        p.tags_json
      FROM user_program_enrollment upe
      JOIN program p ON p.program_id = upe.program_id
      WHERE (${where.join(" OR ")})
        AND upe.status = 'enrolled'
      ORDER BY p.program_id ASC
      `,
      params
    );

    return res.json({ programs: rows });
  } catch (err) {
    console.error("❌ getMisProgramas:", err);
    return res.status(500).json({ error: "Error al obtener programas" });
  }
};
