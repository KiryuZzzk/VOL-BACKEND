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
    // 1) Programa
    const [programRows] = await db.query(
      "SELECT program_id, code, name, description FROM program WHERE code = ? LIMIT 1",
      [programCode]
    );

    if (!programRows.length) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const program = programRows[0];

    // 2) Bloques (alias order_index -> order)
    const [blockRows] = await db.query(
      `
      SELECT 
        block_id,
        program_id,
        code,
        name,
        description,
        order_index,
        order_index AS \`order\`
      FROM block
      WHERE program_id = ?
      ORDER BY order_index ASC, block_id ASC
      `,
      [program.program_id]
    );

    const blockIds = blockRows.map((b) => b.block_id);

    // 3) Módulos (alias order_index -> order)
    const [moduleRows] = blockIds.length
      ? await db.query(
          `
          SELECT
            module_id,
            block_id,
            code,
            name,
            description,
            order_index,
            order_index AS \`order\`
          FROM module
          WHERE block_id IN (${blockIds.map(() => "?").join(",")})
          ORDER BY order_index ASC, module_id ASC
          `,
          blockIds
        )
      : [[]];

    const moduleIds = moduleRows.map((m) => m.module_id);

    // 4) Actividades (alias order_index -> order)
    const [activityRows] = moduleIds.length
      ? await db.query(
          `
          SELECT
            activity_id,
            module_id,
            code,
            name,
            description,
            order_index,
            order_index AS \`order\`,
            type,
            required,
            min_score,
            is_final_exam,
            xp
          FROM activity
          WHERE module_id IN (${moduleIds.map(() => "?").join(",")})
          ORDER BY order_index ASC, activity_id ASC
          `,
          moduleIds
        )
      : [[]];

    // 5) Armar árbol (sin ".m" / ".b")
    const modulesByBlock = new Map();
    for (const m of moduleRows) {
      if (!modulesByBlock.has(m.block_id)) modulesByBlock.set(m.block_id, []);

      modulesByBlock.get(m.block_id).push({
        id: m.module_id,
        module_id: m.module_id,
        block_id: m.block_id,
        code: m.code,
        name: m.name,
        title: m.name, // por si tu front usa title
        description: m.description || "",
        order_index: m.order_index,
        order: m.order, // ✅ el que quieres
        activities: [],
      });
    }

    const moduleById = new Map();
    for (const mods of modulesByBlock.values()) {
      for (const m of mods) moduleById.set(m.module_id, m);
    }

    for (const a of activityRows) {
      const mod = moduleById.get(a.module_id);
      if (!mod) continue;

      mod.activities.push({
        id: a.activity_id,
        activity_id: a.activity_id,
        module_id: a.module_id,
        code: a.code,
        name: a.name,
        title: a.name,
        description: a.description || "",
        order_index: a.order_index,
        order: a.order, // ✅ el que quieres
        type: a.type,
        required: !!a.required,
        min_score: a.min_score ?? null,
        is_final_exam: !!a.is_final_exam,
        xp: a.xp ?? 0,
      });
    }

    const blocks = blockRows.map((b) => ({
      id: b.block_id,
      block_id: b.block_id,
      program_id: b.program_id,
      code: b.code,
      name: b.name,
      title: b.name,
      description: b.description || "",
      order_index: b.order_index,
      order: b.order, // ✅ el que quieres
      modules: modulesByBlock.get(b.block_id) || [],
    }));

    return res.json({
      program: {
        id: program.program_id,
        program_id: program.program_id,
        code: program.code,
        name: program.name,
        title: program.name,
        description: program.description || "",
      },
      blocks,
    });
  } catch (err) {
    console.error("❌ getProgramaArbol error:", err);
    return res.status(500).json({ error: "Error al obtener el catálogo" });
  }
};
