#!/usr/bin/env node
require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });
const { Pool } = require("pg");
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const GATEWAYS = [
  "https://ipfs.filebase.io",
  "https://dweb.link",
  "https://ipfs.io",
  "https://cloudflare-ipfs.com",
];

async function fetchWithTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return Buffer.from(buf);
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function resolveOne(cid) {
  for (const gw of GATEWAYS) {
    const buf = await fetchWithTimeout(`${gw}/ipfs/${cid}`, 15000);
    if (buf) return buf;
  }
  return null;
}

(async () => {
  const { rows } = await pool.query(
    "SELECT student_id, name, image_cid FROM students WHERE image_cid IS NOT NULL AND image_cid LIKE 'Qm%' ORDER BY student_id"
  );
  console.log(`Found ${rows.length} students with IPFS CIDs`);

  const results = await Promise.all(
    rows.map(async (r) => {
      const buf = await resolveOne(r.image_cid);
      return { ...r, buf };
    })
  );

  let saved = 0, gone = 0;
  for (const r of results) {
    if (r.buf) {
      const base64 = r.buf.toString("base64");
      await pool.query(
        "UPDATE students SET photo_base64 = $1, image_cid = $2 WHERE student_id = $3",
        [base64, `db:student:${r.student_id}`, r.student_id]
      );
      saved++;
      console.log(`  SAVED ${r.student_id} ${r.name} (${(r.buf.length / 1024).toFixed(0)}KB)`);
    } else {
      gone++;
      console.log(`  GONE  ${r.student_id} ${r.name} — not on any gateway`);
    }
  }
  console.log(`\nDone. Saved ${saved} to DB, ${gone} still unrecoverable.`);
  await pool.end();
})().catch((e) => {
  console.error(e.message);
  process.exit(1);
});