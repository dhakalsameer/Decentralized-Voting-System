import express from "express";
import {
  registerStudent,
  loginStudent,
  getProfile,
  updateProfile,
  verifyCode,
  forgotPassword,
  changePassword,
  listStudents,
  adminUpdateStudent,
  adminBatchUpsertStudents,
} from "../controllers/authController.js";
import { uploadMiddleware, uploadPhoto } from "../controllers/uploadController.js";
import { requireStudentAuth } from "../middleware/auth.js";
import { verifyAdmin } from "../middleware/admin.js";

const router = express.Router();

router.post("/verify-code", verifyCode);
router.post("/register", registerStudent);
router.post("/login", loginStudent);

router.get("/me", requireStudentAuth, getProfile);
router.patch("/me", requireStudentAuth, updateProfile);
router.post("/change-password", requireStudentAuth, changePassword);

router.post("/forgot-password", forgotPassword);

// Photo upload (multipart/form-data, field name "photo")
router.post(
  "/me/photo",
  requireStudentAuth,
  uploadMiddleware,
  uploadPhoto
);

// Admin-only endpoints
router.get("/admin/students", verifyAdmin, listStudents);
router.patch("/admin/students/:id", verifyAdmin, adminUpdateStudent);
router.post("/admin/students/batch-upsert", verifyAdmin, adminBatchUpsertStudents);

export default router;
