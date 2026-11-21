import { createHash, randomBytes } from 'node:crypto';
import { query, queryOne } from '../db/pool.js';
import { notFound } from '../utils/httpError.js';

/*
 * Conversation storage for the central assistant.
 *
 * Ownership rules (the single place they live):
 *   - signed-in user  -> conversation.user_id must equal req.user.id
 *   - guest           -> the caller must present the guest key that was issued when
 *                        the conversation was created; only its hash is stored.
 * A conversation the caller does not own is reported as 404, not 403, so ids
 * cannot be probed for existence.
 */

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const newGuestKey = () => randomBytes(24).toString('base64url');

/**
 * Start a conversation. For guests the raw key is returned exactly once.
 * @returns {Promise<{ id: string, tourId: string|null, guestKey?: string }>}
 */
export async function createConversation({ userId, tourId = null }) {
  if (userId) {
    const row = await queryOne(
      `INSERT INTO assistant_conversations (user_id, tour_id)
       VALUES ($1, $2) RETURNING id, tour_id`,
      [userId, tourId]
    );
    return { id: row.id, tourId: row.tour_id };
  }

  const guestKey = newGuestKey();
  const row = await queryOne(
    `INSERT INTO assistant_conversations (guest_key_hash, tour_id)
     VALUES ($1, $2) RETURNING id, tour_id`,
    [sha256(guestKey), tourId]
  );
  return { id: row.id, tourId: row.tour_id, guestKey };
}

/**
 * Load a conversation only if the caller owns it.
 * @throws {HttpError} 404 when missing or owned by someone else
 */
export async function getOwnedConversation({ conversationId, userId, guestKey }) {
  const row = await queryOne(
    // `*` on purpose: `state` only exists once migration 0008 is applied, and chat must keep working before that.
    `SELECT * FROM assistant_conversations WHERE id = $1`,
    [conversationId]
  );
  if (!row) throw notFound('Conversation not found');

  const owns = userId
    ? row.user_id === userId
    : Boolean(guestKey) && row.guest_key_hash === sha256(guestKey);
  if (!owns) throw notFound('Conversation not found');

  return { id: row.id, tourId: row.tour_id, state: row.state ?? {} };
}

/** Remember which tour this conversation is about, so follow-ups need not repeat its name. */
export async function setConversationTour(conversationId, tourId) {
  await query('UPDATE assistant_conversations SET tour_id = $2 WHERE id = $1', [conversationId, tourId]);
}

/**
 * Store what the conversation has settled (see assistant/memory.js). Quietly does nothing
 * until migration 0008 has added the column, so a missed migration never breaks chat.
 */
export async function setConversationState(conversationId, state) {
  try {
    await query('UPDATE assistant_conversations SET state = $2::jsonb WHERE id = $1', [conversationId, JSON.stringify(state ?? {})]);
  } catch (err) {
    if (err?.code !== '42703') throw err; // undefined_column
  }
}

/** Most recent messages, oldest first, for prompt history and for replay. */
export async function recentMessages(conversationId, limit = 10) {
  const { rows } = await query(
    `SELECT role, content, intent, created_at
       FROM (SELECT role, content, intent, created_at
               FROM assistant_messages
              WHERE conversation_id = $1
              ORDER BY created_at DESC
              LIMIT $2) m
      ORDER BY created_at ASC`,
    [conversationId, limit]
  );
  return rows;
}

export async function appendMessage({ conversationId, role, content, intent = null, toolCalls = [] }) {
  await query(
    `INSERT INTO assistant_messages (conversation_id, role, content, intent, tool_calls)
     VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [conversationId, role, content, intent, JSON.stringify(toolCalls)]
  );
  await query('UPDATE assistant_conversations SET updated_at = NOW() WHERE id = $1', [
    conversationId,
  ]);
}
