import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT:     z.coerce.number().default(3001),
  LOG_LEVEL: z.enum(['silent','error','warn','info','http','verbose','debug','silly']).default('info'),

  DATABASE_URL: z.string().url(),
  JWT_SECRET:   z.string().min(32),

  CORS_ORIGIN:  z.string().default('http://localhost:5173'),
  BACKEND_URL:  z.string().url().default('http://localhost:3001'),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),

  GOOGLE_CLIENT_ID:     z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI:  z.string().url().optional(),
  CRON_API_KEY:         z.string().optional(),

  LLM_PROVIDER:         z.enum(['anthropic', 'google']).default('google'),
  ANTHROPIC_API_KEY:    z.string().optional(),
  GOOGLE_AI_API_KEY:    z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.NODE_ENV !== 'production') return;

  for (const k of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','CRON_API_KEY'] as const) {
    if (!v[k]) ctx.addIssue({ code: 'custom', path: [k], message: `${k} is required in production` });
  }

  if (v.LLM_PROVIDER === 'google' && !v.GOOGLE_AI_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['GOOGLE_AI_API_KEY'], message: 'GOOGLE_AI_API_KEY is required when LLM_PROVIDER=google in production' });
  }
  if (v.LLM_PROVIDER === 'anthropic' && !v.ANTHROPIC_API_KEY) {
    ctx.addIssue({ code: 'custom', path: ['ANTHROPIC_API_KEY'], message: 'ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic in production' });
  }
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  // eslint-disable-next-line no-console
  console.error('❌ Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    // eslint-disable-next-line no-console
    console.error(`  - ${issue.path.join('.') || '(root)'}: ${issue.message}`);
  }
  process.exit(1);
}

export const env = parsed.data;
export type Env = typeof env;
