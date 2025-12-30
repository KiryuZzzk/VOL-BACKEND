const db = require("../config/db");

/**
 * GET /progreso/catalogo/programas/:code/arbol
 * Devuelve la estructura completa del programa:
 * programa -> bloques -> módulos -> actividades
 */
exports.getProgramaArbol = async (req, res) => {
  const programCode = String(req.params.code || "").trim().toUpperCase();

  if (!programCode) {
    return res.status(400).json({ error: "Código de programa inválido" });
  }

  try {
    // 1️⃣ Programa
    const [programRows] = await db.query(
      "SELECT program_id, code, name FROM program WHERE code = ? LIMIT 1",
      [programCode]
    );

    if (!programRows.length) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const program = programRows[0];

    // 2️⃣ Bloques
    const [blockRows] = await db.query(
      `
      SELECT block_id, program_id, code, name, order_index
      FROM block
      WHERE program_id = ?
      ORDER BY order_index ASC, block_id ASC
      `,
      [program.program_id]
    );

    // 3️⃣ Módulos
    const blockIds = blockRows.map(b => b.block_id);

    const [moduleRows] = blockIds.length
      ? await db.query(
          `
          SELECT module_id, block_id, code, name, order_index
          FROM module
          WHERE block_id IN (${blockIds.map(() => "?").join(",")})
          ORDER BY order_index ASC, module_id ASC
          `,
          blockIds
        )
      : [[]];

    // 4️⃣ Actividades
    const moduleIds = moduleRows.map(m => m.module_id);

    const [activityRows] = moduleIds.length
      ? await db.query(
          `
          SELECT
            activity_id,
            module_id,
            code,
            name,
            order_index,
            type,
            required,
            min_score,
            is_final_exam
          FROM activity
          WHERE module_id IN (${moduleIds.map(() => "?").join(",")})
          ORDER BY order_index ASC, activity_id ASC
          `,
          moduleIds
        )
      : [[]];

    // 5️⃣ Armar árbol
    const modulesByBlock = new Map();
    moduleRows.forEach(m => {
      if (!modulesByBlock.has(m.block_id)) {
        modulesByBlock.set(m.block_id, []);
      }
      modulesByBlock.get(m.block_id).push({
        ...m,
        activities: [],
      });
    });

    const moduleById = new Map();
    modulesByBlock.forEach(mods => {
      mods.forEach(m => moduleById.set(m.module_id, m));
    });

    activityRows.forEach(a => {
      const mod = moduleById.get(a.module_id);
      if (mod) mod.activities.push(a);
    });

    const blocks = blockRows.map(b => ({
      ...b,
      modules: modulesByBlock.get(b.block_id) || [],
    }));

    return res.json({
      program,
      blocks,
    });
  } catch (err) {
    console.error("❌ getProgramaArbol error:", err);
    return res.status(500).json({ error: "Error al obtener el catálogo" });
  }
};
