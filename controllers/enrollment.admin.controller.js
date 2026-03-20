// controllers/enrollment.admin.controller.js
// Gestión de inscripciones a programas — solo ADMIN

const db = require("../config/db");

const VALID_STATUSES = ["enrolled", "completed", "dropped", "pending", "suspended"];

// ─── GET /admin/enrollment/programs ─────────────────────────
// Lista programas disponibles (para el select del frontend)
exports.listPrograms = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT program_id, code, name, is_active FROM program ORDER BY program_id ASC"
    );
    return res.json({ programs: rows });
  } catch (err) {
    console.error("❌ enrollment.listPrograms:", err);
    return res.status(500).json({ error: "Error al listar programas" });
  }
};

// ─── GET /admin/enrollment ───────────────────────────────────
// Lista inscripciones. Filtros opcionales:
//   ?program_id=X  ?status=enrolled  ?search=texto (CURP/correo/matrícula/nombre)
exports.listEnrollments = async (req, res) => {
  try {
    const { program_id, status, search } = req.query;

    let sql = `
      SELECT
        upe.user_id,
        upe.program_id,
        upe.status,
        u.id        AS db_user_id,
        u.nombre,
        u.apellido_pat,
        u.apellido_mat,
        u.correo,
        u.matricula,
        u.curp,
        p.code      AS program_code,
        p.name      AS program_name
      FROM user_program_enrollment upe
      JOIN users u   ON u.uid COLLATE utf8mb4_unicode_ci = upe.user_id COLLATE utf8mb4_unicode_ci
      JOIN program p ON p.program_id = upe.program_id
      WHERE 1=1
    `;
    const params = [];

    if (program_id) {
      sql += " AND upe.program_id = ?";
      params.push(Number(program_id));
    }
    if (status) {
      sql += " AND upe.status = ?";
      params.push(status);
    }
    if (search && search.trim()) {
      const t = `%${search.trim()}%`;
      sql += " AND (u.curp LIKE ? OR u.correo LIKE ? OR u.matricula LIKE ? OR u.nombre LIKE ? OR u.apellido_pat LIKE ?)";
      params.push(t, t, t, t, t);
    }

    sql += " ORDER BY p.program_id ASC, u.apellido_pat ASC";

    const [rows] = await db.query(sql, params);
    return res.json({ enrollments: rows });
  } catch (err) {
    console.error("❌ enrollment.listEnrollments:", err);
    return res.status(500).json({ error: "Error al listar inscripciones" });
  }
};

// ─── POST /admin/enrollment ──────────────────────────────────
// Inscribe usuario(s) en un programa.
// Body: { program_id, user_id? (Firebase UID), curp?, curps? }
// Prioridad: user_id > curps > curp
exports.enrollUser = async (req, res) => {
  try {
    const { program_id, user_id, curp, curps } = req.body;

    if (!program_id) return res.status(400).json({ error: "program_id es requerido" });

    const [pRows] = await db.query(
      "SELECT program_id, name FROM program WHERE program_id = ? LIMIT 1",
      [Number(program_id)]
    );
    if (!pRows.length) return res.status(404).json({ error: "Programa no encontrado" });

    let uids = [];

    if (user_id) {
      uids = [String(user_id).trim()];
    } else {
      const curpList = curps
        ? (Array.isArray(curps) ? curps : String(curps).split(","))
        : curp
          ? [curp]
          : [];

      const normalized = curpList.map((c) => String(c).trim().toUpperCase()).filter(Boolean);
      if (!normalized.length) return res.status(400).json({ error: "Se requiere user_id o curp/curps" });

      const placeholders = normalized.map(() => "?").join(",");
      const [uRows] = await db.query(
        `SELECT uid, curp FROM users WHERE UPPER(curp) IN (${placeholders})`,
        normalized
      );
      uids = uRows.map((r) => r.uid);
      if (!uids.length) return res.status(404).json({ error: "No se encontraron usuarios con esas CURPs" });
    }

    const results = [];
    for (const uid of uids) {
      await db.query(
        `INSERT INTO user_program_enrollment (user_id, program_id, status)
         VALUES (?, ?, 'enrolled')
         ON DUPLICATE KEY UPDATE
           status = CASE
             WHEN user_program_enrollment.status = 'completed' THEN user_program_enrollment.status
             ELSE 'enrolled'
           END`,
        [uid, Number(program_id)]
      );
      results.push({ user_id: uid, program_id: Number(program_id), status: "enrolled" });
    }

    return res.status(201).json({ enrolled: results.length, results });
  } catch (err) {
    console.error("❌ enrollment.enrollUser:", err);
    return res.status(500).json({ error: "Error al inscribir usuario" });
  }
};

// ─── PATCH /admin/enrollment/:userId/:programId ──────────────
// Cambia el status de una inscripción.
// Body: { status: "enrolled" | "completed" | "dropped" | "pending" | "suspended" }
exports.updateStatus = async (req, res) => {
  try {
    const { userId, programId } = req.params;
    const { status } = req.body;

    if (!VALID_STATUSES.includes(status)) {
      return res.status(400).json({
        error: `Estado inválido. Válidos: ${VALID_STATUSES.join(", ")}`,
      });
    }

    const [result] = await db.query(
      "UPDATE user_program_enrollment SET status = ? WHERE user_id = ? AND program_id = ?",
      [status, String(userId).trim(), Number(programId)]
    );

    if (!result.affectedRows) {
      return res.status(404).json({ error: "Inscripción no encontrada" });
    }

    return res.json({
      action: "updated",
      user_id: userId,
      program_id: Number(programId),
      status,
    });
  } catch (err) {
    console.error("❌ enrollment.updateStatus:", err);
    return res.status(500).json({ error: "Error al actualizar estado" });
  }
};
