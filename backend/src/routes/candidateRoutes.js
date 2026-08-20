import express from "express";
import multer from "multer";
import { getCandidates, getPendingCandidates, applyAsCandidate, approveCandidate, rejectCandidate, getCandidateByWallet, getMyCandidateStatus, getCandidatePhoto } from "../controllers/candidateController.js";
import { requireStudentAuth } from "../middleware/auth.js";
import { verifyAdmin } from "../middleware/admin.js";
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

router.post("/upload-photo", upload.single("photo"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "photo file is required" });
    }

    const student_id = req.user?.student_id;
    if (!student_id) {
      return res.status(401).json({ error: "Authentication required" });
    }

    const base64 = req.file.buffer.toString("base64");
    const cid = `db:candidate:${student_id}`;

    await db.query(
      `UPDATE candidates SET photo_base64 = $1, image_cid = $2
       WHERE applied_by = $3 OR LOWER(wallet_address) = LOWER($4)
       RETURNING id`,
      [base64, cid, student_id.toUpperCase(), req.user?.wallet_address || ""]
    );

    res.json({
      success: true,
      url: `/api/candidates/${encodeURIComponent(student_id)}/photo`,
      cid,
      storage: "db",
    });
  } catch (error) {
    res.status(500).json({ error: error.message || "Upload failed" });
  }
});

export default router;
