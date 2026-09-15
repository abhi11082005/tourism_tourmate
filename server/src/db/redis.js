import Redis from 'ioredis';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const redis = new Redis(env.REDIS_URL, {
  maxRetriesPerRequest: 2,
  enableReadyCheck: true,
  // Seat holds are correctness-critical: fail the request rather than queue it
  // silently while Redis is down.
  enableOfflineQueue: false,
  retryStrategy: (attempt) => Math.min(attempt * 200, 2_000),
});

redis.on('error', (err) => logger.error({ err }, 'redis error'));
redis.on('ready', () => logger.info('redis ready'));

/*
 * Seat holds live in one hash per (tour, date):
 *   seats:hold:{tourId}:{YYYY-MM-DD}  ->  { holdId: seatCount }
 * Each hold also gets its own key carrying the TTL:
 *   seats:hold:ttl:{holdId}           ->  "{tourId}|{date}|{seats}"
 *
 * Redis does not expire hash fields (pre-7.4), so the hash is swept lazily: the
 * acquire script drops any field whose TTL companion key is gone before it counts
 * held seats. That keeps "seats currently held" exact without a background job.
 */

const ACQUIRE_LUA = `
local hashKey   = KEYS[1]
local holdId    = ARGV[1]
local seats     = tonumber(ARGV[2])
local capacity  = tonumber(ARGV[3])
local booked    = tonumber(ARGV[4])
local ttl       = tonumber(ARGV[5])
local ttlPrefix = ARGV[6]
local payload   = ARGV[7]

local held = 0
local fields = redis.call('HGETALL', hashKey)
for i = 1, #fields, 2 do
  local field, value = fields[i], tonumber(fields[i + 1])
  if redis.call('EXISTS', ttlPrefix .. field) == 1 then
    held = held + value
  else
    redis.call('HDEL', hashKey, field)   -- expired hold: reclaim its seats
  end
end

local available = capacity - booked - held
if available < seats then
  return { 0, available }
end

redis.call('HSET', hashKey, holdId, seats)
redis.call('SET', ttlPrefix .. holdId, payload, 'EX', ttl)
-- Hash outlives the longest hold; the sweep above keeps it honest.
redis.call('EXPIRE', hashKey, ttl * 2)
return { 1, available - seats }
`;

const RELEASE_LUA = `
local hashKey   = KEYS[1]
local ttlKey    = KEYS[2]
local holdId    = ARGV[1]
local removed   = redis.call('HDEL', hashKey, holdId)
redis.call('DEL', ttlKey)
return removed
`;

redis.defineCommand('acquireSeatHold', { numberOfKeys: 1, lua: ACQUIRE_LUA });
redis.defineCommand('releaseSeatHold', { numberOfKeys: 2, lua: RELEASE_LUA });

export async function closeRedis() {
  await redis.quit();
}
