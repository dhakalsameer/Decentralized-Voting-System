import multer from "multer";
import { db } from "../db.js";

// In-memory upload so we can forward the buffer to DB storage.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
  fileFilter: (_req, file, cb) => {
    if (!/^image\/(png|jpe?g|webp|gif)$/i.test(file.mimetype)) {
      return cb(new Error("Only PNG/JPEG/WEBP/GIF images are allowed"));
    }
    cb(null, true);
  },
});

export const uploadMiddleware = upload.single("photo");

/**
 * Store a photo permanently in the database as base64. Returns a
 * DB-backed reference ({ cid: "db:student:<student_id>" }) so photos
 * never depend on IPFS gateways or Pinata pin retention.
 */
function persistPhoto(buffer) {
  const base64 = buffer.toString("base64");
  return { cid: base64, isDbPhoto: true };
}

export async function uploadPhoto(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "photo file is required (multipart field 'photo')" });
    }

    const { student_id } = req.user;
    const base64 = req.file.buffer.toString("base64");

    const result = await db.query(
      `UPDATE students SET photo_base64 = $1, updated_at = NOW()
       WHERE student_id = $2
       RETURNING student_id, name, year, gender, wallet_address, wallet_verified, eligible_to_vote`,
      [base64, student_id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const row = result.rows[0];
    const cid = `db:student:${student_id}`;

    if (row.wallet_address) {
      await db.query(
        `UPDATE candidates SET photo_base64 = $1, image_cid = $2 WHERE LOWER(wallet_address) = LOWER($3)`,
        [base64, cid, row.wallet_address]
      );
    }

    return res.json({
      success: true,
      image_cid: cid,
      image_url: `/api/students/${encodeURIComponent(student_id)}/photo`,
      storage: "db",
      student: {
        student_id: row.student_id,
        name: row.name,
        year: row.year,
        gender: row.gender,
        image_cid: cid,
        wallet_address: row.wallet_address,
        walletLinked: Boolean(row.wallet_address),
        walletVerified: Boolean(row.wallet_verified),
        eligibleToVote: Boolean(row.eligible_to_vote),
      },
    });
  } catch (error) {
    console.error("uploadPhoto error:", error);
    return res.status(500).json({ error: error.message || "Photo upload failed" });
  }
}
