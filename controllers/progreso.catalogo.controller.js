const db = require("../config/db");

/**
 * GET /progreso/catalogo/programas/:code/arbol
 * Programa -> Bloques -> Módulos -> Actividades (con metadata + config)
 */
exports.getProgramaArbol = async (req, res) => {
  const programCode = String(req.params.code || "").trim().toUpperCase();
  if (!programCode) return res.status(400).json({ error: "Código de programa inválido" });

  try {
    // 1) Programa
    const [programRows] = await db.query(
      `
      SELECT
        program_id, code, name,
        description, image, formacion, level, estimated_minutes, tags_json
      FROM program
      WHERE code = ?
      LIMIT 1
      `,
      [programCode]
    );

    if (!programRows.length) return res.status(404).json({ error: "Programa no encontrado" });

    const p = programRows[0];

    const program = {
      id: p.program_id,
      program_id: p.program_id,
      code: p.code,
      name: p.name,
      title: p.name,
      description: p.description || "",
      image: p.image || null,
      formacion: p.formacion || null,
      level: p.level || null,
      estimatedMinutes: p.estimated_minutes ?? null,
      tags: p.tags_json ? JSON.parse(p.tags_json) : [],
    };

    // 2) Bloques
    const [blockRowsRaw] = await db.query(
      `
      SELECT
        block_id, program_id, code, name, description,
        order_index, estimated_minutes, optional
      FROM block
      WHERE program_id = ? AND is_active = 1
      ORDER BY order_index ASC, block_id ASC
      `,
      [p.program_id]
    );

    const blocksBase = blockRowsRaw.map((b) => ({
      id: b.block_id,
      block_id: b.block_id,
      program_id: b.program_id,
      code: b.code,
      name: b.name,
      title: b.name,
      description: b.description || "",
      order_index: b.order_index,
      order: b.order_index,
      estimatedMinutes: b.estimated_minutes ?? null,
      optional: !!b.optional,
      modules: [],
    }));

    const blockIds = blocksBase.map((b) => b.block_id);
    if (!blockIds.length) return res.json({ program, blocks: [] });

    // 3) Módulos
    const [moduleRowsRaw] = await db.query(
      `
      SELECT
        module_id, block_id, code, name, description,
        order_index, estimated_minutes, prerequisites_json, is_final_exam
      FROM module
      WHERE block_id IN (${blockIds.map(() => "?").join(",")}) AND is_active = 1
      ORDER BY order_index ASC, module_id ASC
      `,
      blockIds
    );

    const modules = moduleRowsRaw.map((m) => ({
      id: m.module_id,
      module_id: m.module_id,
      block_id: m.block_id,
      code: m.code,
      name: m.name,
      title: m.name,
      description: m.description || "",
      order_index: m.order_index,
      order: m.order_index,
      estimatedMinutes: m.estimated_minutes ?? null,
      prerequisites: m.prerequisites_json ? JSON.parse(m.prerequisites_json) : [],
      isFinalExam: !!m.is_final_exam,
      activities: [],
    }));

    const moduleIds = modules.map((m) => m.module_id);
    const modulesById = new Map(modules.map((m) => [m.module_id, m]));
    const modulesByBlock = new Map();
    for (const m of modules) {
      if (!modulesByBlock.has(m.block_id)) modulesByBlock.set(m.block_id, []);
      modulesByBlock.get(m.block_id).push(m);
    }

    // 4) Actividades
    if (moduleIds.length) {
      const [activityRowsRaw] = await db.query(
        `
        SELECT
          activity_id, module_id, code, name, description,
          order_index, type, required, min_score,
          estimated_minutes, xp, config_json, is_final_exam
        FROM activity
        WHERE module_id IN (${moduleIds.map(() => "?").join(",")}) AND is_active = 1
        ORDER BY order_index ASC, activity_id ASC
        `,
        moduleIds
      );

      for (const a of activityRowsRaw) {
        const parent = modulesById.get(a.module_id);
        if (!parent) continue;

        parent.activities.push({
          id: a.activity_id,
          activity_id: a.activity_id,
          module_id: a.module_id,
          code: a.code,
          name: a.name,
          title: a.name,
          description: a.description || "",
          order_index: a.order_index,
          order: a.order_index,
          type: a.type,
          required: !!a.required,
          min_score: a.min_score ?? null,
          estimatedMinutes: a.estimated_minutes ?? null,
          xp: a.xp ?? null,
          isFinalExam: !!a.is_final_exam,
          config: a.config_json ? JSON.parse(a.config_json) : {}, // 🔥 aquí vive youtubeIds/questions/manualId/url
        });
      }
    }

    // 5) Enlazar bloques -> módulos
    for (const b of blocksBase) {
      b.modules = modulesByBlock.get(b.block_id) || [];
    }

    return res.json({ program, blocks: blocksBase });
  } catch (err) {
    console.error("❌ getProgramaArbol error:", err);
    return res.status(500).json({ error: "Error al obtener el catálogo" });
  }
};
