import bcrypt from "bcrypt";
import { ethers } from "ethers";
import { db } from "../db.js";
import { signToken } from "../config/env.js";
import { rebuildMerkleTrees } from "./voterController.js";
import { sendNewRegistrationAlert } from "../services/emailService.js";

const WALLET_MESSAGE = "Gandaki University Election Wallet Verification";

const VALID_YEARS = ["1st", "2nd", "3rd", "4th"];
const VALID_GENDERS = ["male", "female", "other"];

export const verifyCode = async (req, res) => {
  try {
    const student_id = req.body.student_id || req.body.studentId;
    const code = (req.body.code || "").replace(/-/g, "");

    if (!student_id || !code) {
      return res.status(400).json({ error: "student_id and code are required" });
    }

    const result = await db.query(
      "SELECT id FROM registration_codes WHERE student_id = $1 AND REPLACE(code, '-', '') = $2 AND used = false",
      [student_id, code]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ valid: false, error: "Invalid or already used registration code" });
    }

    return res.json({ valid: true });
  } catch (error) {
    console.error("verifyCode error:", error);
    return res.status(500).json({ error: "Code verification failed" });
  }
};

export const registerStudent = async (req, res) => {
  try {
    const student_id = req.body.student_id;
    const code = (req.body.code || "").replace(/-/g, "");
    const password = req.body.password;
    const wallet = req.body.wallet;
    const signature = req.body.signature;
    // name/year/gender are optional — admin may have pre-filled them.
    const name = req.body.name || null;
    const year = req.body.year || null;
    const gender = req.body.gender || null;

    if (!student_id || !code || !password) {
      return res.status(400).json({ error: "student_id, code and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // 1. Verify registration code exists and is unused
    const codeResult = await db.query(
      `SELECT rc.id FROM registration_codes rc
       WHERE rc.student_id = $1 AND REPLACE(rc.code, '-', '') = $2 AND rc.used = false
       LIMIT 1`,
      [student_id, code]
    );
    if (codeResult.rows.length === 0) {
      return res.status(403).json({ error: "Invalid or already used registration code" });
    }

    // 2. Verify wallet signature
    if (!wallet || !signature) {
      return res.status(400).json({ error: "wallet and signature are required" });
    }
    const recovered = ethers.verifyMessage(WALLET_MESSAGE, signature);
    if (recovered.toLowerCase() !== wallet.toLowerCase()) {
      return res.status(400).json({ error: "Invalid signature" });
    }

    // 3. Check if student already exists and is fully registered
    const existing = await db.query(
      "SELECT student_id, name, year, gender, registered FROM students WHERE student_id = $1",
      [student_id]
    );
    if (existing.rows.length > 0 && existing.rows[0].registered) {
      return res.status(409).json({ error: "Student ID already registered" });
    }

    // 3a. Ensure wallet is not already linked to a different student
    if (wallet) {
      const walletCheck = await db.query(
        `SELECT student_id FROM students
         WHERE LOWER(wallet_address) = LOWER($1) AND student_id != $2`,
        [wallet, student_id]
      );
      if (walletCheck.rows.length > 0) {
        return res.status(409).json({ error: "Wallet already linked to another student" });
      }
    }

    // Merge incoming values with admin-preset values (admin wins)
    const mergedName = name || existing.rows[0]?.name || null;
    if (!mergedName) {
      return res.status(400).json({ error: "name is required (not set by admin)" });
    }
    const mergedYear = year || existing.rows[0]?.year || null;
    const mergedGender = gender || existing.rows[0]?.gender || null;

    const password_hash = await bcrypt.hash(password, 10);

    // 4. Upsert student record — preserve admin-set name/year/gender
    const result = await db.query(
      `INSERT INTO students (student_id, name, password_hash, year, gender, wallet_address, wallet_verified, registered)
       VALUES ($1, $2, $3, $4, $5, $6, true, true)
       ON CONFLICT (student_id) DO UPDATE SET
         name = EXCLUDED.name,
         password_hash = EXCLUDED.password_hash,
         year = EXCLUDED.year,
         gender = EXCLUDED.gender,
         wallet_address = EXCLUDED.wallet_address,
         wallet_verified = true,
         registered = true,
         updated_at = NOW()
       RETURNING student_id, name, year, gender, image_cid,
                 wallet_address, wallet_verified, eligible_to_vote, registered`,
      [student_id, mergedName, password_hash, mergedYear, mergedGender, wallet]
    );

    // 5. Mark code as used
    await db.query(
      "UPDATE registration_codes SET used = true, used_at = NOW() WHERE student_id = $1 AND REPLACE(code, '-', '') = $2",
      [student_id, code]
    );

    const student = result.rows[0];
    const token = signToken({ student_id: student.student_id, name: student.name });

    sendNewRegistrationAlert({
      name: student.name,
      studentId: student.student_id,
      wallet: student.wallet_address,
    }).catch(() => {});

    return res.status(201).json({
      token,
      student: shape(student),
    });
  } catch (error) {
    console.error("registerStudent error:", error);
    return res.status(500).json({ error: "Registration failed" });
  }
};

export const loginStudent = async (req, res) => {
  try {
    const student_id = req.body.student_id || req.body.studentId;
    const password = req.body.password;

    if (!student_id || !password) {
      return res.status(400).json({ error: "student_id and password are required" });
    }

    const result = await db.query(
      `SELECT student_id, name, password_hash, year, gender, image_cid,
              wallet_address, wallet_verified, eligible_to_vote, registered
       FROM students WHERE student_id = $1`,
      [student_id]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: "Invalid student ID or password" });
    }

    const student = result.rows[0];

    if (!student.registered) {
      return res.status(403).json({ error: "Account not fully registered. Complete registration first." });
    }

    if (!student.password_hash) {
      return res.status(401).json({ error: "Account exists but no password set. Contact admin to migrate." });
    }

    const valid = await bcrypt.compare(password, student.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Invalid student ID or password" });
    }

    const token = signToken({ student_id: student.student_id, name: student.name });

    return res.json({
      token,
      student: shape(student),
    });
  } catch (error) {
    console.error("loginStudent error:", error);
    return res.status(500).json({ error: "Login failed" });
  }
};

export const getProfile = async (req, res) => {
  try {
    const { student_id } = req.user;

    const result = await db.query(
      `SELECT student_id, name, year, gender, image_cid,
              wallet_address, wallet_verified, eligible_to_vote, registered
       FROM students WHERE student_id = $1`,
      [student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    return res.json(shape(result.rows[0]));
  } catch (error) {
    console.error("getProfile error:", error);
    return res.status(500).json({ error: "Failed to fetch profile" });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { student_id } = req.user;
    const { name } = req.body;

    // Students can only update their name, not year or gender
    const result = await db.query(
      `UPDATE students
       SET name = COALESCE($1, name),
           updated_at = NOW()
       WHERE student_id = $2
       RETURNING student_id, name, year, gender, image_cid,
                 wallet_address, wallet_verified, eligible_to_vote, registered`,
      [name || null, student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }
    return res.json(shape(result.rows[0]));
  } catch (error) {
    console.error("updateProfile error:", error);
    return res.status(500).json({ error: "Failed to update profile" });
  }
};

/**
 * Admin: list all registered students, optionally filter by year.
 * Query: ?year=1st
 */
export const listStudents = async (req, res) => {
  try {
    const { year } = req.query;
    let sql = `SELECT student_id, name, year, gender, email, image_cid,
                      wallet_address, wallet_verified, eligible_to_vote, registered, created_at
               FROM students`;
    const params = [];

    if (year) {
      if (!VALID_YEARS.includes(year)) {
        return res.status(400).json({
          error: `year must be one of ${VALID_YEARS.join(", ")}`,
        });
      }
      sql += ` WHERE year = $1`;
      params.push(year);
    }

    sql += ` ORDER BY COALESCE(year, ''), student_id`;

    const result = await db.query(sql, params);
    return res.json({
      count: result.rows.length,
      students: result.rows.map(shape),
    });
  } catch (error) {
    console.error("listStudents error:", error);
    return res.status(500).json({ error: "Failed to list students" });
  }
};

/**
 * Admin: batch upsert students (update or insert).
 * Body: { students: [{ student_id, name?, year?, gender?, email? }] }
 * Upserts without generating registration codes.
 */
export const adminBatchUpsertStudents = async (req, res) => {
  try {
    const { students } = req.body;
    if (!Array.isArray(students) || students.length === 0) {
      return res.status(400).json({ error: "students must be a non-empty array" });
    }

    const processed = [];
    const errors = [];

    const identityFieldsChanged = [];

    for (const s of students) {
      const student_id = String(s.student_id || "").trim().toUpperCase();
      if (!student_id) {
        errors.push({ student_id: s.student_id, reason: "Missing student_id" });
        continue;
      }

      const year = s.year ? String(s.year).trim().toLowerCase() : null;
      const gender = s.gender ? String(s.gender).trim().toLowerCase() : null;

      if (year && !VALID_YEARS.includes(year)) {
        errors.push({ student_id, reason: `Invalid year "${year}"` });
        continue;
      }
      if (gender && !VALID_GENDERS.includes(gender)) {
        errors.push({ student_id, reason: `Invalid gender "${gender}"` });
        continue;
      }

      try {
        const name = s.name ? String(s.name).trim() : null;
        const email = s.email ? String(s.email).trim().toLowerCase() : null;

        const existing = await db.query(
          `SELECT name, year, gender, eligible_to_vote FROM students WHERE student_id = $1`,
          [student_id]
        );
        const wasEligible = existing.rows.length > 0 && existing.rows[0].eligible_to_vote;
        const oldName = existing.rows[0]?.name;
        const oldYear = existing.rows[0]?.year;
        const oldGender = existing.rows[0]?.gender;

        const result = await db.query(
          `INSERT INTO students (student_id, name, year, gender, email)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (student_id) DO UPDATE SET
             name = $2, year = $3, gender = $4, email = $5, updated_at = NOW()
           RETURNING student_id, name, year, gender, email, registered, eligible_to_vote`,
          [student_id, name, year, gender, email]
        );
        processed.push(shape(result.rows[0]));

        if (wasEligible) {
          const nameChanged = (name ?? null) !== (oldName ?? null);
          const yearChanged = (year ?? null) !== (oldYear ?? null);
          const genderChanged = (gender ?? null) !== (oldGender ?? null);
          if (nameChanged || yearChanged || genderChanged) {
            identityFieldsChanged.push(student_id);
          }
        }
      } catch (err) {
        errors.push({ student_id, reason: err.message });
      }
    }

    let merkleTxHash = null;
    if (identityFieldsChanged.length > 0) {
      try {
        merkleTxHash = await rebuildMerkleTrees();
        console.log(`Merkle trees rebuilt: ${identityFieldsChanged.length} whitelisted voter(s) had identity fields changed (${identityFieldsChanged.join(", ")})`);
      } catch (err) {
        console.error("Failed to rebuild Merkle trees after batch upsert:", err.message);
      }
    }

    return res.json({ processed, errors, count: processed.length, merkleTxHash });
  } catch (error) {
    console.error("adminBatchUpsertStudents error:", error);
    return res.status(500).json({ error: "Batch upsert failed" });
  }
};

/**
 * Admin: update a student's year/gender/name by student_id.
 * Body: { name?, year?, gender? }
 */
export const adminUpdateStudent = async (req, res) => {
  try {
    const student_id = req.params.id;
    const { name, year, gender } = req.body;

    if (year && !VALID_YEARS.includes(year)) {
      return res.status(400).json({
        error: `year must be one of ${VALID_YEARS.join(", ")}`,
      });
    }
    if (gender && !VALID_GENDERS.includes(gender)) {
      return res.status(400).json({
        error: `gender must be one of ${VALID_GENDERS.join(", ")}`,
      });
    }

    const result = await db.query(
      `UPDATE students
       SET name = COALESCE($1, name),
           year = COALESCE($2, year),
           gender = COALESCE($3, gender),
           updated_at = NOW()
       WHERE student_id = $4
       RETURNING student_id, name, year, gender, image_cid,
                 wallet_address, wallet_verified, eligible_to_vote, registered`,
      [name || null, year || null, gender || null, student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }
    return res.json(shape(result.rows[0]));
  } catch (error) {
    console.error("adminUpdateStudent error:", error);
    return res.status(500).json({ error: "Failed to update student" });
  }
};

export const forgotPassword = async (req, res) => {
  try {
    const { student_id, code, password } = req.body;
    if (!student_id || !code || !password) {
      return res.status(400).json({ error: "student_id, code, and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    // Allow using registration code regardless of `used` status
    const codeResult = await db.query(
      "SELECT id FROM registration_codes WHERE student_id = $1 AND REPLACE(code, '-', '') = $2",
      [student_id, code]
    );
    if (codeResult.rows.length === 0) {
      return res.status(403).json({ error: "Invalid registration code" });
    }

    const hashed = await bcrypt.hash(password, 10);
    await db.query(
      "UPDATE students SET password_hash = $1, updated_at = NOW() WHERE student_id = $2",
      [hashed, student_id]
    );

    return res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("forgotPassword error:", error);
    return res.status(500).json({ error: "Password reset failed" });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { student_id } = req.user;
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "currentPassword and newPassword are required" });
    }
    if (newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const result = await db.query(
      "SELECT password_hash FROM students WHERE student_id = $1",
      [student_id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const valid = await bcrypt.compare(currentPassword, result.rows[0].password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }

    const hashed = await bcrypt.hash(newPassword, 10);
    await db.query(
      "UPDATE students SET password_hash = $1, updated_at = NOW() WHERE student_id = $2",
      [hashed, student_id]
    );

    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("changePassword error:", error);
    return res.status(500).json({ error: "Failed to change password" });
  }
};

function shape(row) {
  return {
    student_id: row.student_id,
    name: row.name,
    year: row.year,
    gender: row.gender,
    email: row.email,
    image_cid: row.image_cid,
    wallet_address: row.wallet_address,
    walletLinked: Boolean(row.wallet_address),
    walletVerified: Boolean(row.wallet_verified),
    eligibleToVote: Boolean(row.eligible_to_vote),
    registered: Boolean(row.registered),
    created_at: row.created_at,
  };
}
