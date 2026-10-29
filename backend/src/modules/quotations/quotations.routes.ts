import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, IdParam, PaginationSchema } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as s from './quotations.schemas.js';
import * as service from './quotations.service.js';

export const quotationsRouter = Router();
const perm = requirePermission('cotizacion.gestionar');

quotationsRouter.get('/', perm, asyncHandler(async (req, res) => {
  const q = PaginationSchema.extend({ q: z.string().trim().max(100).optional() }).parse(req.query);
  res.json(await service.list(q, req.user!));
}));

// Cotización de productos y cantidades: precios del servidor, sin guardar.
quotationsRouter.post('/calculate', perm, asyncHandler(async (req, res) => {
  res.json(await service.priceLines(s.CalculateSchema.parse(req.body).items));
}));

// Estimación de materiales de pintura + valoración con el catálogo real, sin guardar.
quotationsRouter.post('/paint/calculate', perm, asyncHandler(async (req, res) => {
  res.json(await service.calculatePaint(s.PaintParamsSchema.parse(req.body)));
}));

quotationsRouter.post('/', perm, asyncHandler(async (req, res) => {
  res.status(201).json(await service.save(s.SaveQuotationSchema.parse(req.body), req.user!));
}));

quotationsRouter.get('/:id', perm, asyncHandler(async (req, res) => {
  const raw = req.params.id;
  const ref = /^\d+$/.test(raw) ? Number(raw) : z.string().regex(/^COT-\d{1,10}$/i).parse(raw);
  res.json(await service.detail(ref, req.user!));
}));

quotationsRouter.patch('/:id', perm, asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  res.json(await service.patch(id, s.PatchQuotationSchema.parse(req.body), req.user!));
}));
