const db = require("../config/db");

/**
 * Helper: parsea JSON seguro (soporta null, "", objetos ya parseados)
 */
function isModuleDateLocked(m) {
  const now = new Date();
  const start = m.start_date ? new Date(m.start_date) : null;
  const end   = m.end_date   ? new Date(m.end_date)   : null;
  if (!start && !end) return false;
  if (start && !end)  return now < start;
  if (!start && end)  return now > end;
  return now < start || now > end;
}

function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value; // ya viene parseado
  const s = String(value).trim();
  if (!s) return fallback;
  try {
    return JSON.parse(s);
  } catch (e) {
    // Si algo viene medio corrupto, no tiramos el endpoint
    return fallback;
  }
}

/**
 * GET /progreso/catalogo/programas/:code/arbol
 * Devuelve la estructura completa del programa:
 * programa -> bloques -> módulos -> actividades
 *
 * ✅ Backend source of truth:
 * - expone "order" (derivado de order_index)
 * - expone metadata completa
 * - parsea JSONs a objetos (config, tags, prerequisites)
 */
exports.getProgramaArbol = async (req, res) => {
  const programCode = String(req.params.code || "").trim().toUpperCase();

  if (!programCode) {
    return res.status(400).json({ error: "Código de programa inválido" });
  }

  try {
    // 1️⃣ Programa (FULL)
    const [programRows] = await db.query(
      `
      SELECT
        program_id,
        code,
        name,
        description,
        image,
        formacion,
        level,
        estimated_minutes,
        tags_json,
        is_active
      FROM program
      WHERE code = ?
      LIMIT 1
      `,
      [programCode]
    );

    if (!programRows.length) {
      return res.status(404).json({ error: "Programa no encontrado" });
    }

    const programRaw = programRows[0];
    const program = {
      ...programRaw,
      id: programRaw.program_id,
      title: programRaw.name,
      tags: safeJsonParse(programRaw.tags_json, []),
    };

    // 2️⃣ Bloques (FULL)
    const [blockRows] = await db.query(
      `
      SELECT
        block_id,
        program_id,
        code,
        name,
        description,
        estimated_minutes,
        optional,
        order_index,
        is_active
      FROM block
      WHERE program_id = ?
        AND is_active = 1
      ORDER BY order_index ASC, block_id ASC
      `,
      [program.program_id]
    );

    const blocksRaw = blockRows.map((b) => ({
      ...b,
      id: b.block_id,
      title: b.name,
      order: b.order_index, // ✅ alias esperado por el front
      modules: [],
    }));

    // 3️⃣ Módulos (FULL)
    const blockIds = blocksRaw.map((b) => b.block_id);

    const [moduleRows] = blockIds.length
      ? await db.query(
          `
          SELECT
            module_id,
            block_id,
            code,
            name,
            description,
            estimated_minutes,
            prerequisites_json,
            is_final_exam,
            order_index,
            is_active,
            start_date,
            end_date
          FROM module
          WHERE block_id IN (${blockIds.map(() => "?").join(",")})
            AND is_active = 1
          ORDER BY order_index ASC, module_id ASC
          `,
          blockIds
        )
      : [[]];

    const modulesRaw = moduleRows.map((m) => ({
      ...m,
      id: m.module_id,
      title: m.name,
      order: m.order_index,
      prerequisites: safeJsonParse(m.prerequisites_json, []),
      isDateLocked: isModuleDateLocked(m),
      activities: [],
    }));

    // 4️⃣ Actividades (FULL + config_json)
    const moduleIds = modulesRaw.map((m) => m.module_id);

    const [activityRows] = moduleIds.length
      ? await db.query(
          `
          SELECT
            activity_id,
            module_id,
            code,
            name,
            description,
            estimated_minutes,
            xp,
            config_json,
            order_index,
            type,
            required,
            min_score,
            is_final_exam,
            is_active
          FROM activity
          WHERE module_id IN (${moduleIds.map(() => "?").join(",")})
            AND is_active = 1
          ORDER BY order_index ASC, activity_id ASC
          `,
          moduleIds
        )
      : [[]];

    const activitiesRaw = activityRows.map((a) => ({
      ...a,
      id: a.activity_id,
      title: a.name,
      order: a.order_index, // ✅ alias
      // ✅ lo que tu front necesita:
      config: safeJsonParse(a.config_json, {}),
    }));

    // 5️⃣ Armar árbol
    const blocksById = new Map();
    blocksRaw.forEach((b) => blocksById.set(b.block_id, b));

    const modulesById = new Map();
    modulesRaw.forEach((m) => modulesById.set(m.module_id, m));

    // Meter módulos dentro de bloques
    modulesRaw.forEach((m) => {
      const blk = blocksById.get(m.block_id);
      if (blk) blk.modules.push(m);
    });

    // Meter actividades dentro de módulos
    activitiesRaw.forEach((a) => {
      const mod = modulesById.get(a.module_id);
      if (mod) mod.activities.push(a);
    });

    return res.json({
      program,
      blocks: blocksRaw,
    });
  } catch (err) {
    console.error("❌ getProgramaArbol error:", err);
    return res.status(500).json({ error: "Error al obtener el catálogo" });
  }
};
