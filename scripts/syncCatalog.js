/**
 * scripts/syncCatalog.js
 *
 * Sync (UPSERT) catalog.json -> MySQL
 * Uses provided "code" fields (NO auto-codes).
 *
 * Run:
 *   node scripts/syncCatalog.js
 *
 * Input:
 *   data/catalog.json
 *
 * Output:
 *   data/catalog.with_ids.json
 */

const fs = require("fs");
const path = require("path");
require("dotenv").config({ path: path.resolve(process.cwd(), ".env") });

const db = require("../config/db");

const INPUT_JSON = path.resolve(process.cwd(), "data", "catalog.json");
const OUTPUT_JSON = path.resolve(process.cwd(), "data", "catalog.with_ids.json");

// ---------- Helpers ----------
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

const safeStr = (v) => {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  return String(v);
};

const toUpperCode = (v) => safeStr(v).trim().toUpperCase();

const ensureCode = (code, where) => {
  const c = toUpperCode(code);
  if (!c) throw new Error(`Falta "code" en ${where}`);
  if (c.length > 20) throw new Error(`"code" demasiado largo (${c.length}) en ${where}: ${c}`);
  return c;
};

const toTinyBool = (v, def = 0) => {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === 1 || v === 0) return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["1", "true", "yes", "si", "sí"].includes(s)) return 1;
    if (["0", "false", "no"].includes(s)) return 0;
  }
  return def;
};

const toIntOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
};

const toDecOrNull = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

const jsonOrNull = (v) => {
  if (v === null || v === undefined) return null;
  if (Array.isArray(v) || isObj(v)) return JSON.stringify(v);
  if (typeof v === "string") return v;
  return JSON.stringify(v);
};

async function selectOne(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows && rows.length ? rows[0] : null;
}

// ---------- UPSERTS ----------
async function upsertProgram(conn, p) {
  const ex = await selectOne(conn, "SELECT program_id FROM program WHERE code=? LIMIT 1", [p.code]);

  if (!ex) {
    const [ins] = await conn.query(
      `
      INSERT INTO program
        (code, name, is_active, description, image, formacion, level, estimated_minutes, tags_json)
      VALUES
        (?,?,?,?,?,?,?,?,?)
      `,
      [
        p.code,
        p.name,
        p.is_active,
        p.description,
        p.image,
        p.formacion,
        p.level,
        p.estimated_minutes,
        p.tags_json,
      ]
    );
    return { program_id: ins.insertId, action: "created" };
  }

  await conn.query(
    `
    UPDATE program
    SET name=?,
        is_active=?,
        description=?,
        image=?,
        formacion=?,
        level=?,
        estimated_minutes=?,
        tags_json=?
    WHERE program_id=?
    `,
    [
      p.name,
      p.is_active,
      p.description,
      p.image,
      p.formacion,
      p.level,
      p.estimated_minutes,
      p.tags_json,
      ex.program_id,
    ]
  );

  return { program_id: ex.program_id, action: "updated" };
}

async function upsertBlock(conn, b) {
  const ex = await selectOne(
    conn,
    "SELECT block_id FROM block WHERE program_id=? AND code=? LIMIT 1",
    [b.program_id, b.code]
  );

  if (!ex) {
    const [ins] = await conn.query(
      `
      INSERT INTO block
        (program_id, code, name, order_index, is_active, description, estimated_minutes, optional)
      VALUES
        (?,?,?,?,?,?,?,?)
      `,
      [
        b.program_id,
        b.code,
        b.name,
        b.order_index,
        b.is_active,
        b.description,
        b.estimated_minutes,
        b.optional,
      ]
    );
    return { block_id: ins.insertId, action: "created" };
  }

  await conn.query(
    `
    UPDATE block
    SET name=?,
        order_index=?,
        is_active=?,
        description=?,
        estimated_minutes=?,
        optional=?
    WHERE block_id=?
    `,
    [b.name, b.order_index, b.is_active, b.description, b.estimated_minutes, b.optional, ex.block_id]
  );

  return { block_id: ex.block_id, action: "updated" };
}

async function upsertModule(conn, m) {
  const ex = await selectOne(
    conn,
    "SELECT module_id FROM module WHERE block_id=? AND code=? LIMIT 1",
    [m.block_id, m.code]
  );

  if (!ex) {
    const [ins] = await conn.query(
      `
      INSERT INTO module
        (block_id, code, name, order_index, is_active, description, estimated_minutes, prerequisites_json, is_final_exam)
      VALUES
        (?,?,?,?,?,?,?,?,?)
      `,
      [
        m.block_id,
        m.code,
        m.name,
        m.order_index,
        m.is_active,
        m.description,
        m.estimated_minutes,
        m.prerequisites_json,
        m.is_final_exam,
      ]
    );
    return { module_id: ins.insertId, action: "created" };
  }

  await conn.query(
    `
    UPDATE module
    SET name=?,
        order_index=?,
        is_active=?,
        description=?,
        estimated_minutes=?,
        prerequisites_json=?,
        is_final_exam=?
    WHERE module_id=?
    `,
    [
      m.name,
      m.order_index,
      m.is_active,
      m.description,
      m.estimated_minutes,
      m.prerequisites_json,
      m.is_final_exam,
      ex.module_id,
    ]
  );

  return { module_id: ex.module_id, action: "updated" };
}

async function upsertActivity(conn, a) {
  const ex = await selectOne(
    conn,
    "SELECT activity_id FROM activity WHERE module_id=? AND code=? LIMIT 1",
    [a.module_id, a.code]
  );

  if (!ex) {
    const [ins] = await conn.query(
      `
      INSERT INTO activity
        (module_id, code, name, order_index, type, required, min_score, is_active,
         description, estimated_minutes, xp, config_json, is_final_exam)
      VALUES
        (?,?,?,?,?,?,?,?,?,?,?,?,?)
      `,
      [
        a.module_id,
        a.code,
        a.name,
        a.order_index,
        a.type,
        a.required,
        a.min_score,
        a.is_active,
        a.description,
        a.estimated_minutes,
        a.xp,
        a.config_json,
        a.is_final_exam,
      ]
    );
    return { activity_id: ins.insertId, action: "created" };
  }

  await conn.query(
    `
    UPDATE activity
    SET name=?,
        order_index=?,
        type=?,
        required=?,
        min_score=?,
        is_active=?,
        description=?,
        estimated_minutes=?,
        xp=?,
        config_json=?,
        is_final_exam=?
    WHERE activity_id=?
    `,
    [
      a.name,
      a.order_index,
      a.type,
      a.required,
      a.min_score,
      a.is_active,
      a.description,
      a.estimated_minutes,
      a.xp,
      a.config_json,
      a.is_final_exam,
      ex.activity_id,
    ]
  );

  return { activity_id: ex.activity_id, action: "updated" };
}

// ---------- Main ----------
(async () => {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error(`❌ No existe: ${INPUT_JSON}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(INPUT_JSON, "utf-8");
  const parsed = JSON.parse(raw);

  const programs = Array.isArray(parsed?.programs) ? parsed.programs : [];
  if (!programs.length) {
    console.error('❌ JSON inválido: esperaba { "programs": [...] }');
    process.exit(1);
  }

  const conn = await db.getConnection();

  const counters = {
    program: { created: 0, updated: 0 },
    block: { created: 0, updated: 0 },
    module: { created: 0, updated: 0 },
    activity: { created: 0, updated: 0 },
  };

  try {
    await conn.beginTransaction();

    const out = { programs: [] };

    for (let pi = 0; pi < programs.length; pi++) {
      const p = programs[pi];
      const pCode = ensureCode(p?.code, `programs[${pi}]`);

      const pPayload = {
        code: pCode,
        name: safeStr(p?.name || p?.title || pCode),
        is_active: toTinyBool(p?.isActive, 1),

        description: safeStr(p?.description || ""),
        image: p?.image ? safeStr(p.image) : null,
        formacion: p?.formacion ? safeStr(p.formacion) : null,
        level: p?.level ? safeStr(p.level) : null,
        estimated_minutes: toIntOrNull(p?.estimatedMinutes),
        tags_json: jsonOrNull(p?.tags || []),
      };

      const pRes = await upsertProgram(conn, pPayload);
      counters.program[pRes.action]++;

      const program_id = pRes.program_id;

      const pOut = { ...p, code: pCode, program_id, blocks: [] };

      const blocks = Array.isArray(p?.blocks) ? p.blocks : [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        const bCode = ensureCode(b?.code, `program ${pCode} blocks[${bi}]`);

        const bPayload = {
          program_id,
          code: bCode,
          name: safeStr(b?.name || b?.title || bCode),
          order_index: toIntOrNull(b?.order) ?? bi + 1,
          is_active: toTinyBool(b?.isActive, 1),

          description: safeStr(b?.description || ""),
          estimated_minutes: toIntOrNull(b?.estimatedMinutes),
          optional: toTinyBool(b?.optional, 0),
        };

        const bRes = await upsertBlock(conn, bPayload);
        counters.block[bRes.action]++;

        const block_id = bRes.block_id;
        const bOut = { ...b, code: bCode, block_id, modules: [] };

        const modules = Array.isArray(b?.modules) ? b.modules : [];
        for (let mi = 0; mi < modules.length; mi++) {
          const m = modules[mi];
          const mCode = ensureCode(m?.code, `program ${pCode} block ${bCode} modules[${mi}]`);

          const mPayload = {
            block_id,
            code: mCode,
            name: safeStr(m?.name || m?.title || mCode),
            order_index: toIntOrNull(m?.order) ?? mi + 1,
            is_active: toTinyBool(m?.isActive, 1),

            description: safeStr(m?.description || ""),
            estimated_minutes: toIntOrNull(m?.estimatedMinutes),
            prerequisites_json: jsonOrNull(m?.prerequisites || []),
            is_final_exam: toTinyBool(m?.isFinalExam, 0),
          };

          const mRes = await upsertModule(conn, mPayload);
          counters.module[mRes.action]++;

          const module_id = mRes.module_id;
          const mOut = { ...m, code: mCode, module_id, activities: [] };

          const activities = Array.isArray(m?.activities) ? m.activities : [];
          for (let ai = 0; ai < activities.length; ai++) {
            const a = activities[ai];
            const aCode = ensureCode(a?.code, `program ${pCode} block ${bCode} module ${mCode} activities[${ai}]`);

            // isFinalExam puede venir en activity o adentro de config
            const isFinalExam = toTinyBool(a?.isFinalExam ?? a?.config?.isFinalExam, 0);

            const aPayload = {
              module_id,
              code: aCode,
              name: safeStr(a?.name || a?.title || aCode),
              order_index: toIntOrNull(a?.order) ?? ai + 1,

              type: safeStr(a?.type || "reading").slice(0, 30),
              required: toTinyBool(a?.required, 1),
              min_score: toDecOrNull(a?.min_score ?? a?.minScore ?? a?.config?.minScore),
              is_active: toTinyBool(a?.isActive, 1),

              description: safeStr(a?.description || ""),
              estimated_minutes: toIntOrNull(a?.estimatedMinutes),
              xp: toIntOrNull(a?.xp),
              config_json: a?.config ? JSON.stringify(a.config) : null,
              is_final_exam: isFinalExam,
            };

            const aRes = await upsertActivity(conn, aPayload);
            counters.activity[aRes.action]++;

            mOut.activities.push({ ...a, code: aCode, activity_id: aRes.activity_id });
          }

          bOut.modules.push(mOut);
        }

        pOut.blocks.push(bOut);
      }

      out.programs.push(pOut);
    }

    await conn.commit();

    fs.mkdirSync(path.dirname(OUTPUT_JSON), { recursive: true });
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2), "utf-8");

    console.log("\n✅ Catálogo sincronizado (UPSERT).");
    console.log("Resumen:", counters);
    console.log("📄 Output con IDs:", OUTPUT_JSON);
  } catch (err) {
    await conn.rollback();
    console.error("\n❌ Error. Rollback aplicado (no guardé nada).");
    console.error(err);
    process.exit(1);
  } finally {
    conn.release();
    if (typeof db.end === "function") await db.end();
  }
})();
