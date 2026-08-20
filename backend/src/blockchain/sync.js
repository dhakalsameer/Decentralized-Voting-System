import { ethers } from "ethers";
import { electionContractV3, getContractAt } from "./electionContract.js";
import { config } from "../config/env.js";
import { db } from "../db.js";
import { addEvent, seedHistoricalEvents } from "../services/eventStore.js";
import { rebuildMerkleTrees } from "../controllers/voterController.js";
import { sendWinnerCongratulation, sendPhaseChangeNotification } from "../services/emailService.js";

const POLL_MS = 10000;
const MAX_BLOCK_RANGE = 10;
const processedKeys = new Set();
let lastProcessedBlock = 0;

async function withRetry(fn, retries = 3) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= retries) throw err;
      const delay = Math.min(1000 * 2 ** attempt, 8000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

export function startBlockchainSync(io) {
  console.log("🔄 Blockchain sync engine running (Poll-based)...");

  let prevVotes = {};
  let prevPhase = null;
  let prevElectionId = 0;
  let prevCandidateCount = 0;
  let minCandidateId = 1; // Only process candidates with ID >= this (set after new election starts)
  let snapshotInProgress = false;
  let lastPolledPhase = null;
  let lastSnapshotElectionNum = null;

  async function emitEvent(event) {
    try {
      await addEvent({ ...event, electionId: prevElectionId });
    } catch (err) {
      console.error("Failed to persist event:", err.message);
    }
    if (io) io.emit("blockchainEvent", event);
  }

  async function queryLogsBatched(filter, fromBlock, toBlock, retries = 2) {
    const allLogs = [];
    const step = MAX_BLOCK_RANGE;
    for (let start = fromBlock; start <= toBlock; start += step) {
      const end = Math.min(start + step - 1, toBlock);
      let lastErr;
      for (let attempt = 0; attempt <= retries; attempt++) {
        try {
          const logs = await electionContractV3.queryFilter(filter, start, end);
          allLogs.push(...logs);
          lastErr = null;
          break;
        } catch (err) {
          lastErr = err;
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          }
        }
      }
      if (lastErr) console.error(`  queryFilter [${start}, ${end}] failed after ${retries} retries: ${lastErr.message}`);
    }
    return allLogs;
  }

  async function fetchAndEmitOnChainEvents() {
    const provider = electionContractV3.runner?.provider;
    if (!provider) return;

    try {
      const currentBlock = await provider.getBlockNumber();
      const fromBlock = lastProcessedBlock > 0 ? lastProcessedBlock : 0;
      if (currentBlock <= fromBlock) return;

      // CandidateRegistered — includes candidate wallet address
      const candLogs = await queryLogsBatched(
        electionContractV3.filters.CandidateRegistered(),
        fromBlock,
        currentBlock
      );
      for (const log of candLogs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        await emitEvent({
          eventName: "CandidateRegistered",
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          fromAddress: log.args.candidate,
          args: {
            id: Number(log.args.id),
            name: log.args.name,
            position: Number(log.args.position),
            candidate: log.args.candidate,
            imageCID: log.args.imageCID || "",
          },
        });

        // Upsert candidate record from chain data (skip if from previous election)
        const candId = Number(log.args.id);
        if (candId < minCandidateId) continue;
        const cand = await electionContractV3.getCandidate(candId);
        if (cand.exists) {
          const id = Number(cand.id);
          const position = positionToString(cand.position);
          // Prefer the student's DB-backed photo reference (db:student:...) when
          // available so photos are served from the database, not flaky IPFS
          // gateways. Falls back to the on-chain imageCID for legacy candidates.
          const studentRef = await db.query(
            `SELECT image_cid FROM students
             WHERE LOWER(wallet_address) = LOWER($1)
               AND photo_base64 IS NOT NULL
             LIMIT 1`,
            [log.args.candidate]
          );
          const dbImageCid = studentRef.rows[0]?.image_cid || null;
          await db.query(
            `INSERT INTO candidates (blockchain_id, name, position, vote_count, year, gender, image_cid, status, wallet_address)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', $8)
             ON CONFLICT (blockchain_id) WHERE blockchain_id IS NOT NULL
             DO UPDATE SET name = $2, position = $3, vote_count = $4, wallet_address = $8,
                           year = $5, gender = $6, image_cid = $7, status = 'approved'`,
            [
              id, cand.name, position, Number(cand.voteCount),
              String(cand.year), cand.isFemale ? "female" : "male",
              dbImageCid || cand.imageCID || null, log.args.candidate,
            ]
          );
          prevVotes[id] = Number(cand.voteCount);
        }
      }

      // VoteCast — includes voter wallet address
      const voteLogs = await queryLogsBatched(
        electionContractV3.filters.VoteCast(),
        fromBlock,
        currentBlock
      );
      for (const log of voteLogs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        await emitEvent({
          eventName: "VoteCast",
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          fromAddress: log.args.voter,
          args: {
            voter: log.args.voter,
            candidateId: Number(log.args.candidateId),
          },
        });

        const cid = Number(log.args.candidateId);
        try {
          await db.query(
            `UPDATE candidates SET vote_count = vote_count + 1 WHERE blockchain_id = $1`,
            [cid]
          );
        } catch { /* might not exist yet */ }
        prevVotes[cid] = (prevVotes[cid] || 0) + 1;
      }

      // PhaseChanged — no address arg, get from tx receipt
      const phaseLogs = await queryLogsBatched(
        electionContractV3.filters.PhaseChanged(),
        fromBlock,
        currentBlock
      );
      for (const log of phaseLogs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        let fromAddr = null;
        try {
          const receipt = await provider.getTransactionReceipt(log.transactionHash);
          fromAddr = receipt?.from || null;
        } catch { /* ignore */ }

        await emitEvent({
          eventName: "PhaseChanged",
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          fromAddress: fromAddr,
          args: { newPhase: Number(log.args.newPhase) },
        });
      }

      // NewElectionStarted — no address arg
      const electionLogs = await queryLogsBatched(
        electionContractV3.filters.NewElectionStarted(),
        fromBlock,
        currentBlock
      );
      for (const log of electionLogs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        let fromAddr = null;
        try {
          const receipt = await provider.getTransactionReceipt(log.transactionHash);
          fromAddr = receipt?.from || null;
        } catch { /* ignore */ }

        const eid = Number(log.args.electionId);
        const prevElectionNum = eid > 1 ? eid - 1 : eid;
        if (lastSnapshotElectionNum !== prevElectionNum) {
          lastSnapshotElectionNum = prevElectionNum;
          snapshotInProgress = true;
          await snapshotResults(prevElectionNum);
          const totalCandidates = Number(await electionContractV3.candidateCount());
          await db.query("DELETE FROM candidates");
          minCandidateId = totalCandidates + 1;
          snapshotInProgress = false;
          prevElectionId = eid;
          await emitEvent({
            eventName: "NewElectionStarted",
            txHash: log.transactionHash,
            blockNumber: log.blockNumber,
            logIndex: log.index,
            fromAddress: fromAddr,
            args: { electionId: eid },
          });
        } else {
          // checkPhase already handled the snapshot; just sync election_id
          prevElectionId = eid;
        }
      }

      // MerkleRootUpdated — no address arg
      const merkleLogs = await queryLogsBatched(
        electionContractV3.filters.MerkleRootUpdated(),
        fromBlock,
        currentBlock
      );
      for (const log of merkleLogs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        let fromAddr = null;
        try {
          const receipt = await provider.getTransactionReceipt(log.transactionHash);
          fromAddr = receipt?.from || null;
        } catch { /* ignore */ }

        await emitEvent({
          eventName: "MerkleRootUpdated",
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          fromAddress: fromAddr,
          args: { newRoot: log.args.newRoot },
        });
      }

      // IdentityMerkleRootUpdated
      const identityLogs = await queryLogsBatched(
        electionContractV3.filters.IdentityMerkleRootUpdated(),
        fromBlock,
        currentBlock
      );
      for (const log of identityLogs) {
        const key = `${log.transactionHash}-${log.index}`;
        if (processedKeys.has(key)) continue;
        processedKeys.add(key);

        let fromAddr = null;
        try {
          const receipt = await provider.getTransactionReceipt(log.transactionHash);
          fromAddr = receipt?.from || null;
        } catch { /* ignore */ }

        await emitEvent({
          eventName: "IdentityMerkleRootUpdated",
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
          logIndex: log.index,
          fromAddress: fromAddr,
          args: { newRoot: log.args.newRoot },
        });
      }

      lastProcessedBlock = currentBlock + 1;
    } catch (err) {
      console.error("queryFilter failed, falling back to polling detection:", err.message);
    }
  }

  async function broadcastResults() {
    if (!io) return;
    try {
      const result = await db.query(
        "SELECT blockchain_id as id, name, position, vote_count FROM candidates ORDER BY vote_count DESC"
      );
      io.emit("voteUpdate", result.rows);
    } catch (err) {
      console.error("Broadcast results error:", err.message);
    }
  }

  function positionToString(pos) {
    if (Number(pos) === 0) return "President";
    if (Number(pos) === 1) return "Secretary";
    return "General Member";
  }

  async function upsertCandidate(cand) {
    const id = Number(cand.id);
    const position = positionToString(cand.position);
    await db.query(
      `INSERT INTO candidates (blockchain_id, name, position, vote_count, year, gender, image_cid, status, wallet_address)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'approved', NULL)
       ON CONFLICT (blockchain_id) WHERE blockchain_id IS NOT NULL
       DO UPDATE SET vote_count = $4, name = $2, position = $3,
                     year = $5, gender = $6, image_cid = $7, status = 'approved'`,
      [
        id,
        cand.name,
        position,
        Number(cand.voteCount),
        String(cand.year),
        cand.isFemale ? "female" : "male",
        cand.imageCID || null,
      ]
    );
    return id;
  }

  async function snapshotResults(electionNum) {
    try {
      const existing = await db.query(
        "SELECT COUNT(*)::int AS cnt FROM election_history WHERE election_number = $1",
        [electionNum]
      );
      if (existing.rows[0].cnt > 0) {
        console.log(`   → Election #${electionNum} already has history (${existing.rows[0].cnt} rows), skipping snapshot`);
        return;
      }

      // Read winners from contract first, preserving their known positions
      const winnerPositions = new Map(); // blockchain_id -> known position string
      let contractElectionResult = null;
      try {
        contractElectionResult = await electionContractV3.getElectionResult(electionNum - 1);
        if (contractElectionResult) {
          const pid = Number(contractElectionResult.presidentWinnerId);
          if (pid !== 0) winnerPositions.set(pid, "President");
          const sid = Number(contractElectionResult.secretaryWinnerId);
          if (sid !== 0) winnerPositions.set(sid, "Secretary");
          for (const gid of contractElectionResult.generalMemberWinnerIds.map(Number)) {
            if (gid !== 0 && !winnerPositions.has(gid)) winnerPositions.set(gid, "General Member");
          }
        }
      } catch {
        // Contract read may fail (no history yet, wrong chain, etc.)
      }

      // Insert candidates from DB
      const snapRes = await db.query(
        `SELECT name, position, vote_count, year, gender, image_cid, blockchain_id, wallet_address
         FROM candidates WHERE status IS NULL OR status = 'approved' ORDER BY position, vote_count DESC`
      );

      const insertedBlockchainIds = new Set();
      for (const row of snapRes.rows) {
        const isWinner = row.blockchain_id != null && winnerPositions.has(Number(row.blockchain_id));
        if (row.blockchain_id != null) insertedBlockchainIds.add(Number(row.blockchain_id));
        await db.query(
          `INSERT INTO election_history (election_number, candidate_name, candidate_position, vote_count, candidate_year, candidate_gender, candidate_photo, blockchain_id, is_winner, wallet_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
           ON CONFLICT (election_number, blockchain_id) WHERE blockchain_id IS NOT NULL DO NOTHING`,
          [electionNum, row.name, row.position, row.vote_count, row.year, row.gender, row.image_cid, row.blockchain_id, isWinner, row.wallet_address]
        );
      }

      // Insert any winners from the contract that were missing from the DB
      // Use the known position from the contract result, NOT getCandidate().position
      // (candidates mapping is overwritten by later elections)
      let missingIds = [];
      for (const [id, knownPosition] of winnerPositions) {
        if (insertedBlockchainIds.has(id)) continue;
        try {
          const c = await electionContractV3.getHistoricalCandidate(electionNum, id);
          if (!c.exists) continue;
          missingIds.push(id);
          await db.query(
            `INSERT INTO election_history (election_number, candidate_name, candidate_position, vote_count, candidate_year, candidate_gender, candidate_photo, blockchain_id, is_winner)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
             ON CONFLICT (election_number, blockchain_id) WHERE blockchain_id IS NOT NULL DO NOTHING`,
            [electionNum, c.name, knownPosition, Number(c.voteCount), String(c.year), c.isFemale ? "female" : "male", c.imageCID || null, Number(c.id)]
          );
        } catch {
          // skip if contract read fails
        }
      }

      const total = snapRes.rows.length + missingIds.length;
      console.log(`   → Snapshot saved for election #${electionNum} (${total} candidates, ${winnerPositions.size} winners, ${missingIds.length} from contract)`);

      await sendWinnerNotifications(electionNum);
    } catch (err) {
      console.error("Snapshot error:", err.message);
    }
  }

  async function sendWinnerNotifications(electionNum) {
    try {
      const result = await db.query(
        `SELECT s.email, s.name AS student_name, eh.candidate_name, eh.candidate_position, eh.vote_count
         FROM election_history eh
         JOIN students s ON (
           (eh.wallet_address IS NOT NULL AND LOWER(s.wallet_address) = LOWER(eh.wallet_address))
           OR
           (eh.wallet_address IS NULL AND LOWER(s.name) = LOWER(eh.candidate_name))
         )
         WHERE eh.election_number = $1 AND eh.is_winner = true AND s.email IS NOT NULL`,
        [electionNum]
      );

      if (result.rows.length === 0) {
        console.log(`   → No winner emails to send for election #${electionNum}`);
        return;
      }

      const promises = result.rows.map(row =>
        sendWinnerCongratulation({
          email: row.email,
          name: row.student_name,
          position: row.candidate_position,
          voteCount: row.vote_count,
          electionNumber: electionNum,
        }).catch(err => {
          console.error(`   → Failed to send winner email to ${row.email}: ${err.message}`);
        })
      );

      await Promise.all(promises);
      console.log(`   → Winner notifications sent for election #${electionNum} (${result.rows.length} emails)`);
    } catch (err) {
      console.error("   → Winner notification error:", err.message);
    }
  }

  async function backfillElectionHistory() {
    try {
      const contractCount = Number(await electionContractV3.historyCount());
      if (contractCount === 0) return;

      for (let i = 0; i < contractCount; i++) {
        const electionNum = i + 1;

        const r = await electionContractV3.getElectionResult(i);
        const timestamp = Number(r.timestamp);

        // Get existing blockchain_ids AND names for this election
        const existing = await db.query(
          "SELECT blockchain_id, candidate_name, candidate_position FROM election_history WHERE election_number = $1",
          [electionNum]
        );
        const existingBcIds = new Set(existing.rows.map((row) => row.blockchain_id != null ? Number(row.blockchain_id) : null).filter((id) => id !== null));
        const existingNameKeys = new Set(
          existing.rows.map((row) => `${row.candidate_name}|${row.candidate_position}`)
        );

        let updated = 0;

        const markWinner = async (id, knownPosition) => {
          if (id === 0) return;
          const c = await electionContractV3.getHistoricalCandidate(electionNum, id);
          if (!c.exists) return;
          const nameKey = `${c.name}|${knownPosition}`;

          // Already exists with a matching blockchain_id → just update is_winner
          if (existingBcIds.has(Number(id))) {
            await db.query(
              `UPDATE election_history SET is_winner = true
               WHERE election_number = $1 AND blockchain_id = $2`,
              [electionNum, Number(id)]
            );
            updated++;
            return;
          }

          // Already exists by name+position but different blockchain_id → update both
          if (existingNameKeys.has(nameKey)) {
            await db.query(
              `UPDATE election_history SET is_winner = true, blockchain_id = $1
               WHERE election_number = $2 AND candidate_name = $3 AND candidate_position = $4`,
              [Number(id), electionNum, c.name, knownPosition]
            );
            existingBcIds.add(Number(id));
            existingNameKeys.add(nameKey);
            updated++;
            return;
          }

          // Brand new entry
          await db.query(
            `INSERT INTO election_history (election_number, candidate_name, candidate_position, vote_count, candidate_year, candidate_gender, candidate_photo, snapshot_at, blockchain_id, is_winner)
             VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), $9, true)
             ON CONFLICT (election_number, blockchain_id) WHERE blockchain_id IS NOT NULL DO NOTHING`,
            [electionNum, c.name, knownPosition, Number(c.voteCount), String(c.year), c.isFemale ? "female" : "male", c.imageCID || null, timestamp, Number(c.id)]
          );
          existingBcIds.add(Number(c.id));
          existingNameKeys.add(nameKey);
          updated++;
        };

        await markWinner(Number(r.presidentWinnerId), "President");
        await markWinner(Number(r.secretaryWinnerId), "Secretary");

        for (const gid of r.generalMemberWinnerIds.map(Number)) {
          if (gid === 0) continue;
          await markWinner(gid, "General Member");
        }

        if (updated > 0) {
          console.log(`   → Backfilled ${updated} winner(s) for election #${electionNum}`);
        }
      }
    } catch (err) {
      console.error("Backfill error:", err.message);
    }
  }

  async function checkPhase() {
    try {
      await withRetry(async () => {
        const phase = Number(await electionContractV3.getPhase());
        const eid = Number(await electionContractV3.currentElectionId());

        const newElectionDetected =
          (prevPhase !== null && prevPhase === 3 && phase === 0) ||
          (prevElectionId > 0 && eid > prevElectionId);

        if (newElectionDetected) {
          const prevElectionNum = eid - 1;
          if (lastSnapshotElectionNum !== prevElectionNum) {
            lastSnapshotElectionNum = prevElectionNum;
            console.log(`🏁 New election detected (ID: ${eid}), snapshotting election #${prevElectionNum}`);
            snapshotInProgress = true;
            await snapshotResults(prevElectionNum);
            const totalCandidates = Number(await electionContractV3.candidateCount());
            await db.query("DELETE FROM candidates");
            minCandidateId = totalCandidates + 1;
            prevVotes = {};
            prevCandidateCount = 0;
            snapshotInProgress = false;
            prevElectionId = eid;
            await emitEvent({
              eventName: "NewElectionStarted",
              txHash: null,
              blockNumber: null,
              fromAddress: null,
              args: { electionId: eid },
            });
          }
        }
        if (lastPolledPhase !== phase) {
          if (phase === 3 && prevElectionId > 0 && !snapshotInProgress) {
            snapshotInProgress = true;
            await snapshotResults(prevElectionId);
            snapshotInProgress = false;
          }
          if (phase === 2) {
            try {
              console.log("🌳 Auto-rebuilding Merkle trees for voting phase");
              await rebuildMerkleTrees();
            } catch (err) {
              console.error("Auto-rebuild Merkle trees failed:", err.message);
            }
          }

          try {
            const phaseResult = await db.query(
              `SELECT s.email, s.name FROM students s WHERE s.email IS NOT NULL`
            );
            if (phaseResult.rows.length > 0) {
              const currentElection = await electionContractV3.historyCount();
              const promises = phaseResult.rows.map(row =>
                sendPhaseChangeNotification({
                  email: row.email,
                  name: row.name,
                  newPhase: phase,
                  electionNumber: Number(currentElection),
                }).catch(err => console.error(`   → Phase email failed for ${row.email}: ${err.message}`))
              );
              await Promise.all(promises);
              console.log(`   → Phase ${phase} notifications sent to ${phaseResult.rows.length} students`);
            }
          } catch (err) {
            console.error("   → Phase notification error:", err.message);
          }

          await emitEvent({
            eventName: "PhaseChanged",
            txHash: null,
            blockNumber: null,
            fromAddress: null,
            args: { newPhase: phase },
          });
          lastPolledPhase = phase;
        }
        prevPhase = phase;
        prevElectionId = eid;
      });
    } catch (err) {
      console.error("Phase check error:", err.message);
    }
  }

  async function syncAll() {
    try {
      await withRetry(async () => {
        if (snapshotInProgress) return;

        await fetchAndEmitOnChainEvents();

        const provider = electionContractV3.runner?.provider;
        if (!provider) return;

        const cc = Number(await electionContractV3.candidateCount());
        let anyChange = false;

        for (let i = minCandidateId; i <= cc; i++) {
          const cand = await electionContractV3.getCandidate(i);
          if (!cand.exists) continue;

        const id = Number(cand.id);
        const onChainVotes = Number(cand.voteCount);
        const isNew = !(id in prevVotes);
        const prev = prevVotes[id] || 0;

        await upsertCandidate(cand);

        if (isNew) {
          console.log(`📝 New candidate detected: ${cand.name} (${positionToString(cand.position)})`);
          prevVotes[id] = onChainVotes;
        }

        if (onChainVotes !== prev) {
          anyChange = true;
          const diff = onChainVotes - prev;

          if (diff > 0) {
            console.log(`🗳️ ${cand.name} gained ${diff} vote(s) (now ${onChainVotes})`);
          }

          await db.query(
            `UPDATE candidates SET vote_count = $1 WHERE blockchain_id = $2`,
            [onChainVotes, id]
          );

          prevVotes[id] = onChainVotes;
        }
      }

      if (prevCandidateCount !== cc) {
        anyChange = true;
        prevCandidateCount = cc;
      }

      if (anyChange) {
        broadcastResults();
      }
      });
    } catch (err) {
      console.error("Sync error:", err.message);
    }
  }

  if (
    electionContractV3.target &&
    electionContractV3.target !== "0x0000000000000000000000000000000000000000"
  ) {
    (async () => {
      try {
        await withRetry(async () => {
          prevPhase = Number(await electionContractV3.getPhase());
          lastPolledPhase = prevPhase;
          prevElectionId = Number(await electionContractV3.currentElectionId());
          prevCandidateCount = Number(await electionContractV3.candidateCount());

          const provider = electionContractV3.runner?.provider;
          if (provider) {
            lastProcessedBlock = await provider.getBlockNumber();
          }
        });

        if (prevPhase === 0 && prevCandidateCount === 0) {
          // First election ever — nothing to restore
          minCandidateId = 1;
        } else {
          const existingCandidates = await db.query("SELECT COUNT(*)::int AS cnt FROM candidates");
          const hasCandidates = existingCandidates.rows[0].cnt > 0;

          if (hasCandidates && prevPhase === 0) {
            if (prevCandidateCount === 0) {
              // Stale DB candidates with no on-chain record — just purge them
              console.log(`🧹 Startup: purging ${existingCandidates.rows[0].cnt} stale leftover candidates (contract has none)`);
              await db.query("DELETE FROM candidates");
              minCandidateId = 1;
            } else {
              // Leftover candidates from a previous run — snapshot them
              const maxNum = await db.query("SELECT COALESCE(MAX(election_number), 0) AS max FROM election_history");
              const prevElectionNum = maxNum.rows[0].max + 1;
              console.log(`📦 Startup: snapshotted ${existingCandidates.rows[0].cnt} leftover candidates to election #${prevElectionNum}`);
              await snapshotResults(prevElectionNum);
              lastSnapshotElectionNum = prevElectionNum;
              await db.query("DELETE FROM candidates");
              minCandidateId = prevCandidateCount + 1;
            }
          } else if (!hasCandidates && prevPhase === 0) {
            // New election already started (candidates table was cleared)
            minCandidateId = prevCandidateCount + 1;
          }

          // Stale event cleanup: delete VoteCast events from old contracts
          const hc = Number(await electionContractV3.historyCount());
          const validIds = [0, prevElectionId];
          for (let i = 1; i <= hc; i++) validIds.push(i);
          const placeholders = validIds.map((_, j) => `$${j + 1}`).join(", ");
          const result = await db.query(
            `DELETE FROM events WHERE event_name = 'VoteCast' AND election_id > 0 AND election_id NOT IN (${placeholders})`,
            validIds
          );
          if (result.rowCount > 0) {
            console.log(`🧹 Cleaned ${result.rowCount} stale VoteCast events from old contracts`);
          }
        }

        for (let i = 1; i <= prevCandidateCount; i++) {
          const cand = await electionContractV3.getCandidate(i);
          if (!cand.exists) continue;
          const id = Number(cand.id);
          const votes = Number(cand.voteCount);
          await upsertCandidate(cand);
          prevVotes[id] = votes;
        }

        const total = Object.values(prevVotes).reduce((a, b) => a + b, 0);
        console.log(`✅ Initial sync — ${prevCandidateCount} candidates, ${total} votes, phase ${prevPhase}`);
        broadcastResults();
        await seedHistoricalEvents();
        await backfillElectionHistory();

        // Notify students of current phase (catches phase changes that happened before this server started)
        // Skipped: handled by checkPhase() which detects real transitions. Startup sends would spam on every deploy.
      } catch (err) {
        console.error("Initial sync error:", err.message);
      }
    })();

    setInterval(syncAll, POLL_MS);
    setInterval(checkPhase, POLL_MS);
  }
}
