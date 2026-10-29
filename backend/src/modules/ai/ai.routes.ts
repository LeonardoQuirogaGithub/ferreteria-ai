import { Router } from 'express';
import { z } from 'zod';
import { env } from '../../config/env.js';
import { AppError, notFound } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/http.js';
import { can, requirePermission } from '../../middlewares/auth.js';
import { chatLimiter } from '../../middlewares/rate-limit.js';
import * as conversations from './conversation.repository.js';
import type { LlmClient } from './ollama.client.js';
import { AiOrchestrator } from './orchestrator.js';
import { toolsFor } from './tools.js';

export function aiRouter(llm: LlmClient) {
  const router = Router();
  const orchestrator = new AiOrchestrator(llm);
  const perm = requirePermission('ia.usar');

  // El usuario sale de la sesión autenticada; el cliente no puede enviar un usuario_id.
  const ChatSchema = z
    .object({
      mensaje: z.string().trim().min(1, 'Escriba una pregunta').max(env.AI_MAX_MESSAGE_CHARS, `Máximo ${env.AI_MAX_MESSAGE_CHARS} caracteres`),
      conversacion_id: z.string().uuid().optional(),
    })
    .strict();

  router.post('/chat', perm, chatLimiter, asyncHandler(async (req, res) => {
    const body = ChatSchema.parse(req.body);
    const controller = new AbortController();
    // Si el usuario cancela (cierra la petición) se aborta la llamada a Ollama.
    res.on('close', () => {
      if (!res.writableEnded) controller.abort();
    });
    const out = await orchestrator.chat(req.user!, { mensaje: body.mensaje, conversacionId: body.conversacion_id }, controller.signal);
    res.json(out);
  }));

  router.get('/status', perm, asyncHandler(async (req, res) => {
    const base = {
      modelo_configurado: env.OLLAMA_MODEL,
      timeout_ms: env.OLLAMA_TIMEOUT_MS,
      max_iteraciones: env.AI_MAX_ITERATIONS,
      herramientas_disponibles: toolsFor(req.user!).map((t) => t.name),
      ...(can(req.user, 'usuario.gestionar') ? { ollama_url: env.OLLAMA_BASE_URL } : {}),
    };
    try {
      const modelos = await llm.listModels(AbortSignal.timeout(5000));
      const nombres = modelos.map((m) => m.name);
      const disponible = nombres.some((n) => n === env.OLLAMA_MODEL || n === `${env.OLLAMA_MODEL}:latest`);
      res.json({
        ...base,
        ollama: 'conectado',
        modelo_disponible: disponible,
        mensaje: disponible
          ? 'El asistente está listo'
          : `El modelo ${env.OLLAMA_MODEL} no está instalado o se está descargando. Ejecute: ollama pull ${env.OLLAMA_MODEL}`,
      });
    } catch (error) {
      res.json({
        ...base,
        ollama: 'no_disponible',
        modelo_disponible: false,
        mensaje: error instanceof AppError ? error.message : 'No se pudo contactar a Ollama',
      });
    }
  }));

  router.get('/models', perm, asyncHandler(async (_req, res) => {
    res.json({ data: await llm.listModels(), modelo_configurado: env.OLLAMA_MODEL });
  }));

  router.get('/conversations', perm, asyncHandler(async (req, res) => {
    res.json({ data: await conversations.listForUser(req.user!.id) });
  }));

  router.get('/conversations/:id', perm, asyncHandler(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    if (!(await conversations.findOwned(id, req.user!.id))) throw notFound('La conversación no existe');
    res.json({ id, mensajes: await conversations.messages(id) });
  }));

  return router;
}
