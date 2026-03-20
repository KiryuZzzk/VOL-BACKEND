// controllers/catalog.admin.controller.js
// CRUD de catálogo (programas / bloques / módulos / actividades)
// Solo accesible para rol "admin".

const db = require("../config/db");

// ─────────────────────────────────────────────────────────────
// Helpers internos (mismo criterio que syncCatalog.js)
// ─────────────────────────────────────────────────────────────
function safeStr(v) {
  if (v === null || v === undefined) return "";
  return String(v);
}
function toUpperCode(v) {
  return safeStr(v).trim().toUpperCase();
}
function toTinyBool(v, def = 1) {
  if (v === true || v === 1 || v === "1" || v === "true") return 1;
  if (v === false || v === 0 || v === "0" || v === "false") return 0;
  return def;
}
function toIntOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}
function toDecOrNull(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function jsonOrNull(v) {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) || (typeof v === "object")) return JSON.stringify(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
}
function safeJsonParse(value, fallback = null) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === "object") return value;
  const s = String(value).trim();
  if (!s) return fallback;
  try { return JSON.parse(s); } catch { return fallback; }
}

// ─────────────────────────────────────────────────────────────
// UPSERTS (misma lógica que syncCatalog.js, ahora en HTTP)
// ─────────────────────────────────────────────────────────────
async function upsertProgram(conn, p) {
  const [rows] = await conn.query(
    "SELECT program_id FROM program WHERE code = ? LIMIT 1",
    [p.code]
  );
  if (!rows.length) {
    const [ins] = await conn.query(
      `INSERT INTO program (code,name,is_active,description,image,formacion,level,estimated_minutes,tags_json)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [p.code, p.name, p.is_active, p.description, p.image, p.formacion, p.level, p.estimated_minutes, p.tags_json]
    );
    return { program_id: ins.insertId, action: "created" };
  }
  await conn.query(
    `UPDATE program SET name=?,is_active=?,description=?,image=?,formacion=?,level=?,estimated_minutes=?,tags_json=?
     WHERE program_id=?`,
    [p.name, p.is_active, p.description, p.image, p.formacion, p.level, p.estimated_minutes, p.tags_json, rows[0].program_id]
  );
  return { program_id: rows[0].program_id, action: "updated" };
}

async function upsertBlock(conn, b) {
  const [rows] = await conn.query(
    "SELECT block_id FROM block WHERE program_id=? AND code=? LIMIT 1",
    [b.program_id, b.code]
  );
  if (!rows.length) {
    const [ins] = await conn.query(
      `INSERT INTO block (program_id,code,name,order_index,is_active,description,estimated_minutes,optional)
       VALUES (?,?,?,?,?,?,?,?)`,
      [b.program_id, b.code, b.name, b.order_index, b.is_active, b.description, b.estimated_minutes, b.optional]
    );
    return { block_id: ins.insertId, action: "created" };
  }
  await conn.query(
    `UPDATE block SET name=?,order_index=?,is_active=?,description=?,estimated_minutes=?,optional=?
     WHERE block_id=?`,
    [b.name, b.order_index, b.is_active, b.description, b.estimated_minutes, b.optional, rows[0].block_id]
  );
  return { block_id: rows[0].block_id, action: "updated" };
}

async function upsertModule(conn, m) {
  const [rows] = await conn.query(
    "SELECT module_id FROM module WHERE block_id=? AND code=? LIMIT 1",
    [m.block_id, m.code]
  );
  if (!rows.length) {
    const [ins] = await conn.query(
      `INSERT INTO module (block_id,code,name,order_index,is_active,description,estimated_minutes,prerequisites_json,is_final_exam)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      [m.block_id, m.code, m.name, m.order_index, m.is_active, m.description, m.estimated_minutes, m.prerequisites_json, m.is_final_exam]
    );
    return { module_id: ins.insertId, action: "created" };
  }
  await conn.query(
    `UPDATE module SET name=?,order_index=?,is_active=?,description=?,estimated_minutes=?,prerequisites_json=?,is_final_exam=?
     WHERE module_id=?`,
    [m.name, m.order_index, m.is_active, m.description, m.estimated_minutes, m.prerequisites_json, m.is_final_exam, rows[0].module_id]
  );
  return { module_id: rows[0].module_id, action: "updated" };
}

async function upsertActivity(conn, a) {
  const [rows] = await conn.query(
    "SELECT activity_id FROM activity WHERE module_id=? AND code=? LIMIT 1",
    [a.module_id, a.code]
  );
  if (!rows.length) {
    const [ins] = await conn.query(
      `INSERT INTO activity (module_id,code,name,order_index,type,required,min_score,is_active,description,estimated_minutes,xp,config_json,is_final_exam)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [a.module_id, a.code, a.name, a.order_index, a.type, a.required, a.min_score, a.is_active, a.description, a.estimated_minutes, a.xp, a.config_json, a.is_final_exam]
    );
    return { activity_id: ins.insertId, action: "created" };
  }
  await conn.query(
    `UPDATE activity SET name=?,order_index=?,type=?,required=?,min_score=?,is_active=?,description=?,estimated_minutes=?,xp=?,config_json=?,is_final_exam=?
     WHERE activity_id=?`,
    [a.name, a.order_index, a.type, a.required, a.min_score, a.is_active, a.description, a.estimated_minutes, a.xp, a.config_json, a.is_final_exam, rows[0].activity_id]
  );
  return { activity_id: rows[0].activity_id, action: "updated" };
}

// ─────────────────────────────────────────────────────────────
// Helper: construye el árbol de un programa (sin filtro is_active,
// para que admin vea TODO, incluyendo inactivos)
// ─────────────────────────────────────────────────────────────
async function buildProgramTree(programCode) {
  const [programRows] = await db.query(
    `SELECT program_id,code,name,description,image,formacion,level,estimated_minutes,tags_json,is_active
     FROM program WHERE code=? LIMIT 1`,
    [programCode]
  );
  if (!programRows.length) return null;

  const p = programRows[0];
  const program = { ...p, id: p.program_id, title: p.name, tags: safeJsonParse(p.tags_json, []) };

  const [blockRows] = await db.query(
    `SELECT block_id,program_id,code,name,description,estimated_minutes,optional,order_index,is_active
     FROM block WHERE program_id=? ORDER BY order_index ASC, block_id ASC`,
    [p.program_id]
  );
  const blocksMap = new Map();
  const blocks = blockRows.map((b) => {
    const node = { ...b, id: b.block_id, title: b.name, order: b.order_index, modules: [] };
    blocksMap.set(b.block_id, node);
    return node;
  });

  if (blocks.length) {
    const bIds = blocks.map((b) => b.block_id);
    const [modRows] = await db.query(
      `SELECT module_id,block_id,code,name,description,estimated_minutes,prerequisites_json,is_final_exam,order_index,is_active
       FROM module WHERE block_id IN (${bIds.map(() => "?").join(",")}) ORDER BY order_index ASC, module_id ASC`,
      bIds
    );
    const modulesMap = new Map();
    const modules = modRows.map((m) => {
      const node = { ...m, id: m.module_id, title: m.name, order: m.order_index, prerequisites: safeJsonParse(m.prerequisites_json, []), activities: [] };
      modulesMap.set(m.module_id, node);
      return node;
    });

    if (modules.length) {
      const mIds = modules.map((m) => m.module_id);
      const [actRows] = await db.query(
        `SELECT activity_id,module_id,code,name,description,estimated_minutes,xp,config_json,order_index,type,required,min_score,is_final_exam,is_active
         FROM activity WHERE module_id IN (${mIds.map(() => "?").join(",")}) ORDER BY order_index ASC, activity_id ASC`,
        mIds
      );
      actRows.forEach((a) => {
        const mod = modulesMap.get(a.module_id);
        if (mod) mod.activities.push({ ...a, id: a.activity_id, title: a.name, order: a.order_index, config: safeJsonParse(a.config_json, {}) });
      });
    }

    modules.forEach((m) => {
      const blk = blocksMap.get(m.block_id);
      if (blk) blk.modules.push(m);
    });
  }

  return { program, blocks };
}

// ─────────────────────────────────────────────────────────────
// CONTROLADORES
// ─────────────────────────────────────────────────────────────

// GET /admin/catalog/programs
// Lista todos los programas (id, code, name, is_active)
exports.listPrograms = async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT program_id,code,name,is_active,formacion FROM program ORDER BY program_id ASC"
    );
    return res.json({ programs: rows });
  } catch (err) {
    console.error("❌ listPrograms:", err);
    return res.status(500).json({ error: "Error al listar programas" });
  }
};

// GET /admin/catalog/programs/:code/tree
// Árbol completo (admin ve inactivos también)
exports.getProgramTree = async (req, res) => {
  const code = toUpperCode(req.params.code);
  if (!code) return res.status(400).json({ error: "Código requerido" });
  try {
    const tree = await buildProgramTree(code);
    if (!tree) return res.status(404).json({ error: "Programa no encontrado" });
    return res.json(tree);
  } catch (err) {
    console.error("❌ getProgramTree:", err);
    return res.status(500).json({ error: "Error al obtener árbol" });
  }
};

// POST /admin/catalog/programs
// Crea o actualiza un programa completo (upsert por code)
// Body: { code, title, description, image, formacion, level, estimatedMinutes, isActive, tags }
exports.createProgram = async (req, res) => {
  const { code, title, name, description, image, formacion, level, estimatedMinutes, isActive, tags } = req.body;
  const pCode = toUpperCode(code);
  if (!pCode) return res.status(400).json({ error: "code es requerido" });

  try {
    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await upsertProgram(conn, {
        code: pCode,
        name: safeStr(title || name || pCode),
        is_active: toTinyBool(isActive, 1),
        description: safeStr(description || ""),
        image: image ? safeStr(image) : null,
        formacion: formacion ? safeStr(formacion) : null,
        level: level ? safeStr(level) : null,
        estimated_minutes: toIntOrNull(estimatedMinutes),
        tags_json: jsonOrNull(tags || []),
      });
      await conn.commit();
      const tree = await buildProgramTree(pCode);
      return res.status(result.action === "created" ? 201 : 200).json({ ...result, tree });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("❌ createProgram:", err);
    return res.status(500).json({ error: "Error al crear programa" });
  }
};

// PATCH /admin/catalog/programs/:code
// Edita campos individuales de un programa
exports.patchProgram = async (req, res) => {
  const code = toUpperCode(req.params.code);
  if (!code) return res.status(400).json({ error: "Código requerido" });

  const allowed = ["name", "title", "description", "image", "formacion", "level", "estimated_minutes", "estimatedMinutes", "is_active", "isActive", "tags", "tags_json"];
  const body = req.body;

  // Construye SET dinámico con solo los campos enviados
  const sets = [];
  const vals = [];

  if (body.name !== undefined || body.title !== undefined) { sets.push("name=?"); vals.push(safeStr(body.name || body.title)); }
  if (body.description !== undefined) { sets.push("description=?"); vals.push(safeStr(body.description)); }
  if (body.image !== undefined) { sets.push("image=?"); vals.push(body.image ? safeStr(body.image) : null); }
  if (body.formacion !== undefined) { sets.push("formacion=?"); vals.push(body.formacion ? safeStr(body.formacion) : null); }
  if (body.level !== undefined) { sets.push("level=?"); vals.push(body.level ? safeStr(body.level) : null); }
  if (body.estimatedMinutes !== undefined || body.estimated_minutes !== undefined) {
    sets.push("estimated_minutes=?");
    vals.push(toIntOrNull(body.estimatedMinutes ?? body.estimated_minutes));
  }
  if (body.isActive !== undefined || body.is_active !== undefined) {
    sets.push("is_active=?");
    vals.push(toTinyBool(body.isActive ?? body.is_active));
  }
  if (body.tags !== undefined || body.tags_json !== undefined) {
    sets.push("tags_json=?");
    vals.push(jsonOrNull(body.tags ?? body.tags_json));
  }

  if (!sets.length) return res.status(400).json({ error: "Sin campos para actualizar" });

  vals.push(code);
  try {
    const [result] = await db.query(`UPDATE program SET ${sets.join(",")} WHERE code=?`, vals);
    if (!result.affectedRows) return res.status(404).json({ error: "Programa no encontrado" });
    const tree = await buildProgramTree(code);
    return res.json({ action: "updated", tree });
  } catch (err) {
    console.error("❌ patchProgram:", err);
    return res.status(500).json({ error: "Error al actualizar programa" });
  }
};

// POST /admin/catalog/programs/:code/blocks
// Añade (o actualiza) un bloque en el programa
// Body: { code, title, description, order, isActive, optional, estimatedMinutes }
exports.createBlock = async (req, res) => {
  const programCode = toUpperCode(req.params.code);
  if (!programCode) return res.status(400).json({ error: "Código de programa requerido" });

  const { code, title, name, description, order, isActive, optional, estimatedMinutes } = req.body;
  const bCode = toUpperCode(code);
  if (!bCode) return res.status(400).json({ error: "code del bloque es requerido" });

  try {
    const [pRows] = await db.query("SELECT program_id FROM program WHERE code=? LIMIT 1", [programCode]);
    if (!pRows.length) return res.status(404).json({ error: "Programa no encontrado" });
    const program_id = pRows[0].program_id;

    // Calcular order_index si no se provee: último + 1
    let order_index = toIntOrNull(order);
    if (order_index === null) {
      const [maxRow] = await db.query("SELECT MAX(order_index) as mx FROM block WHERE program_id=?", [program_id]);
      order_index = (maxRow[0].mx || 0) + 1;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await upsertBlock(conn, {
        program_id,
        code: bCode,
        name: safeStr(title || name || bCode),
        order_index,
        is_active: toTinyBool(isActive, 1),
        description: safeStr(description || ""),
        estimated_minutes: toIntOrNull(estimatedMinutes),
        optional: toTinyBool(optional, 0),
      });
      await conn.commit();
      const tree = await buildProgramTree(programCode);
      return res.status(result.action === "created" ? 201 : 200).json({ ...result, tree });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("❌ createBlock:", err);
    return res.status(500).json({ error: "Error al crear bloque" });
  }
};

// PATCH /admin/catalog/blocks/:blockId
// Edita campos individuales de un bloque
exports.patchBlock = async (req, res) => {
  const blockId = toIntOrNull(req.params.blockId);
  if (!blockId) return res.status(400).json({ error: "blockId inválido" });

  const body = req.body;
  const sets = [];
  const vals = [];

  if (body.name !== undefined || body.title !== undefined) { sets.push("name=?"); vals.push(safeStr(body.name || body.title)); }
  if (body.description !== undefined) { sets.push("description=?"); vals.push(safeStr(body.description)); }
  if (body.order_index !== undefined || body.order !== undefined) { sets.push("order_index=?"); vals.push(toIntOrNull(body.order_index ?? body.order)); }
  if (body.is_active !== undefined || body.isActive !== undefined) { sets.push("is_active=?"); vals.push(toTinyBool(body.isActive ?? body.is_active)); }
  if (body.optional !== undefined) { sets.push("optional=?"); vals.push(toTinyBool(body.optional)); }
  if (body.estimatedMinutes !== undefined || body.estimated_minutes !== undefined) { sets.push("estimated_minutes=?"); vals.push(toIntOrNull(body.estimatedMinutes ?? body.estimated_minutes)); }

  if (!sets.length) return res.status(400).json({ error: "Sin campos para actualizar" });
  vals.push(blockId);

  try {
    const [result] = await db.query(`UPDATE block SET ${sets.join(",")} WHERE block_id=?`, vals);
    if (!result.affectedRows) return res.status(404).json({ error: "Bloque no encontrado" });

    // Devolver el árbol actualizado del programa padre
    const [bRow] = await db.query("SELECT p.code FROM program p JOIN block b ON b.program_id=p.program_id WHERE b.block_id=?", [blockId]);
    const tree = bRow.length ? await buildProgramTree(bRow[0].code) : null;
    return res.json({ action: "updated", tree });
  } catch (err) {
    console.error("❌ patchBlock:", err);
    return res.status(500).json({ error: "Error al actualizar bloque" });
  }
};

// POST /admin/catalog/blocks/:blockId/modules
// Añade (o actualiza) un módulo en el bloque
// Body: { code, title, description, order, isActive, isFinalExam, prerequisites, estimatedMinutes }
exports.createModule = async (req, res) => {
  const blockId = toIntOrNull(req.params.blockId);
  if (!blockId) return res.status(400).json({ error: "blockId inválido" });

  const { code, title, name, description, order, isActive, isFinalExam, prerequisites, estimatedMinutes } = req.body;
  const mCode = toUpperCode(code);
  if (!mCode) return res.status(400).json({ error: "code del módulo es requerido" });

  try {
    const [bRows] = await db.query(
      "SELECT b.block_id, p.code as program_code FROM block b JOIN program p ON p.program_id=b.program_id WHERE b.block_id=? LIMIT 1",
      [blockId]
    );
    if (!bRows.length) return res.status(404).json({ error: "Bloque no encontrado" });
    const programCode = bRows[0].program_code;

    let order_index = toIntOrNull(order);
    if (order_index === null) {
      const [maxRow] = await db.query("SELECT MAX(order_index) as mx FROM module WHERE block_id=?", [blockId]);
      order_index = (maxRow[0].mx || 0) + 1;
    }

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await upsertModule(conn, {
        block_id: blockId,
        code: mCode,
        name: safeStr(title || name || mCode),
        order_index,
        is_active: toTinyBool(isActive, 1),
        description: safeStr(description || ""),
        estimated_minutes: toIntOrNull(estimatedMinutes),
        prerequisites_json: jsonOrNull(prerequisites || []),
        is_final_exam: toTinyBool(isFinalExam, 0),
      });
      await conn.commit();
      const tree = await buildProgramTree(programCode);
      return res.status(result.action === "created" ? 201 : 200).json({ ...result, tree });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("❌ createModule:", err);
    return res.status(500).json({ error: "Error al crear módulo" });
  }
};

// PATCH /admin/catalog/modules/:moduleId
// Edita campos individuales de un módulo
exports.patchModule = async (req, res) => {
  const moduleId = toIntOrNull(req.params.moduleId);
  if (!moduleId) return res.status(400).json({ error: "moduleId inválido" });

  const body = req.body;
  const sets = [];
  const vals = [];

  if (body.name !== undefined || body.title !== undefined) { sets.push("name=?"); vals.push(safeStr(body.name || body.title)); }
  if (body.description !== undefined) { sets.push("description=?"); vals.push(safeStr(body.description)); }
  if (body.order_index !== undefined || body.order !== undefined) { sets.push("order_index=?"); vals.push(toIntOrNull(body.order_index ?? body.order)); }
  if (body.is_active !== undefined || body.isActive !== undefined) { sets.push("is_active=?"); vals.push(toTinyBool(body.isActive ?? body.is_active)); }
  if (body.is_final_exam !== undefined || body.isFinalExam !== undefined) { sets.push("is_final_exam=?"); vals.push(toTinyBool(body.isFinalExam ?? body.is_final_exam)); }
  if (body.prerequisites !== undefined || body.prerequisites_json !== undefined) { sets.push("prerequisites_json=?"); vals.push(jsonOrNull(body.prerequisites ?? body.prerequisites_json)); }
  if (body.estimatedMinutes !== undefined || body.estimated_minutes !== undefined) { sets.push("estimated_minutes=?"); vals.push(toIntOrNull(body.estimatedMinutes ?? body.estimated_minutes)); }

  if (!sets.length) return res.status(400).json({ error: "Sin campos para actualizar" });
  vals.push(moduleId);

  try {
    const [result] = await db.query(`UPDATE module SET ${sets.join(",")} WHERE module_id=?`, vals);
    if (!result.affectedRows) return res.status(404).json({ error: "Módulo no encontrado" });

    const [mRow] = await db.query(
      "SELECT p.code FROM program p JOIN block b ON b.program_id=p.program_id JOIN module m ON m.block_id=b.block_id WHERE m.module_id=?",
      [moduleId]
    );
    const tree = mRow.length ? await buildProgramTree(mRow[0].code) : null;
    return res.json({ action: "updated", tree });
  } catch (err) {
    console.error("❌ patchModule:", err);
    return res.status(500).json({ error: "Error al actualizar módulo" });
  }
};

// POST /admin/catalog/modules/:moduleId/activities
// Añade (o actualiza) una actividad en el módulo
// Body: { code, title, type, description, order, isActive, isFinalExam, required, estimatedMinutes, xp, minScore, config }
exports.createActivity = async (req, res) => {
  const moduleId = toIntOrNull(req.params.moduleId);
  if (!moduleId) return res.status(400).json({ error: "moduleId inválido" });

  const {
    code, title, name, type, description, order, isActive, isFinalExam,
    required, estimatedMinutes, xp, minScore, min_score, config,
  } = req.body;

  const aCode = toUpperCode(code);
  if (!aCode) return res.status(400).json({ error: "code de la actividad es requerido" });
  if (!type) return res.status(400).json({ error: "type es requerido" });

  try {
    const [mRows] = await db.query(
      `SELECT m.module_id, p.code as program_code
       FROM module m
       JOIN block b ON b.block_id=m.block_id
       JOIN program p ON p.program_id=b.program_id
       WHERE m.module_id=? LIMIT 1`,
      [moduleId]
    );
    if (!mRows.length) return res.status(404).json({ error: "Módulo no encontrado" });
    const programCode = mRows[0].program_code;

    let order_index = toIntOrNull(order);
    if (order_index === null) {
      const [maxRow] = await db.query("SELECT MAX(order_index) as mx FROM activity WHERE module_id=?", [moduleId]);
      order_index = (maxRow[0].mx || 0) + 1;
    }

    const configJson = config ? JSON.stringify(config) : null;
    const isFinalExamVal = toTinyBool(isFinalExam ?? config?.isFinalExam, 0);

    const conn = await db.getConnection();
    try {
      await conn.beginTransaction();
      const result = await upsertActivity(conn, {
        module_id: moduleId,
        code: aCode,
        name: safeStr(title || name || aCode),
        order_index,
        type: safeStr(type).slice(0, 30),
        required: toTinyBool(required, 1),
        min_score: toDecOrNull(minScore ?? min_score),
        is_active: toTinyBool(isActive, 1),
        description: safeStr(description || ""),
        estimated_minutes: toIntOrNull(estimatedMinutes),
        xp: toIntOrNull(xp),
        config_json: configJson,
        is_final_exam: isFinalExamVal,
      });
      await conn.commit();
      const tree = await buildProgramTree(programCode);
      return res.status(result.action === "created" ? 201 : 200).json({ ...result, tree });
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  } catch (err) {
    console.error("❌ createActivity:", err);
    return res.status(500).json({ error: "Error al crear actividad" });
  }
};

// PATCH /admin/catalog/activities/:activityId
// Edita campos individuales de una actividad.
// El campo "config" recibe el objeto ya armado por el frontend (nunca JSON crudo del usuario).
exports.patchActivity = async (req, res) => {
  const activityId = toIntOrNull(req.params.activityId);
  if (!activityId) return res.status(400).json({ error: "activityId inválido" });

  const body = req.body;
  const sets = [];
  const vals = [];

  if (body.name !== undefined || body.title !== undefined) { sets.push("name=?"); vals.push(safeStr(body.name || body.title)); }
  if (body.description !== undefined) { sets.push("description=?"); vals.push(safeStr(body.description)); }
  if (body.order_index !== undefined || body.order !== undefined) { sets.push("order_index=?"); vals.push(toIntOrNull(body.order_index ?? body.order)); }
  if (body.is_active !== undefined || body.isActive !== undefined) { sets.push("is_active=?"); vals.push(toTinyBool(body.isActive ?? body.is_active)); }
  if (body.type !== undefined) { sets.push("type=?"); vals.push(safeStr(body.type).slice(0, 30)); }
  if (body.required !== undefined) { sets.push("required=?"); vals.push(toTinyBool(body.required)); }
  if (body.min_score !== undefined || body.minScore !== undefined) { sets.push("min_score=?"); vals.push(toDecOrNull(body.minScore ?? body.min_score)); }
  if (body.xp !== undefined) { sets.push("xp=?"); vals.push(toIntOrNull(body.xp)); }
  if (body.estimatedMinutes !== undefined || body.estimated_minutes !== undefined) { sets.push("estimated_minutes=?"); vals.push(toIntOrNull(body.estimatedMinutes ?? body.estimated_minutes)); }
  if (body.is_final_exam !== undefined || body.isFinalExam !== undefined) { sets.push("is_final_exam=?"); vals.push(toTinyBool(body.isFinalExam ?? body.is_final_exam)); }
  if (body.config !== undefined) {
    sets.push("config_json=?");
    vals.push(body.config !== null ? JSON.stringify(body.config) : null);
  }

  if (!sets.length) return res.status(400).json({ error: "Sin campos para actualizar" });
  vals.push(activityId);

  try {
    const [result] = await db.query(`UPDATE activity SET ${sets.join(",")} WHERE activity_id=?`, vals);
    if (!result.affectedRows) return res.status(404).json({ error: "Actividad no encontrada" });

    const [aRow] = await db.query(
      `SELECT p.code FROM program p
       JOIN block b ON b.program_id=p.program_id
       JOIN module m ON m.block_id=b.block_id
       JOIN activity a ON a.module_id=m.module_id
       WHERE a.activity_id=?`,
      [activityId]
    );
    const tree = aRow.length ? await buildProgramTree(aRow[0].code) : null;
    return res.json({ action: "updated", tree });
  } catch (err) {
    console.error("❌ patchActivity:", err);
    return res.status(500).json({ error: "Error al actualizar actividad" });
  }
};
