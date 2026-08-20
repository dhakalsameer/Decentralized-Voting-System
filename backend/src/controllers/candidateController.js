import { db } from "../db.js";
import { rebuildMerkleTrees } from "./voterController.js";
import { electionContractV3 } from "../blockchain/electionContract.js";

export const getCandidates = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT * FROM candidates WHERE status = 'approved' OR status IS NULL ORDER BY position, created_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("getCandidates error:", error);
    return res.status(500).json({ error: "Failed to load candidates" });
  }
};

export const getPendingCandidates = async (req, res) => {
  try {
    const result = await db.query(
      `SELECT c.*, s.name AS student_name, s.year AS student_year, s.gender AS student_gender
       FROM candidates c
       JOIN students s ON s.student_id = c.applied_by
       WHERE c.status = 'pending'
       ORDER BY c.applied_at DESC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("getPendingCandidates error:", error);
    res.status(500).json({ error: "Failed to load pending candidates" });
  }
};

export const applyAsCandidate = async (req, res) => {
  try {
    const { student_id, name, position, image_cid } = req.body;

    if (!student_id || !name || !position) {
      return res.status(400).json({ error: "student_id, name, and position are required" });
    }

    const validPositions = [0, 1, 2];
    if (!validPositions.includes(Number(position))) {
      return res.status(400).json({ error: "position must be 0 (President), 1 (Secretary), or 2 (General Member)" });
    }

    const student = await db.query(
      `SELECT student_id, year, gender FROM students WHERE student_id = $1`,
      [student_id.toUpperCase()]
    );
    if (student.rows.length === 0) {
      return res.status(404).json({ error: "Student not found. Please register first." });
    }

    const existing = await db.query(
      `SELECT id FROM candidates WHERE applied_by = $1 AND status = 'pending'`,
      [student_id.toUpperCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "You already have a pending application" });
    }

    const result = await db.query(
      `INSERT INTO candidates (name, position, image_cid, status, applied_by, applied_at, year, gender)
       VALUES ($1, $2, $3, 'pending', $4, NOW(), $5, $6)
       RETURNING *`,
      [
        name, Number(position), image_cid || null,
        student_id.toUpperCase(),
        student.rows[0].year, student.rows[0].gender,
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("applyAsCandidate error:", error);
    res.status(500).json({ error: "Failed to submit application" });
  }
};

export const approveCandidate = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `UPDATE candidates SET status = 'approved', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pending candidate not found" });
    }

    const candidate = result.rows[0];

    const phase = Number(await electionContractV3.getPhase());
    if (phase >= 2) {
      return res.status(400).json({
        error: "Cannot approve candidate during Voting or later. Merkle roots are locked on-chain.",
      });
    }

    await db.query(
      `UPDATE students SET eligible_to_vote = true WHERE student_id = $1`,
      [candidate.applied_by]
    );

    await rebuildMerkleTrees();

    res.json(result.rows[0]);
  } catch (error) {
    console.error("approveCandidate error:", error);
    res.status(500).json({ error: "Failed to approve candidate" });
  }
};

export const rejectCandidate = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await db.query(
      `UPDATE candidates SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING *`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Pending candidate not found" });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error("rejectCandidate error:", error);
    res.status(500).json({ error: "Failed to reject candidate" });
  }
};

export const getCandidateByWallet = async (req, res) => {
  try {
    const { wallet } = req.params;
    if (!wallet) {
      return res.status(400).json({ error: "Wallet address is required" });
    }
    let result = await db.query(
      `SELECT blockchain_id, name, position, wallet_address
       FROM candidates
       WHERE LOWER(wallet_address) = LOWER($1)
       LIMIT 1`,
      [wallet]
    );
    if (result.rows.length === 0) {
      // Fall back to election_history (candidates table gets deleted after election ends)
      result = await db.query(
        `SELECT blockchain_id, candidate_name AS name, candidate_position AS position, wallet_address
         FROM election_history
         WHERE LOWER(wallet_address) = LOWER($1)
           AND is_winner = true
         ORDER BY election_number DESC
         LIMIT 1`,
        [wallet]
      );
    }
    if (result.rows.length === 0) {
      // 3rd fallback: match via students table (backfill rows have no wallet_address)
      result = await db.query(
        `SELECT eh.blockchain_id, eh.candidate_name AS name, eh.candidate_position AS position, s.wallet_address
         FROM election_history eh
         JOIN students s ON LOWER(s.name) = LOWER(eh.candidate_name) AND s.wallet_address IS NOT NULL
         WHERE LOWER(s.wallet_address) = LOWER($1)
           AND eh.is_winner = true
         ORDER BY eh.election_number DESC
         LIMIT 1`,
        [wallet]
      );
    }
    if (result.rows.length === 0) {
      return res.json(null);
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("getCandidateByWallet error:", error);
    res.status(500).json({ error: "Failed to fetch candidate" });
  }
};

export const getMyCandidateStatus = async (req, res) => {
  try {
    const studentId = req.user?.student_id;
    if (!studentId) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const result = await db.query(
      `SELECT id, name, position, status, applied_at, image_cid
       FROM candidates WHERE applied_by = $1
       ORDER BY applied_at DESC LIMIT 1`,
      [studentId]
    );

    res.json(result.rows[0] || { status: null });
  } catch (error) {
    console.error("getMyCandidateStatus error:", error);
    res.status(500).json({ error: "Failed to fetch status" });
  }
};

export const getCandidatePhoto = async (req, res) => {
  try {
    const { ref } = req.params;
    const result = await db.query(
      `SELECT COALESCE(photo_base64, (SELECT s.photo_base64 FROM students s WHERE s.student_id = candidates.applied_by)) AS photo_base64
       FROM candidates
       WHERE id::text = $1 OR applied_by = $1 OR LOWER(wallet_address) = LOWER($1)
       LIMIT 1`,
      [ref]
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
    console.error("getCandidatePhoto error:", error);
    res.status(500).json({ error: "Failed to load photo" });
  }
};
