-- Snapshot of the exact voter data behind the last published Merkle roots.
--
-- Proofs are ALWAYS generated from this snapshot (never from the live
-- students table). This decouples day-to-day database edits (photo uploads,
-- profile fixes, new imports) from on-chain whitelist validity:
--
--   * A proof fetched by a voter keeps verifying against the on-chain root
--     even if unrelated rows change afterwards.
--   * While roots are locked (phase >= 2), edits to the live table cannot
--     break voting or candidate registration, because proofs still come
--     from the data that was actually published.
--   * Re-syncing the whitelist is an explicit admin action that atomically
--     publishes new roots and refreshes this snapshot.
CREATE TABLE IF NOT EXISTS merkle_snapshots (
  id         BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
  wallets    JSONB       NOT NULL DEFAULT '[]'::jsonb,
  identities JSONB       NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
