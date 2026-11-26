import type { ThrottlerStorage } from '@nestjs/throttler';
import type { Redis } from 'ioredis';
import { RedisKeys } from './redis.constants.js';

// KEYS[1] hits key, KEYS[2] block key; ARGV ttl ms, limit, block ms
const SCRIPT = `
local blockTtl = redis.call('pttl', KEYS[2])
if blockTtl > 0 then
  return {tonumber(redis.call('get', KEYS[1]) or '0'), redis.call('pttl', KEYS[1]), 1, blockTtl}
end
local hits = redis.call('incr', KEYS[1])
if hits == 1 then redis.call('pexpire', KEYS[1], ARGV[1]) end
local ttl = redis.call('pttl', KEYS[1])
if hits > tonumber(ARGV[2]) then
  redis.call('set', KEYS[2], '1', 'PX', ARGV[3])
  return {hits, ttl, 1, tonumber(ARGV[3])}
end
return {hits, ttl, 0, 0}
`;

/** Shared rate-limit counters so limits hold across API instances (plan §13). */
export class RedisThrottlerStorage implements ThrottlerStorage {
  constructor(private readonly redis: Redis) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string) {
    const base = RedisKeys.throttle(`${throttlerName}:${key}`);
    const [hits, ttlMs, blocked, blockMs] = (await this.redis.eval(
      SCRIPT,
      2,
      base,
      `${base}:blocked`,
      String(ttl),
      String(limit),
      String(blockDuration || ttl),
    )) as [number, number, number, number];
    return {
      totalHits: hits,
      timeToExpire: Math.max(0, Math.ceil(ttlMs / 1000)),
      isBlocked: blocked === 1,
      timeToBlockExpire: Math.max(0, Math.ceil(blockMs / 1000)),
    };
  }
}
