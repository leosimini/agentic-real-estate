import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65_535).default(4000),
  JWT_SECRET: z.string().min(32).optional(),
  ACCOUNT_TOKEN_SECRET: z.string().min(32).optional(),
  JWT_EXPIRES_IN: z.string().min(2).default('7d'),
  JWT_ISSUER: z.string().min(3).default('agentic-real-estate-api'),
  JWT_AUDIENCE: z.string().min(3).default('agentic-real-estate-web'),
  SESSION_COOKIE_MAX_AGE_SECONDS: z.coerce.number().int().min(300).max(2_592_000).default(604_800),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
  PUBLIC_WEB_URL: z.string().url().default('http://localhost:3000'),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
  AI_PROVIDER: z.enum(['deterministic', 'openai']).default('deterministic'),
  OPENAI_API_KEY: z.preprocess(
    (value) => value === '' ? undefined : value,
    z.string().min(1).optional()
  ),
  OPENAI_MODEL: z.string().min(1).default('gpt-6-astra'),
  AI_TIMEOUT_MS: z.coerce.number().int().min(1000).max(30_000).default(8_000)
});

export type ApiConfig = {
  environment: 'development' | 'test' | 'production';
  port: number;
  jwtSecret: string;
  accountTokenSecret: string;
  jwtExpiresIn: string;
  jwtIssuer: string;
  jwtAudience: string;
  sessionCookieMaxAgeSeconds: number;
  trustProxy: boolean;
  corsOrigins: Set<string>;
  publicWebUrl: string;
  rateLimitMax: number;
  aiProvider: 'deterministic' | 'openai';
  openAiApiKey?: string;
  openAiModel: string;
  aiTimeoutMs: number;
};

export function loadApiConfig(environment: NodeJS.ProcessEnv = process.env): ApiConfig {
  const parsed = environmentSchema.parse(environment);
  if (parsed.NODE_ENV !== 'test' && !parsed.JWT_SECRET) {
    throw new Error('JWT_SECRET is required outside tests');
  }
  if (parsed.NODE_ENV === 'production' && !parsed.ACCOUNT_TOKEN_SECRET) {
    throw new Error('ACCOUNT_TOKEN_SECRET is required in production');
  }
  if (parsed.AI_PROVIDER === 'openai' && !parsed.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when AI_PROVIDER=openai');
  }

  return {
    environment: parsed.NODE_ENV,
    port: parsed.PORT,
    jwtSecret: parsed.JWT_SECRET ?? 'test-only-secret-not-valid-for-a-deployment',
    accountTokenSecret: parsed.ACCOUNT_TOKEN_SECRET ?? parsed.JWT_SECRET ?? 'test-only-account-token-secret-not-valid',
    jwtExpiresIn: parsed.JWT_EXPIRES_IN,
    jwtIssuer: parsed.JWT_ISSUER,
    jwtAudience: parsed.JWT_AUDIENCE,
    sessionCookieMaxAgeSeconds: parsed.SESSION_COOKIE_MAX_AGE_SECONDS,
    trustProxy: parsed.TRUST_PROXY === 'true',
    corsOrigins: new Set(parsed.CORS_ORIGINS.split(',').map((origin) => origin.trim()).filter(Boolean)),
    publicWebUrl: parsed.PUBLIC_WEB_URL.replace(/\/$/, ''),
    rateLimitMax: parsed.RATE_LIMIT_MAX,
    aiProvider: parsed.AI_PROVIDER,
    openAiApiKey: parsed.OPENAI_API_KEY,
    openAiModel: parsed.OPENAI_MODEL,
    aiTimeoutMs: parsed.AI_TIMEOUT_MS
  };
}
