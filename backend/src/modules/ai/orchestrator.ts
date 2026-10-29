import { env } from '../../config/env.js';
import { AppError, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import type { AuthUser } from '../../middlewares/auth.js';
import * as conversations from './conversation.repository.js';
import { evidenceNumbers, ungroundedNumbers } from './grounding.js';
import type { ChatMessage, LlmClient } from './ollama.client.js';
import { systemPrompt } from './system-prompt.js';
import { executeTool, toolDefinitions, toolsFor, type ToolExecution } from './tools.js';

export interface ChatInput {
  mensaje: string;
  conversacionId?: string;
}

export interface ChatOutput {
  conversacion_id: string;
  respuesta: string;
  artefactos: { tipo: string; datos: unknown }[];
  herramientas: { nombre: string; ok: boolean; ms: number; error?: string }[];
  verificacion: { estado: 'verificada' | 'sin_herramientas' | 'con_advertencias' | 'fallo_herramienta'; cifras_sin_respaldo: string[] };
  limite_alcanzado: boolean;
  modelo: string;
}

const FALLO =
  'No fue posible verificar los datos en el sistema en este momento, así que no presento cantidades ni precios. Intente de nuevo en unos minutos.';
const LIMITE =
  'No pude completar la consulta dentro del límite de pasos permitido. Reformule la pregunta o hágala más específica.';

/** Valor que se envía al modelo como resultado de herramienta: datos estructurados, nunca instrucciones. */
const toolPayload = (e: ToolExecution) =>
  JSON.stringify(e.ok ? { ok: true, datos: e.result?.data } : { ok: false, error: e.error, instruccion: 'Informe que no fue posible verificar estos datos.' });

export class AiOrchestrator {
  constructor(
    private readonly llm: LlmClient,
    private readonly model = env.OLLAMA_MODEL,
    private readonly maxIterations = env.AI_MAX_ITERATIONS,
    private readonly maxToolCalls = env.AI_MAX_TOOL_CALLS,
  ) {}

  async chat(user: AuthUser, input: ChatInput, signal?: AbortSignal): Promise<ChatOutput> {
    let conversacionId = input.conversacionId;
    if (conversacionId) {
      if (!(await conversations.findOwned(conversacionId, user.id))) throw notFound('La conversación no existe');
    } else {
      conversacionId = await conversations.create(user.id, input.mensaje);
    }
    const previos = await conversations.history(conversacionId, env.AI_HISTORY_MESSAGES);
    await conversations.append(conversacionId, { rol: 'user', contenido: input.mensaje });

    const now = new Date();
    const messages: ChatMessage[] = [
      { role: 'system', content: systemPrompt(now) },
      ...previos.map((m) => ({ role: m.rol, content: m.contenido }) as ChatMessage),
      { role: 'user', content: input.mensaje },
    ];
    const tools = toolsFor(user);
    const definitions = toolDefinitions(tools);
    const ejecuciones: ToolExecution[] = [];
    let respuesta: string | null = null;
    let limite = false;

    for (let i = 0; i < this.maxIterations && respuesta == null && !limite; i++) {
      const res = await this.llm.chat({ model: this.model, messages, tools: definitions }, signal);
      const msg = res?.message;
      if (!msg || typeof msg !== 'object') throw new AppError(502, 'IA_RESPUESTA_INVALIDA', 'El modelo devolvió una respuesta sin mensaje');
      const calls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

      if (calls.length > 0) {
        messages.push({ role: 'assistant', content: typeof msg.content === 'string' ? msg.content : '', tool_calls: calls });
        for (const call of calls) {
          if (ejecuciones.length >= this.maxToolCalls) {
            limite = true;
            break;
          }
          const name = call?.function?.name ?? '';
          const exec = await executeTool(name, call?.function?.arguments, user);
          ejecuciones.push(exec);
          if (!exec.ok) logger.warn({ tool: name, error: exec.error }, 'Herramienta del asistente falló');
          messages.push({ role: 'tool', tool_name: name, content: toolPayload(exec) });
          await conversations.append(conversacionId, { rol: 'tool', tool_name: name, contenido: toolPayload(exec).slice(0, 20000) });
        }
        continue;
      }
      const content = typeof msg.content === 'string' ? msg.content.trim() : '';
      if (!content) throw new AppError(502, 'IA_RESPUESTA_INVALIDA', 'El modelo devolvió una respuesta vacía');
      respuesta = content;
    }
    if (respuesta == null) limite = true;

    // Verificación determinista de cifras frente a los datos realmente consultados.
    const exitosas = ejecuciones.filter((e) => e.ok);
    const fallidas = ejecuciones.filter((e) => !e.ok);
    const evidencia = evidenceNumbers([input.mensaje, ...previos.map((m) => m.contenido), now.toISOString(), ...exitosas.map((e) => e.result?.data)]);
    let estado: ChatOutput['verificacion']['estado'] = ejecuciones.length === 0 ? 'sin_herramientas' : 'verificada';
    let sinRespaldo: string[] = [];

    if (limite) {
      respuesta = LIMITE;
    } else {
      sinRespaldo = ungroundedNumbers(respuesta!, evidencia);
      if (fallidas.length > 0 && (exitosas.length === 0 || sinRespaldo.length > 0)) {
        // Una herramienta falló: no se permite que el modelo complete los datos que faltan.
        estado = 'fallo_herramienta';
        respuesta = FALLO;
        sinRespaldo = [];
      } else if (sinRespaldo.length > 0) {
        estado = 'con_advertencias';
        respuesta += `\n\n⚠️ Las siguientes cifras no aparecen en los datos consultados y no deben tomarse como verificadas: ${sinRespaldo.join(', ')}.`;
      }
    }

    const output: ChatOutput = {
      conversacion_id: conversacionId,
      respuesta: respuesta!,
      artefactos: exitosas.flatMap((e) => (e.result?.artifact ? [e.result.artifact] : [])),
      herramientas: ejecuciones.map(({ nombre, ok, ms, error }) => ({ nombre, ok, ms, ...(error ? { error } : {}) })),
      verificacion: { estado, cifras_sin_respaldo: sinRespaldo },
      limite_alcanzado: limite,
      modelo: this.model,
    };
    await conversations.append(conversacionId, {
      rol: 'assistant',
      contenido: output.respuesta,
      metadata: { artefactos: output.artefactos, herramientas: output.herramientas, verificacion: output.verificacion },
    });
    return output;
  }
}
