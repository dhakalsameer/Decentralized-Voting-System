import express from "express";
import multer from "multer";
import { getCandidates, getPendingCandidates, applyAsCandidate, approveCandidate, rejectCandidate, getCandidateByWallet, getMyCandidateStatus, getCandidatePhoto } from "../controllers/candidateController.js";
import { requireStudentAuth } from "../middleware/auth.js";
import { verifyAdmin } from "../middleware/admin.js";
import { isCandidatePhotoLocked } from "../utils/phasePolicy.js";
import { electionContractV3 } from "../blockchain/electionContract.js";
import { db } from "../db.js";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error("Only PNG/JPEG/WEBP/GIF images are allowed"));
    }
    cb(null, true);
  },
});

const router = express.Router();

router.get("/", getCandidates);
router.get("/pending", verifyAdmin, getPendingCandidates);
router.get("/by-wallet/:wallet", getCandidateByWallet);
router.post("/apply", requireStudentAuth, applyAsCandidate);
router.get("/me", requireStudentAuth, getMyCandidateStatus);
router.get("/:ref/photo", getCandidatePhoto);
router.post("/:id/approve", verifyAdmin, approveCandidate);
router.post("/:id/reject", verifyAdmin, rejectCandidate);

router.post("/upload-photo", requireStudentAuth, upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "photo file is required" });
    }

    // Freeze candidate media once voting opens. Fails open so a transient RPC
    // problem cannot block a student from correcting their photo; the on-chain
    // phase is the source of truth, not this cache.
    try {
      if (isCandidatePhotoLocked(await electionContractV3.getPhase())) {
        return res.status(403).json({
          error: "Candidate photos are locked once voting has started",
        });
      }
    } catch (err) {
      console.warn("Phase read failed, allowing candidate photo upload:", err.message);
    }

    const student_id = req.user?.student_id;
    if (!student_id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    // Resolve the wallet server-side. Never trust a client-supplied address,
    // otherwise one student could overwrite another candidate's photo.
    const student = await db.query(
      `SELECT wallet_address, wallet_verified FROM students WHERE student_id = $1`,
      [student_id]
    );
    const wallet = student.rows[0]?.wallet_address;
    if (!wallet) {
      return res.status(400).json({
        error: "Link a wallet to your student account before uploading a photo",
      });
    }
    if (!student.rows[0].wallet_verified) {
      return res.status(403).json({ error: "Wallet is not verified yet" });
    }

    const base64 = req.file.buffer.toString("base64");

    // The students row always exists, so the photo is retained even when the
    // candidate has not registered on-chain yet.
    await db.query(
      `UPDATE students SET photo_base64 = $1, updated_at = NOW() WHERE student_id = $2`,
      [base64, student_id]
    );

    // Wallet-keyed reference: getCandidatePhoto matches it on
    // LOWER(wallet_address), so retrieval resolves once sync creates the row.
    const cid = `db:candidate:${wallet}`;

    await db.query(
      `UPDATE candidates SET photo_base64 = $1, image_cid = $2
       WHERE LOWER(wallet_address) = LOWER($3)`,
      [base64, cid, wallet]
    );

    res.json({
      success: true,
      url: `/api/candidates/${encodeURIComponent(wallet)}/photo`,
      cid,
      image_cid: cid,
      storage: "db",
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Upload failed" });
  }
});

export default router;
