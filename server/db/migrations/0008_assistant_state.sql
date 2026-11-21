-- Structured conversation state for the assistant (selected tour, travel date,
-- travellers, pending question). Additive: one nullable-by-default column, no data
-- is changed or removed, and the API keeps working if this has not been applied yet.
ALTER TABLE assistant_conversations
  ADD COLUMN IF NOT EXISTS state JSONB NOT NULL DEFAULT '{}'::jsonb;
