import { z } from 'zod';
import type { WorkspaceRoutes } from './routes';

const repoRe = /^[\w.-]+\/[\w.-]+$/;
const tableSchema = z.record(z.string().regex(repoRe, 'expected "owner/repo"'));
const workspaceRoutesSchema = z.record(tableSchema);

/**
 * HEIMDALL_ROUTES accepts two shapes:
 * - flat (single workspace):   {"ENG":"acme/backend","*":"acme/sandbox"}
 * - nested (per workspace):    {"<linear org id>":{"ENG":"acme/backend"},"*":{...}}
 * Flat is normalized to `{"*": table}`. Mixed shapes are rejected.
 */
function parseRoutes(raw: string): WorkspaceRoutes {
  const json: unknown = JSON.parse(raw);
  if (json === null || typeof json !== 'object' || Array.isArray(json)) {
    throw new Error('expected a JSON object');
  }
  const values = Object.values(json);
  const objects = values.filter((v) => typeof v === 'object' && v !== null).length;
  if (objects === values.length && values.length > 0) return workspaceRoutesSchema.parse(json);
  if (objects === 0) return { '*': tableSchema.parse(json) };
  throw new Error('mix of flat ("TEAM":"owner/repo") and nested (workspace id -> table) entries');
}

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
        return parseRoutes(raw);
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
  // Treat empty strings as unset: .env files (and docker compose env_file)
  // pass blank template lines like `UPSTASH_REDIS_REST_URL=` through as "".
  const present = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== '' && v != null));
  return envSchema.parse(present);
}
