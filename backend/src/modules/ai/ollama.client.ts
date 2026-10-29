import { env } from '../../config/env.js';
import { AppError } from '../../lib/errors.js';

// Adaptador HTTP de la API oficial de Ollama (/api/chat, /api/tags). Solo el backend lo usa.

export interface ToolCall {
  function: { name: string; arguments: Record<string, unknown> | string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_name?: string;
}

export interface ToolDefinition {
  type: 'function';
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolDefinition[];
}

export interface ChatResponse {
  message: ChatMessage;
}

export interface ModelInfo {
  name: string;
  size?: number;
  modified_at?: string;
}

export interface LlmClient {
  chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse>;
  listModels(signal?: AbortSignal): Promise<ModelInfo[]>;
}

const unavailable = () =>
  new AppError(503, 'IA_NO_DISPONIBLE', 'El servicio de IA local (Ollama) no está disponible. Verifique que esté en ejecución.');

export class OllamaClient implements LlmClient {
  constructor(
    private readonly baseUrl = env.OLLAMA_BASE_URL,
    private readonly timeoutMs = env.OLLAMA_TIMEOUT_MS,
  ) {}

  private async request(path: string, init: RequestInit, signal?: AbortSignal) {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, { ...init, signal: combined });
    } catch (error) {
      if (signal?.aborted) throw new AppError(499, 'SOLICITUD_CANCELADA', 'La consulta fue cancelada');
      if (timeout.aborted) throw new AppError(504, 'IA_TIEMPO_AGOTADO', 'El modelo tardó demasiado en responder');
      throw unavailable();
    }
    const text = await res.text();
    if (!res.ok) {
      if (res.status === 404 && /model/i.test(text)) {
        throw new AppError(503, 'MODELO_NO_INSTALADO', `El modelo configurado no está instalado en Ollama. Ejecute: ollama pull ${env.OLLAMA_MODEL}`);
      }
      throw new AppError(502, 'IA_ERROR', `Ollama respondió con error ${res.status}`);
    }
    try {
      return JSON.parse(text);
    } catch {
      throw new AppError(502, 'IA_RESPUESTA_INVALIDA', 'Ollama devolvió una respuesta que no es JSON válido');
    }
  }

  async chat(req: ChatRequest, signal?: AbortSignal): Promise<ChatResponse> {
    const body = await this.request(
      '/api/chat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...req, stream: false, options: { temperature: 0.1 } }),
      },
      signal,
    );
    if (body?.error) throw new AppError(502, 'IA_ERROR', 'Ollama devolvió un error al generar la respuesta');
    return body as ChatResponse;
  }

  async listModels(signal?: AbortSignal): Promise<ModelInfo[]> {
    const body = await this.request('/api/tags', { method: 'GET' }, signal);
    return Array.isArray(body?.models) ? body.models.map((m: ModelInfo) => ({ name: m.name, size: m.size, modified_at: m.modified_at })) : [];
  }
}
