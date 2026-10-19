// Sliding-window rate limits per user, for endpoints that call the LLM (Gemini's free tier has
// per-minute limits) or are expensive. Uses a Redis sorted set per user and bucket: each request
// is a member scored by its timestamp; members older than the window are dropped before counting.
import crypto from 'crypto';
import type { Request, Response, NextFunction } from 'express';
import { getStore } from '../cache/store';

export interface RateLimitOptions {
  bucket: string;
  // A function is read on every request, so the limit follows the environment.
  limit: number | (() => number);
  windowMs: number;
}

export function rateLimit({ bucket, limit: limitOption, windowMs }: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const limit = typeof limitOption === 'function' ? limitOption() : limitOption;
    const subject = (req as Request & { userId?: number }).userId ?? req.ip;
    const key = `rl:${bucket}:${subject}`;
    const now = Date.now();
    const member = `${now}-${crypto.randomBytes(4).toString('hex')}`;
    try {
      const { count, oldestMs } = await getStore().hit(key, now, windowMs, member);
      res.setHeader('RateLimit-Limit', String(limit));
      res.setHeader('RateLimit-Remaining', String(Math.max(0, limit - count)));
      if (count > limit) {
        // Rejected requests do not use up the window.
        await getStore().unhit(key, member);
        const retryAfter = Math.max(1, Math.ceil((oldestMs + windowMs - now) / 1000));
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(429).json({
          error: `Rate limit reached: at most ${limit} requests per ${Math.round(windowMs / 1000)} s for ${bucket}. Try again in ${retryAfter} s.`,
          retryAfterSeconds: retryAfter,
          limit,
        });
      }
    } catch (err) {
      // Fail open if the store is down: limits protect quotas, they are not a security boundary.
      console.error('Rate limiter unavailable:', (err as Error).message);
    }
    next();
  };
}

const perMinute = (name: string, fallback: number) => () => Number(process.env[name] || fallback);

/** Agent and single-shot LLM calls. */
export const llmRateLimit = () =>
  rateLimit({ bucket: 'llm', limit: perMinute('RATE_LIMIT_LLM_PER_MIN', 10), windowMs: 60_000 });

/** SQL execution from the editor. */
export const queryRateLimit = () =>
  rateLimit({
    bucket: 'query',
    limit: perMinute('RATE_LIMIT_QUERY_PER_MIN', 120),
    windowMs: 60_000,
  });
