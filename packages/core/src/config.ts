import { z } from 'zod';

const repoRe = /^[\w.-]+\/[\w.-]+$/;
const routesSchema = z.record(z.string().regex(repoRe, 'expected "owner/repo"'));

const envSchema = z
  .object({
    PUBLIC_URL: z
      .string()
      .url()
      .transform((u) => u.replace(/\/$/, '')),
    PORT: z.coerce.number().int().positive().default(3000),
    LINEAR_CLIENT_ID: z.string().min(1),
    LINEAR_CLIENT_SECRET: z.string().min(1),
    LINEAR_WEBHOOK_SECRET: z.string().min(1),
    GITHUB_APP_ID: z.string().optional(),
    GITHUB_APP_PRIVATE_KEY: z
      .string()
      .optional()
      .transform((k) => k?.replace(/\\n/g, '\n')),
    GITHUB_PAT: z.string().optional(),
    HEIMDALL_CALLBACK_SECRET: z.string().min(16, 'use a long random secret'),
    HEIMDALL_ROUTES: z.string().transform((raw, ctx) => {
      try {
        return routesSchema.parse(JSON.parse(raw));
      } catch (err) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `invalid HEIMDALL_ROUTES: ${(err as Error).message}`,
        });
        return z.NEVER;
      }
    }),
    REDIS_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_URL: z.string().url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z.string().min(1).optional(),
  })
  .refine((env) => (env.GITHUB_APP_ID && env.GITHUB_APP_PRIVATE_KEY) || env.GITHUB_PAT, {
    message: 'set GITHUB_APP_ID + GITHUB_APP_PRIVATE_KEY, or GITHUB_PAT',
  })
  .refine((env) => env.REDIS_URL || (env.UPSTASH_REDIS_REST_URL && env.UPSTASH_REDIS_REST_TOKEN), {
    message: 'set REDIS_URL, or UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN',
  });

export type Config = z.infer<typeof envSchema>;

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  return envSchema.parse(env);
}
