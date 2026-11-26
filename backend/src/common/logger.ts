import { ConsoleLogger, type LogLevel } from '@nestjs/common';

const ORDER: LogLevel[] = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'];

/**
 * Plan §13: redacted structured logs. JSON lines to stdout in production;
 * secrets in structured params are masked (never interpolate them into messages).
 */
export function createLogger(): ConsoleLogger {
  const level = (process.env.LOG_LEVEL ?? 'log') as LogLevel;
  const json = process.env.LOG_JSON ? ['true', '1', 'yes'].includes(process.env.LOG_JSON) : process.env.NODE_ENV === 'production';
  return new ConsoleLogger({
    json,
    logLevels: ORDER.slice(Math.max(0, ORDER.indexOf(level))),
    redact: ['password', 'passwordHash', 'authorization', 'accessToken', 'refreshToken', 'pushToken', 'token', 'secret'],
  });
}
