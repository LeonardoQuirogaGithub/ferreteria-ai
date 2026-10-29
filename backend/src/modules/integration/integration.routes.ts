import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, IdParam } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as service from './integration.service.js';

export const integrationRouter = Router();
const perm = requirePermission('integracion.ejecutar');

const EventSchema = z.object({
  sistema_origen: z.string().trim().min(1).max(60),
  tipo_evento: z.string().trim().min(1).max(60),
  identificador_externo: z.string().trim().min(1).max(100),
  payload: z.record(z.unknown()),
});

const OfflineSaleSchema = z.object({
  dispositivo: z.string().trim().min(1).max(50),
  uuid_offline: z.string().uuid(),
  fecha_hora_local: z.string().datetime({ offset: true }),
  venta: z.record(z.unknown()),
});

integrationRouter.post('/events', perm, asyncHandler(async (req, res) => {
  const r = await service.receive(EventSchema.parse(req.body), req.user!.id);
  res.status(r.duplicado ? 200 : 201).json(r);
}));

// Sincronización de una venta registrada sin internet: el UUID garantiza que se aplique una sola vez.
integrationRouter.post('/offline/sales', perm, asyncHandler(async (req, res) => {
  const b = OfflineSaleSchema.parse(req.body);
  const r = await service.receive(
    {
      sistema_origen: `offline:${b.dispositivo}`,
      tipo_evento: 'venta',
      identificador_externo: b.uuid_offline,
      payload: { venta: b.venta, fecha_hora_local: b.fecha_hora_local },
    },
    req.user!.id,
    true,
  );
  res.status(r.duplicado ? 200 : 201).json(r);
}));

integrationRouter.get('/events', perm, asyncHandler(async (req, res) => {
  const { estado } = z.object({ estado: z.enum(['pendiente', 'aplicado', 'error', 'pendiente_conflicto']).optional() }).parse(req.query);
  res.json({ data: await service.list(estado) });
}));

integrationRouter.post('/events/:id/retry', requirePermission('cierre.ejecutar'), asyncHandler(async (req, res) => {
  res.json(await service.retry(IdParam.parse(req.params).id, req.user!.id));
}));
