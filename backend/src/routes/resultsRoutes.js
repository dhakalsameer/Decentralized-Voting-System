import express from "express";
import { db } from "../db.js";
import { electionContractV3, getContractAt } from "../blockchain/electionContract.js";
import { config } from "../config/env.js";
import { verifyAdmin } from "../middleware/admin.js";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    const result = await db.query(
      "SELECT * FROM candidates ORDER BY vote_count DESC"
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/stats", async (req, res) => {
  try {
    const [voterResult, candidateResult] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS total FROM students WHERE eligible_to_vote = true"),
      db.query("SELECT COUNT(*)::int AS total FROM candidates"),
    ]);

    const totalVoters = voterResult.rows[0].total;
    const candidateCount = candidateResult.rows[0].total;

    let posResult;
    if (candidateCount > 0) {
      posResult = await db.query(
        "SELECT position, COUNT(*)::int AS candidates, SUM(vote_count)::int AS votes FROM candidates GROUP BY position ORDER BY position"
      );
    } else {
      posResult = { rows: [] };
    }

    let phase = 0;
    let registrationEnd = 0;
    let votingEnd = 0;
    let currentElectionId = 0;
    try {
      phase = Number(await electionContractV3.getPhase());
      registrationEnd = Number(await electionContractV3.registrationEnd());
      votingEnd = Number(await electionContractV3.votingEnd());
      currentElectionId = Number(await electionContractV3.currentElectionId());
    } catch {}

    let votesCast = 0;
    try {
      const voterAddrs = await db.query(
        "SELECT wallet_address FROM students WHERE eligible_to_vote = true AND wallet_address IS NOT NULL"
      );
      if (voterAddrs.rows.length > 0) {
        const results = await Promise.all(
          voterAddrs.rows.map(r => electionContractV3.hasVoted(r.wallet_address))
        );
        votesCast = results.filter(Boolean).length;
      }
    } catch {
      votesCast = 0;
    }

    const remaining = Math.max(0, totalVoters - votesCast);
    const turnout = totalVoters > 0 ? Number(((votesCast / totalVoters) * 100).toFixed(1)) : 0;

    res.json({ totalVoters, votesCast, remaining, turnout, candidateCount, phase, registrationEnd, votingEnd, positions: posResult.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/my-wins", async (req, res) => {
  try {
    const { wallet } = req.query;
    if (!wallet) return res.json({ wins: [] });

    const result = await db.query(
      `SELECT eh.election_number, eh.candidate_name, eh.candidate_position,
              eh.vote_count, eh.candidate_photo, eh.candidate_year, eh.candidate_gender
       FROM election_history eh
       LEFT JOIN students s ON LOWER(s.wallet_address) = LOWER($1)
       WHERE eh.election_number = (SELECT MAX(election_number) FROM election_history)
         AND eh.is_winner = true
         AND (LOWER(eh.wallet_address) = LOWER($1)
              OR (s.name IS NOT NULL AND LOWER(s.name) = LOWER(eh.candidate_name)))`,
      [wallet]
    );

    res.json({ wins: result.rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get("/history", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT election_number, candidate_name, candidate_position, candidate_year, candidate_gender, candidate_photo, vote_count, is_winner, wallet_address, snapshot_at
       FROM election_history
       ORDER BY election_number DESC, candidate_position, vote_count DESC`
    );

    const grouped = {};
    for (const row of result.rows) {
      const num = row.election_number;
      if (!grouped[num]) {
        grouped[num] = {
          election_number: num,
          snapshot_at: row.snapshot_at,
          candidates: [],
        };
      }
      grouped[num].candidates.push({
        name: row.candidate_name,
        position: row.candidate_position,
        vote_count: row.vote_count,
        year: row.candidate_year,
        gender: row.candidate_gender,
        photo: row.candidate_photo,
        is_winner: row.is_winner,
        wallet_address: row.wallet_address,
      });
    }

    res.json(Object.values(grouped).sort((a, b) => b.election_number - a.election_number));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post("/import-old-history", verifyAdmin, async (_req, res) => {
  if (!config.oldContractV3) {
    return res.status(400).json({ error: "OLD_CONTRACT_ADDRESS_V3 not configured" });
  }
  try {
    const oldContract = getContractAt(config.oldContractV3);
    const oldCount = Number(await oldContract.historyCount());
    if (oldCount === 0) {
      return res.json({ message: "Old contract has no history", imported: 0 });
    }
    let imported = 0;
    for (let i = 0; i < oldCount; i++) {
      const electionNum = 1 + i;
      const dup = await db.query(
        "SELECT COUNT(*)::int AS cnt FROM election_history WHERE election_number = $1", [electionNum]
      );
      if (dup.rows[0].cnt > 0) continue;
      const r = await oldContract.getElectionResult(i);
      const timestamp = Number(r.timestamp);
      const tryInsert = async (id, position) => {
        if (id === 0) return;
        const c = await oldContract.getCandidate(id);
        if (!c.exists) return;
        await db.query(
          `INSERT INTO election_history (election_number, candidate_name, candidate_position, vote_count, candidate_year, candidate_gender, candidate_photo, snapshot_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8))`,
          [electionNum, c.name, position, Number(c.voteCount), String(c.year), c.isFemale ? "female" : "male", c.imageCID || null, timestamp]
        );
        imported++;
      };
      await tryInsert(Number(r.presidentWinnerId), "President");
      await tryInsert(Number(r.secretaryWinnerId), "Secretary");
      for (const gid of r.generalMemberWinnerIds.map(Number)) {
        if (gid === 0) continue;
        await tryInsert(gid, "General Member");
      }
    }
    res.json({ message: `Imported ${imported} winners from old contract`, imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
