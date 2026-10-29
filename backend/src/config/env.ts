import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url(),
  TEST_DATABASE_URL: z.string().url().optional(),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET debe tener al menos 32 caracteres'),
  JWT_EXPIRES_IN: z.string().default('15m'),
  JWT_REFRESH_DAYS: z.coerce.number().int().positive().default(7),
  OLLAMA_BASE_URL: z.string().url().default('http://127.0.0.1:11434'),
  OLLAMA_MODEL: z.string().min(1).default('qwen2.5:7b'),
  OLLAMA_TIMEOUT_MS: z.coerce.number().int().positive().default(90000),
  AI_MAX_ITERATIONS: z.coerce.number().int().min(1).max(20).default(6),
  AI_MAX_TOOL_CALLS: z.coerce.number().int().min(1).max(50).default(10),
  AI_MAX_MESSAGE_CHARS: z.coerce.number().int().min(100).max(20000).default(2000),
  AI_HISTORY_MESSAGES: z.coerce.number().int().min(0).max(100).default(12),
  FRONTEND_URL: z.string().default('http://localhost:5173'),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  RATE_LIMIT_LOGIN_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_CHAT_MAX: z.coerce.number().int().positive().default(20),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  COTIZACION_VIGENCIA_DIAS: z.coerce.number().int().min(1).max(365).default(15),
  CIERRE_AUTOMATICO: bool,
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Se informa qué variable falla sin imprimir sus valores.
  const problemas = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
  throw new Error(`Configuración inválida: ${problemas}`);
}

const raw = parsed.data;
const isTest = raw.NODE_ENV === 'test' || process.env.VITEST === 'true';

export const env = {
  ...raw,
  NODE_ENV: isTest ? ('test' as const) : raw.NODE_ENV,
  // En pruebas se usa siempre la base aislada para no tocar los datos de desarrollo.
  DATABASE_URL: isTest ? raw.TEST_DATABASE_URL ?? raw.DATABASE_URL : raw.DATABASE_URL,
};

export type Env = typeof env;
