import request from 'supertest';
import { createApp } from '../src/app.js';
import { pool, queryOne } from '../src/db/pool.js';
import type { ChatRequest, ChatResponse, LlmClient, ModelInfo } from '../src/modules/ai/ollama.client.js';

/** LLM simulado: reproduce el protocolo de tool_calls de /api/chat de Ollama con respuestas guionadas. */
export class ScriptedLlm implements LlmClient {
  requests: ChatRequest[] = [];
  constructor(
    public script: (req: ChatRequest, turn: number) => ChatResponse | Promise<ChatResponse> = () => ({ message: { role: 'assistant', content: 'ok' } }),
    public models: ModelInfo[] = [{ name: 'qwen2.5:7b' }],
  ) {}
  async chat(req: ChatRequest): Promise<ChatResponse> {
    this.requests.push(structuredClone(req));
    return this.script(req, this.requests.length - 1);
  }
  async listModels() {
    return this.models;
  }
}

export const llm = new ScriptedLlm();
export const app = createApp({ llm });
export const api = () => request(app);

export const USERS = {
  admin: 'ana@ferreteria.test',
  inventario: 'ivan@ferreteria.test',
  compras: 'camila@ferreteria.test',
  ventas: 'valentina@ferreteria.test',
  gerencia: 'gabriel@ferreteria.test',
  inactiva: 'iris@ferreteria.test',
} as const;
export const PASSWORD = 'ClaveSegura1'; // valor de prueba del seed

const tokens = new Map<string, string>();
export async function token(user: keyof typeof USERS) {
  if (!tokens.has(user)) {
    const res = await api().post('/api/auth/login').send({ correo: USERS[user], contrasena: PASSWORD });
    if (res.status !== 200) throw new Error(`Login falló para ${user}: ${res.status}`);
    tokens.set(user, res.body.accessToken);
  }
  return `Bearer ${tokens.get(user)}`;
}

export const stock = async (productoId: number) => {
  const r = await queryOne<{ disponible: string; reservada: string; danada: string }>(
    `SELECT COALESCE(SUM(cantidad) FILTER (WHERE estado='disponible'),0) AS disponible,
            COALESCE(SUM(cantidad) FILTER (WHERE estado='reservada'),0) AS reservada,
            COALESCE(SUM(cantidad) FILTER (WHERE estado='danada'),0) AS danada
       FROM existencia WHERE producto_id = $1`,
    [productoId],
  );
  return { disponible: Number(r!.disponible), reservada: Number(r!.reservada), danada: Number(r!.danada) };
};

export const count = async (sql: string, params: unknown[] = []) => Number((await queryOne<{ n: string }>(sql, params))!.n);

export { pool };
