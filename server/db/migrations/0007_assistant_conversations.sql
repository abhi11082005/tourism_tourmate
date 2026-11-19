-- =====================================================================
-- Tour Mate — 0007_assistant_conversations.sql
-- Conversation + message storage for the central LangGraph assistant.
--
-- Ownership: a conversation belongs to a signed-in user (user_id) OR to an
-- anonymous browser (guest_key_hash). The raw guest key is returned to the
-- client once and never stored; only its SHA-256 is kept, so a database leak
-- cannot be replayed to read someone else's chat.
-- Additive only: nothing existing is altered or dropped.
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS assistant_conversations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID        REFERENCES users(id) ON DELETE CASCADE,
  guest_key_hash  TEXT,
  tour_id         UUID        REFERENCES tours(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Exactly one kind of owner.
  CONSTRAINT assistant_conversations_one_owner
    CHECK ((user_id IS NOT NULL) <> (guest_key_hash IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS assistant_conversations_user_idx
  ON assistant_conversations (user_id, updated_at DESC)
  WHERE user_id IS NOT NULL;

DROP TRIGGER IF EXISTS assistant_conversations_touch ON assistant_conversations;
CREATE TRIGGER assistant_conversations_touch BEFORE UPDATE ON assistant_conversations
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TABLE IF NOT EXISTS assistant_messages (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID        NOT NULL REFERENCES assistant_conversations(id) ON DELETE CASCADE,
  role             TEXT        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          TEXT        NOT NULL,
  intent           TEXT,
  -- Which tools ran for this turn and what they returned (trimmed), for audit/debug.
  tool_calls       JSONB       NOT NULL DEFAULT '[]'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx
  ON assistant_messages (conversation_id, created_at);

COMMIT;
