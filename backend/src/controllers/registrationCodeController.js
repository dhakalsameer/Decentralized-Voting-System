import crypto from "crypto";
import { db } from "../db.js";
import { electionContractV3 } from "../blockchain/electionContract.js";
import { generateRegCodeMerkleRoot, generateRegCodeMerkleProof } from "../services/merkleService.js";
import { sendBatchRegistrationCodes } from "../services/emailService.js";
import { emitEvent } from "../socket.js";

/**
 * Rebuild the registration code Merkle tree from all unused codes in the DB
 * and update the on-chain regCodeMerkleRoot.
 */
export async function rebuildRegCodeMerkleRoot() {
  const result = await db.query(
    "SELECT student_id, code FROM registration_codes"
  );
  const allCodes = result.rows;
  const root = generateRegCodeMerkleRoot(allCodes);
  console.log("Updating RegCode Merkle Root to:", root);
  const tx = await electionContractV3.setRegCodeMerkleRoot(root);
  await tx.wait();
  return root;
}

/**
 * Generate a human-friendly code: XXXX-XXXX-XXXX (12 uppercase alphanumeric chars).
 */
function generateCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // omit 0, O, I, 1 for readability
  let code = "";
  for (let i = 0; i < 12; i++) {
    if (i > 0 && i % 4 === 0) code += "-";
    code += chars[crypto.randomInt(chars.length)];
  }
  return code;
}

const VALID_YEARS = ["1st", "2nd", "3rd", "4th"];
const VALID_GENDERS = ["male", "female", "other"];

/**
 * Normalize a raw student record.
 * Validates year/gender, returns null if student_id is missing.
 */
function normalizeStudent(s, seen) {
  const id = String(s.student_id || "").trim().toUpperCase();
  if (!id || seen.has(id)) return null;
  seen.add(id);

  const year = s.year ? String(s.year).trim().toLowerCase() : null;
  const gender = s.gender ? String(s.gender).trim().toLowerCase() : null;

  return {
    student_id: id,
    name: s.name ? String(s.name).trim() : null,
    year,
    gender,
    email: s.email ? String(s.email).trim().toLowerCase() : null,
  };
}

/**
 * Shared core: upsert students and generate registration codes.
 * Takes a normalized array of { student_id, name?, year?, gender? }.
 * Returns { generated, reused, skipped, count, codes }.
 */
export async function processStudents(normalized) {
  const generated = [];
  const reused = [];
  const skipped = [];

  for (const student of normalized) {
    // Upsert student record
    await db.query(
      `INSERT INTO students (student_id, name, year, gender, email, registered)
       VALUES ($1, $2, $3, $4, $5, false)
       ON CONFLICT (student_id) DO UPDATE SET
         name = COALESCE(students.name, EXCLUDED.name),
         year = COALESCE(students.year, EXCLUDED.year),
         gender = COALESCE(students.gender, EXCLUDED.gender),
         email = COALESCE(students.email, EXCLUDED.email),
         updated_at = NOW()
       WHERE students.registered = false OR students.name IS NULL`,
      [student.student_id, student.name, student.year, student.gender, student.email]
    );

    const reg = await db.query(
      `SELECT registered, name, year, gender FROM students WHERE student_id = $1`,
      [student.student_id]
    );

    const existingCode = await db.query(
      "SELECT code, used FROM registration_codes WHERE student_id = $1 ORDER BY used ASC, id DESC LIMIT 1",
      [student.student_id]
    );

    if (existingCode.rows.length > 0) {
      const row = existingCode.rows[0];
      if (reg.rows[0]?.registered) {
        skipped.push({ student_id: student.student_id, reason: "already registered", ...reg.rows[0] });
      } else if (!row.used) {
        reused.push({ student_id: student.student_id, code: row.code, ...reg.rows[0] });
      } else {
        skipped.push({ student_id: student.student_id, reason: "code used", ...reg.rows[0] });
      }
      continue;
    }

    let code = generateCode();
    let attempts = 0;
    while (attempts < 5) {
      try {
        await db.query(
          "INSERT INTO registration_codes (student_id, code) VALUES ($1, $2)",
          [student.student_id, code]
        );
        generated.push({ student_id: student.student_id, code, ...reg.rows[0] });
        break;
      } catch (err) {
        if (err.code === "23505") {
          code = generateCode();
          attempts++;
          continue;
        }
        throw err;
      }
    }
  }

  return {
    generated,
    reused,
    skipped,
    count: generated.length,
    codes: [...generated, ...reused],
  };
}

/**
 * POST /api/admin/generate-codes
 * Body: { students: [{student_id, name?, year?, gender?}] }
 */
export const generateCodes = async (req, res) => {
  try {
    const { students } = req.body;

    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: "students must be a non-empty array" });
    }

    const seen = new Set();
    const normalized = [];
    for (const s of students) {
      const n = normalizeStudent(s, seen);
      if (!n) continue;

      if (n.year && !VALID_YEARS.includes(n.year)) {
        return res.status(400).json({ error: `Invalid year "${n.year}" for ${n.student_id}. Must be one of: ${VALID_YEARS.join(", ")}` });
      }
      if (n.gender && !VALID_GENDERS.includes(n.gender)) {
        return res.status(400).json({ error: `Invalid gender "${n.gender}" for ${n.student_id}. Must be one of: ${VALID_GENDERS.join(", ")}` });
      }

      normalized.push(n);
    }

    if (normalized.length === 0) {
      return res.status(400).json({ error: "No valid students provided" });
    }

    const result = await processStudents(normalized);

    let merkleRoot = null;
    if (result.codes.length > 0) {
      try {
        merkleRoot = await rebuildRegCodeMerkleRoot();
        emitEvent("dataChanged", { type: "registrationCodes" });
      } catch (err) {
        console.error("Failed to update on-chain Merkle root:", err.message);
      }
    }

    return res.status(201).json({
      message: "Registration codes processed",
      merkleRoot,
      ...result,
    });
  } catch (error) {
    console.error("generateCodes error:", error);
    return res.status(500).json({ error: "Failed to generate registration codes" });
  }
};

/**
 * GET /api/admin/codes
 * Query: ?used=true|false&studentId=GU001
 *
 * List registration codes (optionally filtered).
 */
export const listCodes = async (req, res) => {
  try {
    const { used, studentId } = req.query;
    let sql = `
      SELECT rc.id, rc.student_id, rc.code, rc.used, rc.created_at, rc.used_at,
             s.name, s.email, s.registered AS student_registered
      FROM registration_codes rc
      LEFT JOIN students s ON s.student_id = rc.student_id`;
    const where = [];
    const params = [];

    if (used !== undefined) {
      if (used === "true") {
        where.push(`(rc.used = true OR s.registered = true)`);
      } else {
        where.push(`(rc.used = false AND (s.registered IS NULL OR s.registered = false))`);
      }
    }
    if (studentId) {
      params.push(studentId);
      where.push(`rc.student_id = $${params.length}`);
    }

    if (where.length > 0) {
      sql += " WHERE " + where.join(" AND ");
    }

    sql += " ORDER BY rc.created_at DESC";

    const result = await db.query(sql, params);
    const codes = result.rows.map((row) => ({
      ...row,
      used: row.used || row.student_registered === true,
    }));
    return res.json({ codes });
  } catch (error) {
    console.error("listCodes error:", error);
    return res.status(500).json({ error: "Failed to list registration codes" });
  }
};

/**
 * GET /api/codes/proof
 * Query: ?studentId=GU001&code=ABCD-EFGH-IJKL
 *
 * Returns the Merkle proof for a specific student_id + code pair.
 * Requires both studentId and code to prevent information leakage.
 */
export const getRegCodeProof = async (req, res) => {
  try {
    const { studentId, code } = req.query;

    if (!studentId || !code) {
      return res.status(400).json({ error: "studentId and code query parameters are required" });
    }

    const result = await db.query(
      "SELECT student_id, code FROM registration_codes"
    );

    const allCodes = result.rows;
    const proof = generateRegCodeMerkleProof(allCodes, studentId.toUpperCase(), code.toUpperCase());

    return res.json({ proof, student_id: studentId.toUpperCase(), code: code.toUpperCase() });
  } catch (error) {
    console.error("getRegCodeProof error:", error);
    return res.status(500).json({ error: "Failed to generate proof" });
  }
};

/**
 * GET /api/admin/regcode-merkle-root
 *
 * Returns the current on-chain regCodeMerkleRoot.
 */
export const getRegCodeMerkleRoot = async (_req, res) => {
  try {
    const root = await electionContractV3.regCodeMerkleRoot();
    return res.json({ merkleRoot: root });
  } catch (error) {
    console.error("getRegCodeMerkleRoot error:", error);
    return res.status(500).json({ error: "Failed to fetch Merkle root" });
  }
};

/**
 * POST /api/admin/rebuild-regcode-merkle-root
 *
 * Manually rebuilds the registration code Merkle tree from all codes
 * and updates the on-chain root. Useful after manual deletions.
 */
export const adminRebuildRegCodeMerkleRoot = async (_req, res) => {
  try {
    const root = await rebuildRegCodeMerkleRoot();
    return res.json({ success: true, merkleRoot: root });
  } catch (error) {
    console.error("adminRebuildRegCodeMerkleRoot error:", error);
    return res.status(500).json({ error: "Failed to rebuild Merkle root" });
  }
};

/**
 * POST /api/admin/send-codes
 * Body: { student_ids?: string[] }
 *
 * Sends registration codes via email to students.
 * If student_ids is provided, only sends to those; otherwise sends to all with unused codes.
 */
export const sendCodesEmail = async (req, res) => {
  try {
    const { student_ids } = req.body;

    let rows;
    if (Array.isArray(student_ids) && student_ids.length > 0) {
      const result = await db.query(
        `SELECT rc.student_id, rc.code, s.name, s.email
         FROM registration_codes rc
         LEFT JOIN students s ON s.student_id = rc.student_id
         WHERE rc.student_id = ANY($1::text[])
           AND rc.used = false
           AND s.email IS NOT NULL`,
        [student_ids]
      );
      rows = result.rows;
    } else {
      const result = await db.query(
        `SELECT rc.student_id, rc.code, s.name, s.email
         FROM registration_codes rc
         LEFT JOIN students s ON s.student_id = rc.student_id
         WHERE rc.used = false
           AND s.email IS NOT NULL`
      );
      rows = result.rows;
    }

    if (rows.length === 0) {
      return res.status(400).json({ error: "No students with email addresses found for unused codes" });
    }

    const { sent, failed, devMode } = await sendBatchRegistrationCodes(rows);

    return res.json({
      message: devMode
        ? `Emails logged to console (no provider configured). Set RESEND_API_KEY or SMTP_* env vars to send real emails.`
        : `Emails sent to ${sent.length} student(s)`,
      sent,
      failed,
      devMode,
      total: rows.length,
    });
  } catch (error) {
    console.error("sendCodesEmail error:", error);
    return res.status(500).json({ error: error.message || "Failed to send emails" });
  }
};
