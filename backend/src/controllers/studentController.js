import bcrypt from "bcrypt";
import { db } from "../db.js";
import { rebuildMerkleTrees } from "./voterController.js";
import { rebuildRegCodeMerkleRoot } from "./registrationCodeController.js";
import { electionContractV3 } from "../blockchain/electionContract.js";

const VALID_YEARS = ["1st", "2nd", "3rd", "4th"];
const VALID_GENDERS = ["male", "female", "other"];

export const createStudent = async (req, res) => {
  try {
    const { student_id, name, wallet_address, image_cid } = req.body;
    const year = req.body.year || req.body.registration_year || null;
    const gender = req.body.gender || null;

    if (!student_id || !name) {
      return res.status(400).json({ error: "student_id and name are required" });
    }

    // Ensure wallet is not already linked to a different student
    if (wallet_address) {
      const walletCheck = await db.query(
        `SELECT student_id FROM students
         WHERE LOWER(wallet_address) = LOWER($1) AND student_id != $2`,
        [wallet_address, student_id.toUpperCase()]
      );
      if (walletCheck.rows.length > 0) {
        return res.status(409).json({ error: "Wallet already linked to another student" });
      }
    }

    const result = await db.query(
      `INSERT INTO students (student_id, name, year, gender, wallet_address, image_cid)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (student_id) DO UPDATE SET
         name = EXCLUDED.name,
         year = COALESCE(students.year, EXCLUDED.year),
         gender = COALESCE(students.gender, EXCLUDED.gender),
         wallet_address = COALESCE(students.wallet_address, EXCLUDED.wallet_address),
         image_cid = COALESCE(students.image_cid, EXCLUDED.image_cid),
         updated_at = NOW()
       RETURNING *`,
      [student_id.toUpperCase(), name, year, gender, wallet_address || null, image_cid || null]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error("createStudent error:", error);
    res.status(500).json({ error: "Failed to create/update student" });
  }
};

export const getStudents = async (req, res) => {
  const result = await db.query(
    `SELECT student_id, name, year, gender, wallet_address, wallet_verified,
            eligible_to_vote, image_cid, is_verified, registered, email,
            created_at, updated_at
     FROM students`
  );
  res.json(result.rows);
};

export const getAllStudents = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT student_id, name, year, gender, wallet_address, wallet_verified, eligible_to_vote, image_cid
       FROM students
       ORDER BY year, student_id`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("getAllStudents error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

export const deleteStudent = async (req, res) => {
  let client;
  try {
    const { student_id } = req.params;
    if (!student_id) {
      return res.status(400).json({ error: "student_id is required" });
    }

    // Check if the student was eligible to vote before deleting
    const checkResult = await db.query(
      `SELECT eligible_to_vote FROM students WHERE student_id = $1`,
      [student_id]
    );
    const wasEligible = checkResult.rows.length > 0 && checkResult.rows[0].eligible_to_vote;

    if (wasEligible) {
      const phase = Number(await electionContractV3.getPhase());
      if (phase >= 2) {
        return res.status(400).json({
          error: "Cannot delete a whitelisted voter during Voting or later. Merkle roots are locked on-chain; revoke them before starting the vote or after the election ends.",
        });
      }
    }

    client = await db.connect();
    await client.query("BEGIN");
    await client.query(`DELETE FROM distribution_log WHERE student_id = $1`, [student_id]);
    await client.query(
      `UPDATE candidates SET applied_by = NULL WHERE applied_by = $1`,
      [student_id]
    );
    const result = await client.query(
      `DELETE FROM students WHERE student_id = $1 RETURNING student_id, name`,
      [student_id]
    );
    if (result.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Student not found" });
    }
    await client.query("COMMIT");
    client.release();
    client = null;

    if (wasEligible) {
      await rebuildMerkleTrees();
    }

    // Rebuild registration code Merkle tree (code may have been orphaned)
    try {
      await rebuildRegCodeMerkleRoot();
    } catch (err) {
      console.error("Failed to rebuild reg code Merkle root after delete:", err.message);
    }

    res.json({ success: true, deleted: result.rows[0] });
  } catch (error) {
    if (client) {
      await client.query("ROLLBACK").catch(() => {});
      client.release();
    }
    console.error("deleteStudent error:", error);
    res.status(500).json({ error: "Delete failed" });
  }
};

export const getStudentPhoto = async (req, res) => {
  try {
    const { student_id } = req.params;
    const result = await db.query(
      "SELECT photo_base64 FROM students WHERE student_id = $1",
      [student_id.toUpperCase()]
    );
    const base64 = result.rows[0]?.photo_base64;
    if (!base64) {
      return res.status(404).json({ error: "Photo not found" });
    }

    const buf = Buffer.from(base64, "base64");
    res.setHeader("Content-Type", "image/jpeg");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.send(buf);
  } catch (error) {
    console.error("getStudentPhoto error:", error);
    res.status(500).json({ error: "Failed to load photo" });
  }
};
