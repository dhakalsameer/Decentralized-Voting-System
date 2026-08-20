-- Permanent photo storage: store the photo bytes directly in the DB so
-- photos never depend on flaky IPFS public gateways or Pinata pin retention.
--
-- image_cid semantics:
--   - "db:student:<student_id>"      -> photo lives in students.photo_base64
--   - "db:candidate:<candidate_id>"  -> photo lives in candidates.photo_base64
--   - otherwise                      -> legacy IPFS CID (Qm...) resolved via gateways

ALTER TABLE students ADD COLUMN IF NOT EXISTS photo_base64 TEXT;
ALTER TABLE candidates ADD COLUMN IF NOT EXISTS photo_base64 TEXT;