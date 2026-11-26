import 'dotenv/config';
import { hostname } from 'node:os';
import { Redis } from 'ioredis';
import { RedisKeys } from '../modules/redis/redis.constants.js';

/**
 * Container healthcheck for worker processes: `node dist/workers/healthcheck.js <role>`.
 * Healthy when this container's heartbeat key exists in Redis.
 */
const role = process.argv[2];
if (!role) {
  console.error('usage: healthcheck.js <market|outbox|notifications>');
  process.exit(2);
}
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { maxRetriesPerRequest: 1, connectTimeout: 3000 });
try {
  const exists = await redis.exists(RedisKeys.workerHeartbeat(role, hostname()));
  process.exitCode = exists ? 0 : 1;
} catch {
  process.exitCode = 1;
} finally {
  redis.disconnect();
}
