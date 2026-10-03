-- Enforce that student_id is stored in canonical form: trimmed and uppercase.
--
-- Login normalises the submitted id (trim + upper) before looking the student
-- up, so the query only ever matches canonical rows. That normalisation is only
-- safe while every stored id is canonical. Until now that was a convention held
-- in application code by createStudent's .toUpperCase(); an admin import, a CSV
-- load or a new code path could store 'guab4003' and make the account
-- unreachable at login with no obvious cause.
--
-- Pre-check (returns 0 on a clean database, verified on production):
--   SELECT student_id FROM students
--   WHERE student_id <> upper(btrim(student_id));
--
-- Fix any rows it returns before running this migration:
--   UPDATE students SET student_id = upper(btrim(student_id));
--
-- Safe to re-run: the constraint is only added when absent.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'students'::regclass
      AND conname = 'students_student_id_canonical'
  ) THEN
    ALTER TABLE students
      ADD CONSTRAINT students_student_id_canonical
      CHECK (student_id = upper(btrim(student_id)));
  END IF;
END $$;
