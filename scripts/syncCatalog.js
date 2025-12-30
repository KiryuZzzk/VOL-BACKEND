/**
 * scripts/syncCatalog.js
 *
 * Sync (UPSERT) catalog from JSON into MySQL:
 * program -> block -> module -> activity
 * Matching by code (NOT order).
 *
 * INPUT:
 *   data/catalog.json
 *
 * OUTPUT:
 *   data/catalog.with_ids.json
 *
 * Run:
 *   node scripts/syncCatalog.js
 */
require("dotenv").config({ path: require("path").resolve(process.cwd(), ".env") });

const fs = require("fs");
const path = require("path");

// ✅ Usa tu pool oficial: carga .env, DB_PORT, SSL, etc.
const db = require("../config/db");

// ---------- PATHS ----------
const ROOT = process.cwd();
const INPUT_JSON = path.resolve(ROOT, "data", "catalog.json");
const OUTPUT_JSON = path.resolve(ROOT, "data", "catalog.with_ids.json");

// ---------- HELPERS ----------
const pickTitle = (o) => o?.title || o?.name || o?.label || o?.code || "SIN_TITULO";

const toIntOrder = (o, fallback) => {
  const v = o?.order ?? o?.order_index ?? o?.orderIndex;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
};

const toTinyBool = (v, def = 1) => (v == null ? def : v ? 1 : 0);

const safeType = (a) => String(a?.type || "reading").slice(0, 30);

async function selectOne(conn, sql, params) {
  const [rows] = await conn.query(sql, params);
  return rows?.[0] || null;
}

async function upsertProgram(conn, { code, name }) {
  const ex = await selectOne(conn, "SELECT program_id FROM program WHERE code=? LIMIT 1", [code]);
  if (!ex) {
    const [ins] = await conn.query("INSERT INTO program (code, name) VALUES (?,?)", [code, name]);
    return { program_id: ins.insertId, action: "created" };
  }
  await conn.query("UPDATE program SET name=? WHERE program_id=?", [name, ex.program_id]);
  return { program_id: ex.program_id, action: "updated" };
}

async function upsertBlock(conn, { program_id, code, name, order_index }) {
  const ex = await selectOne(
    conn,
    "SELECT block_id FROM block WHERE program_id=? AND code=? LIMIT 1",
    [program_id, code]
  );
  if (!ex) {
    const [ins] = await conn.query(
      "INSERT INTO block (program_id, code, name, order_index) VALUES (?,?,?,?)",
      [program_id, code, name, order_index]
    );
    return { block_id: ins.insertId, action: "created" };
  }
  await conn.query("UPDATE block SET name=?, order_index=? WHERE block_id=?", [
    name,
    order_index,
    ex.block_id,
  ]);
  return { block_id: ex.block_id, action: "updated" };
}

async function upsertModule(conn, { block_id, code, name, order_index }) {
  const ex = await selectOne(
    conn,
    "SELECT module_id FROM module WHERE block_id=? AND code=? LIMIT 1",
    [block_id, code]
  );
  if (!ex) {
    const [ins] = await conn.query(
      "INSERT INTO module (block_id, code, name, order_index) VALUES (?,?,?,?)",
      [block_id, code, name, order_index]
    );
    return { module_id: ins.insertId, action: "created" };
  }
  await conn.query("UPDATE module SET name=?, order_index=? WHERE module_id=?", [
    name,
    order_index,
    ex.module_id,
  ]);
  return { module_id: ex.module_id, action: "updated" };
}

async function upsertActivity(conn, {
  module_id,
  code,
  name,
  order_index,
  type,
  required,
  min_score,
  is_final_exam,
}) {
  const ex = await selectOne(
    conn,
    "SELECT activity_id FROM activity WHERE module_id=? AND code=? LIMIT 1",
    [module_id, code]
  );

  if (!ex) {
    const [ins] = await conn.query(
      `INSERT INTO activity
       (module_id, code, name, order_index, type, required, min_score, is_final_exam)
       VALUES (?,?,?,?,?,?,?,?)`,
      [module_id, code, name, order_index, type, required, min_score, is_final_exam]
    );
    return { activity_id: ins.insertId, action: "created" };
  }

  await conn.query(
    `UPDATE activity
     SET name=?, order_index=?, type=?, required=?, min_score=?, is_final_exam=?
     WHERE activity_id=?`,
    [name, order_index, type, required, min_score, is_final_exam, ex.activity_id]
  );

  return { activity_id: ex.activity_id, action: "updated" };
}

// ---------- MAIN ----------
(async () => {
  if (!fs.existsSync(INPUT_JSON)) {
    console.error(`❌ No encontré el archivo: ${INPUT_JSON}`);
    process.exit(1);
  }

  const data = JSON.parse(fs.readFileSync(INPUT_JSON, "utf-8"));
  const programs = Array.isArray(data.programs)
    ? data.programs
    : data.program
      ? [data.program]
      : [];

  if (!programs.length) {
    console.error("❌ Tu JSON no tiene 'programs' ni 'program'.");
    process.exit(1);
  }

  const conn = await db.getConnection();

  const counters = {
    created: { program: 0, block: 0, module: 0, activity: 0 },
    updated: { program: 0, block: 0, module: 0, activity: 0 },
  };

  try {
    await conn.beginTransaction();

    for (let pi = 0; pi < programs.length; pi++) {
      const p = programs[pi];
      if (!p.code) throw new Error(`Programa sin code en index ${pi}`);

      const pRes = await upsertProgram(conn, { code: p.code, name: pickTitle(p) });
      p.program_id = pRes.program_id;
      counters[pRes.action].program++;

      console.log(`${pRes.action === "created" ? "➕" : "✔"} Program ${p.code} -> ${p.program_id}`);

      const blocks = p.blocks || [];
      for (let bi = 0; bi < blocks.length; bi++) {
        const b = blocks[bi];
        if (!b.code) throw new Error(`Bloque sin code en program ${p.code}, index ${bi}`);

        const bRes = await upsertBlock(conn, {
          program_id: p.program_id,
          code: b.code,
          name: pickTitle(b),
          order_index: toIntOrder(b, bi + 1),
        });

        b.block_id = bRes.block_id;
        counters[bRes.action].block++;
        console.log(`  ${bRes.action === "created" ? "➕" : "✔"} Block ${p.code}-${b.code} -> ${b.block_id}`);

        const modules = b.modules || [];
        for (let mi = 0; mi < modules.length; mi++) {
          const m = modules[mi];
          if (!m.code) throw new Error(`Módulo sin code en ${p.code}-${b.code}, index ${mi}`);

          const mRes = await upsertModule(conn, {
            block_id: b.block_id,
            code: m.code,
            name: pickTitle(m),
            order_index: toIntOrder(m, mi + 1),
          });

          m.module_id = mRes.module_id;
          counters[mRes.action].module++;
          console.log(`    ${mRes.action === "created" ? "➕" : "✔"} Module ${p.code}-${b.code}-${m.code} -> ${m.module_id}`);

          const activities = m.activities || [];
          for (let ai = 0; ai < activities.length; ai++) {
            const a = activities[ai];
            if (!a.code) throw new Error(`Actividad sin code en ${p.code}-${b.code}-${m.code}, index ${ai}`);

            const aRes = await upsertActivity(conn, {
              module_id: m.module_id,
              code: a.code,
              name: pickTitle(a),
              order_index: toIntOrder(a, ai + 1),
              type: safeType(a),
              required: toTinyBool(a.required, 1),
              min_score: a.min_score ?? a.minScore ?? a?.config?.minScore ?? null,
              is_final_exam: toTinyBool(a.isFinalExam ?? a?.config?.isFinalExam, 0),
            });

            a.activity_id = aRes.activity_id;
            counters[aRes.action].activity++;
          }
        }
      }
    }

    await conn.commit();

    const out = data.programs ? { ...data, programs } : { ...data, program: programs[0] };
    fs.writeFileSync(OUTPUT_JSON, JSON.stringify(out, null, 2), "utf-8");

    console.log("\n✅ Catálogo sincronizado.");
    console.log("Resumen:", counters);
    console.log("📄 JSON con IDs:", OUTPUT_JSON);
  } catch (err) {
    await conn.rollback();
    console.error("\n❌ Error. Rollback aplicado (no guardé nada).");
    console.error(err);
    process.exit(1);
  } finally {
    conn.release();
    await db.end();
  }
})();
