import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, IdParam, PaginationSchema } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import { VoidSchema } from '../purchases/purchases.routes.js';
import * as service from './sales.service.js';

export const SaleSchema = z.object({
  cliente_id: z.number().int().positive(),
  medio_pago: z.string().trim().max(30).nullish(),
  lineas: z
    .array(
      z.object({
        producto_id: z.number().int().positive(),
        cantidad: z.number().positive('La cantidad debe ser positiva'),
        unidad_id: z.number().int().positive().optional(),
        lote_id: z.number().int().positive().nullish(),
      }),
    )
    .min(1, 'La venta requiere al menos una línea')
    .max(200),
});

export const salesRouter = Router();

salesRouter.get('/', requirePermission('venta.registrar', 'reporte.consultar'), asyncHandler(async (req, res) => {
  const q = PaginationSchema.extend({
    desde: z.string().date().optional(),
    hasta: z.string().date().optional(),
    clienteId: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  res.json(await service.list(q));
}));

salesRouter.post('/', requirePermission('venta.registrar'), asyncHandler(async (req, res) => {
  res.status(201).json(await service.register(SaleSchema.parse(req.body), req.user!));
}));

salesRouter.get('/:id', requirePermission('venta.registrar', 'reporte.consultar'), asyncHandler(async (req, res) => {
  res.json(await service.detail(IdParam.parse(req.params).id));
}));

salesRouter.post('/:id/void', requirePermission('documento.anular'), asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  res.json(await service.voidSale(id, VoidSchema.parse(req.body).motivo, req.user!));
}));
