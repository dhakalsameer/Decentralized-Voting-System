import { db } from "../db.js";
import { electionContractV3 } from "../blockchain/electionContract.js";
import {
  generateMerkleProof,
  generateMerkleRoot,
  generateIdentityMerkleRoot,
  generateIdentityMerkleProof,
} from "../services/merkleService.js";
import { emitEvent } from "../socket.js";
import { sendVoterVerifiedEmail } from "../services/emailService.js";
import { pinJSON } from "../services/ipfsService.js";

function parseYear(year) {
  if (year == null) return 0;
  const n = parseInt(year, 10);
  return Number.isFinite(n) ? n : 0;
}

const SNAPSHOT_ID = true;

async function loadEligibleRows() {
  const { rows } = await db.query(
    `SELECT wallet_address, name, year, gender FROM students WHERE eligible_to_vote = true AND wallet_address IS NOT NULL`
  );
  return rows;
}

function toWallets(rows) {
  return rows.map(r => r.wallet_address);
}

function toIdentities(rows) {
  return rows.map(r => ({
    address: r.wallet_address,
    name: r.name,
    year: parseYear(r.year),
    isFemale: r.gender?.toLowerCase() === "female",
  }));
}

/**
 * Returns the frozen voter data behind the last published Merkle roots,
 * or null when no snapshot exists yet (fresh deployment).
 */
export async function getMerkleSnapshot() {
  const { rows } = await db.query(
    `SELECT wallets, identities, snapshot_cid FROM merkle_snapshots WHERE id = $1`,
    [SNAPSHOT_ID]
  );
  if (rows.length === 0) return null;
  return {
    wallets: Array.isArray(rows[0].wallets) ? rows[0].wallets : [],
    identities: Array.isArray(rows[0].identities) ? rows[0].identities : [],
    snapshotCid: rows[0].snapshot_cid || null,
  };
}

async function saveMerkleSnapshot(wallets, identities, snapshotCid = null) {
  await db.query(
    `INSERT INTO merkle_snapshots (id, wallets, identities, snapshot_cid, updated_at)
     VALUES ($1, $2::jsonb, $3::jsonb, $4, NOW())
     ON CONFLICT (id) DO UPDATE
       SET wallets = $2::jsonb, identities = $3::jsonb, snapshot_cid = $4, updated_at = NOW()`,
    [SNAPSHOT_ID, JSON.stringify(wallets), JSON.stringify(identities), snapshotCid]
  );
}

/**
 * Publishes the whitelist dataset to IPFS (best-effort) and records the CID.
 * The dataset lets voters verify the on-chain root and generate proofs
 * client-side without trusting this backend. No-op when Pinata is not
 * configured — the /api/voters/snapshot endpoint always serves the dataset.
 */
async function publishSnapshotToIpfs(wallets, identities) {
  try {
    const cid = await pinJSON(
      { wallets, identities, publishedAt: new Date().toISOString() },
      "voter-merkle-snapshot.json"
    );
    if (cid) {
      await db.query(`UPDATE merkle_snapshots SET snapshot_cid = $1 WHERE id = $2`, [cid, SNAPSHOT_ID]);
      console.log("Merkle snapshot pinned to IPFS:", cid);
    }
    return cid;
  } catch (err) {
    console.error("Snapshot IPFS publish failed:", err.message);
    return null;
  }
}

export async function rebuildMerkleTrees() {
  const rows = await loadEligibleRows();
  const wallets = toWallets(rows);
  const identities = toIdentities(rows);
  const root = generateMerkleRoot(wallets);
  const identityRoot = generateIdentityMerkleRoot(identities);

  let chainVoterRoot = null;
  let chainIdentityRoot = null;
  try {
    [chainVoterRoot, chainIdentityRoot] = await Promise.all([
      electionContractV3.voterMerkleRoot(),
      electionContractV3.identityMerkleRoot(),
    ]);
  } catch (err) {
    console.error("Failed to read on-chain Merkle roots:", err.message);
  }

  // No-op detection: only publish when the recomputed roots actually differ
  // from what the contract holds. Unrelated edits (photos, profile fixes)
  // therefore never touch the chain and never invalidate outstanding proofs.
  const unchanged =
    chainVoterRoot !== null &&
    chainIdentityRoot !== null &&
    chainVoterRoot === root &&
    chainIdentityRoot === identityRoot;

  const phase = Number(await electionContractV3.getPhase());
  const rootsLocked = phase >= 2;

  if (!unchanged && !rootsLocked && chainVoterRoot !== null) {
    console.log("Updating Voter Merkle Root to:", root);
    const tx1 = await electionContractV3.setMerkleRoot(root);
    await tx1.wait();

    console.log("Updating Identity Merkle Root to:", identityRoot);
    const tx2 = await electionContractV3.setIdentityMerkleRoot(identityRoot);
    const receipt = await tx2.wait();

    // Atomically freeze the exact data that was published so future proofs
    // always verify against this root, and mirror it to IPFS when configured.
    await saveMerkleSnapshot(wallets, identities);
    await publishSnapshotToIpfs(wallets, identities);
    emitEvent("dataChanged", { type: "voters" });
    return receipt.hash;
  }

  if (unchanged) console.log("Merkle roots unchanged — skipping on-chain update");
  if (rootsLocked) console.log("Merkle roots locked — skipping on-chain update (phase >= 2)");

  if (unchanged) {
    // Live data matches the chain; make sure the snapshot reflects it so
    // proofs are served from stable data going forward.
    const snap = await getMerkleSnapshot().catch(() => null);
    if (!snap) {
      await saveMerkleSnapshot(wallets, identities).catch(err =>
        console.error("Failed to seed Merkle snapshot:", err.message)
      );
      await publishSnapshotToIpfs(wallets, identities).catch(() => {});
    }
  }
  // When locked and diverged, deliberately keep the existing snapshot:
  // proofs must continue to match the root that is actually on-chain.

  emitEvent("dataChanged", { type: "voters" });
  return null;
}

export const getMe = async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: "wallet query parameter is required" });
    }

    const result = await db.query(
      `SELECT student_id, name, wallet_address, wallet_verified, eligible_to_vote, image_cid
       FROM students
       WHERE LOWER(wallet_address) = LOWER($1)`,
      [wallet]
    );

    if (result.rows.length === 0) {
      return res.json({
        registered: false,
        walletLinked: false,
        verified: false,
        canVote: false,
      });
    }

    const student = result.rows[0];
    let hasVoted = false;
    let votingPhaseActive = false;

    try {
      hasVoted = await electionContractV3.hasVoted(wallet);
      const phase = Number(await electionContractV3.getPhase());
      const votingEnd = Number(await electionContractV3.votingEnd());
      const now = Math.floor(Date.now() / 1000);
      votingPhaseActive = phase === 2 && now < votingEnd;
    } catch (err) {
      console.error("On-chain voter status lookup failed:", err.message);
    }

    return res.json({
      student_id: student.student_id,
      name: student.name,
      image_cid: student.image_cid,
      registered: true,
      walletLinked: Boolean(student.wallet_verified),
      verified: Boolean(student.eligible_to_vote),
      canVote: Boolean(student.eligible_to_vote) && !hasVoted && votingPhaseActive,
      hasVoted,
    });
  } catch (error) {
    console.error("getMe error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const getProof = async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: "wallet query parameter is required" });
    }

    // Generate from the published snapshot so proofs always verify against
    // the on-chain root, even if the live students table has drifted
    // (edits made while roots are locked, imports, profile fixes).
    let wallets = null;
    const snap = await getMerkleSnapshot().catch(() => null);
    if (snap && snap.wallets.length > 0) {
      wallets = snap.wallets;
    } else {
      const result = await db.query(
        `SELECT wallet_address
         FROM students
         WHERE eligible_to_vote = true
           AND wallet_address IS NOT NULL`
      );
      wallets = result.rows.map(r => r.wallet_address);
    }

    const proof = generateMerkleProof(wallets, wallet);

    return res.json({ proof });
  } catch (error) {
    console.error("getProof error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const bulkVerifyVoters = async (req, res) => {
  try {
    const { student_ids } = req.body;

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: "student_ids array is required" });
    }

    const result = await db.query(
      `SELECT student_id, wallet_address
       FROM students
       WHERE student_id = ANY($1::text[])
         AND wallet_address IS NOT NULL
         AND wallet_verified = true`,
      [student_ids]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({
        error: "No eligible students found. Ensure wallets are linked and verified first.",
      });
    }

    const phase = Number(await electionContractV3.getPhase());
    if (phase >= 2) {
      return res.status(400).json({
        error: "Cannot verify voters during Voting or later. Merkle roots are locked on-chain. Verify all voters before advancing to phase 2.",
      });
    }

    await db.query(
      `UPDATE students
       SET eligible_to_vote = true
       WHERE student_id = ANY($1::text[])`,
      [result.rows.map((row) => row.student_id)]
    );

    const emailResult = await db.query(
      `SELECT student_id, name, email FROM students
       WHERE student_id = ANY($1::text[]) AND email IS NOT NULL`,
      [result.rows.map((row) => row.student_id)]
    );
    for (const student of emailResult.rows) {
      sendVoterVerifiedEmail({
        email: student.email,
        name: student.name || student.student_id,
      }).catch(() => {});
    }

    const txHash = await rebuildMerkleTrees();

    return res.json({
      success: true,
      verifiedCount: result.rows.length,
      students: result.rows,
      txHash,
    });
  } catch (error) {
    console.error("bulkVerifyVoters error:", error);
    return res.status(500).json({
      error: error.reason || error.message || "Bulk verification failed",
    });
  }
};

export const revokeVoter = async (req, res) => {
  try {
    const { student_id } = req.body;

    if (!student_id) {
      return res.status(400).json({ error: "student_id is required" });
    }

    const result = await db.query(
      `SELECT student_id, wallet_address, eligible_to_vote
       FROM students
       WHERE student_id = $1
         AND wallet_address IS NOT NULL`,
      [student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student with linked wallet not found" });
    }

    const student = result.rows[0];
    const previousEligible = student.eligible_to_vote;

    await db.query(
      `UPDATE students
       SET eligible_to_vote = false
       WHERE student_id = $1`,
      [student.student_id]
    );

    try {
      const txHash = await rebuildMerkleTrees();
      return res.json({ success: true, student, txHash });
    } catch (err) {
      await db.query(
        `UPDATE students
         SET eligible_to_vote = $1
         WHERE student_id = $2`,
        [previousEligible, student.student_id]
      );
      throw err;
    }
  } catch (error) {
    console.error("revokeVoter error:", error);
    return res.status(500).json({
      error: error.reason || error.message || "Voter revoke failed",
    });
  }
};

export const bulkRevokeVoters = async (req, res) => {
  try {
    const { student_ids } = req.body;

    if (!Array.isArray(student_ids) || student_ids.length === 0) {
      return res.status(400).json({ error: "student_ids array is required" });
    }

    const result = await db.query(
      `UPDATE students
       SET eligible_to_vote = false
       WHERE student_id = ANY($1::text[])
         AND eligible_to_vote = true
       RETURNING student_id`,
      [student_ids]
    );

    const txHash = await rebuildMerkleTrees();
    return res.json({
      success: true,
      revokedCount: result.rows.length,
      students: result.rows,
      txHash,
    });
  } catch (error) {
    console.error("bulkRevokeVoters error:", error);
    return res.status(500).json({
      error: error.reason || error.message || "Bulk revoke failed",
    });
  }
};

export const getIdentityProof = async (req, res) => {
  try {
    const { wallet } = req.query;

    if (!wallet) {
      return res.status(400).json({ error: "wallet query parameter is required" });
    }

    // Prefer the published snapshot: the target identity MUST come from the
    // same dataset the tree was built from, otherwise a renamed/edited
    // student would receive a proof for a leaf that is not in the tree.
    let identities = null;
    const snap = await getMerkleSnapshot().catch(() => null);
    if (snap && snap.identities.length > 0) {
      identities = snap.identities;
    } else {
      const allResult = await db.query(
        `SELECT wallet_address, name, year, gender
         FROM students
         WHERE eligible_to_vote = true
           AND wallet_address IS NOT NULL`
      );
      identities = toIdentities(allResult.rows);
    }

    const targetIdentity = identities.find(
      i => i.address && i.address.toLowerCase() === wallet.toLowerCase()
    );

    if (!targetIdentity) {
      return res.status(403).json({ error: "Student not found or not eligible" });
    }

    const proof = generateIdentityMerkleProof(identities, targetIdentity);

    return res.json({
      proof,
      identity: {
        name: targetIdentity.name,
        year: targetIdentity.year,
        isFemale: targetIdentity.isFemale,
      },
    });
  } catch (error) {
    console.error("getIdentityProof error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const adminRebuildMerkle = async (_req, res) => {
  try {
    const txHash = await rebuildMerkleTrees();
    if (!txHash) {
      const phase = Number(await electionContractV3.getPhase());
      if (phase >= 2) {
        return res.status(400).json({
          success: false,
          error: "Merkle roots are locked on-chain (phase >= 2). On-chain update skipped.",
        });
      }
      return res.json({
        success: true,
        changed: false,
        txHash: null,
        message: "Whitelist already in sync with the blockchain — no transaction needed.",
      });
    }
    return res.json({ success: true, changed: true, txHash });
  } catch (error) {
    console.error("adminRebuildMerkle error:", error);
    return res.status(500).json({ error: error.reason || error.message || "Rebuild failed" });
  }
};

/**
 * Public whitelist dataset behind the published Merkle roots. Clients
 * recompute the roots from this data and compare them against the on-chain
 * roots (read via their own wallet provider) before generating proofs
 * locally — removing any need to trust this backend.
 */
export const getVoterSnapshot = async (_req, res) => {
  try {
    const snap = await getMerkleSnapshot();
    if (!snap || snap.wallets.length === 0) {
      return res.status(404).json({ error: "No Merkle snapshot published yet" });
    }
    return res.json({
      wallets: snap.wallets,
      identities: snap.identities,
      voterRoot: generateMerkleRoot(snap.wallets),
      identityRoot: generateIdentityMerkleRoot(snap.identities),
      ipfsCid: snap.snapshotCid,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error("getVoterSnapshot error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};

export const checkMerkleSyncStatus = async (_req, res) => {
  try {
    const allEligibleResult = await db.query(
      `SELECT wallet_address FROM students WHERE eligible_to_vote = true AND wallet_address IS NOT NULL`
    );
    const allWallets = allEligibleResult.rows.map(r => r.wallet_address);
    const dbRoot = generateMerkleRoot(allWallets);

    const chainRoot = await electionContractV3.voterMerkleRoot();

    const needsSync = dbRoot !== chainRoot;
    res.json({ needsSync, dbRoot, chainRoot, eligibleCount: allWallets.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

export const getPendingVoters = async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT student_id, name, wallet_address, wallet_verified, eligible_to_vote
       FROM students
       ORDER BY student_id`
    );

    return res.json(result.rows);
  } catch (error) {
    console.error("getPendingVoters error:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
};
