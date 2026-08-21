import express from "express";
import { bulkVerifyVoters, getMe, getPendingVoters, revokeVoter, bulkRevokeVoters, getProof, getIdentityProof, adminRebuildMerkle, checkMerkleSyncStatus, getVoterSnapshot } from "../controllers/voterController.js";
import { verifyAdmin } from "../middleware/admin.js";
import { db } from "../db.js";

const router = express.Router();

router.get("/me", getMe);
router.get("/pending", getPendingVoters);
router.get("/proof", getProof);
router.get("/identity-proof", getIdentityProof);
router.get("/snapshot", getVoterSnapshot);
router.post("/verify-bulk", verifyAdmin, bulkVerifyVoters);
router.post("/revoke", verifyAdmin, revokeVoter);
router.post("/revoke-bulk", verifyAdmin, bulkRevokeVoters);
router.post("/rebuild-merkle", verifyAdmin, adminRebuildMerkle);
router.get("/merkle-sync-status", verifyAdmin, checkMerkleSyncStatus);
router.get("/verification-status", verifyAdmin, async (req, res) => {
  try {
    const [total, linked, verified] = await Promise.all([
      db.query("SELECT COUNT(*)::int AS c FROM students"),
      db.query("SELECT COUNT(*)::int AS c FROM students WHERE wallet_address IS NOT NULL AND wallet_verified = true"),
      db.query("SELECT COUNT(*)::int AS c FROM students WHERE eligible_to_vote = true"),
    ]);
    res.json({
      total: total.rows[0].c,
      walletLinked: linked.rows[0].c,
      verified: verified.rows[0].c,
      unverified: linked.rows[0].c - verified.rows[0].c,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
