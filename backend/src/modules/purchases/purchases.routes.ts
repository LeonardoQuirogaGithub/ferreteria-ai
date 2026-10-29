import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, IdParam, PaginationSchema } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as service from './purchases.service.js';

export const PurchaseSchema = z.object({
  proveedor_id: z.number().int().positive(),
  fecha: z.string().datetime({ offset: true }).optional(),
  observaciones: z.string().trim().max(1000).nullish(),
  lineas: z
    .array(
      z.object({
        producto_id: z.number().int().positive(),
        cantidad: z.number().positive('La cantidad debe ser positiva'),
        unidad_id: z.number().int().positive(),
        costo_unitario: z.number().min(0, 'El costo no puede ser negativo'),
        fecha_vencimiento: z.string().date().nullish(),
        referencia_garantia: z.string().trim().max(100).nullish(),
      }),
    )
    .min(1, 'La compra requiere al menos una línea')
    .max(200),
});

export const VoidSchema = z.object({ motivo: z.string().trim().min(3).max(200) });

export const purchasesRouter = Router();

purchasesRouter.get('/', requirePermission('compra.registrar', 'reporte.consultar'), asyncHandler(async (req, res) => {
  const q = PaginationSchema.extend({
    desde: z.string().date().optional(),
    hasta: z.string().date().optional(),
    proveedorId: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  res.json(await service.list(q));
}));

purchasesRouter.post('/', requirePermission('compra.registrar'), asyncHandler(async (req, res) => {
  res.status(201).json(await service.register(PurchaseSchema.parse(req.body), req.user!));
}));

purchasesRouter.get('/:id', requirePermission('compra.registrar', 'reporte.consultar'), asyncHandler(async (req, res) => {
  res.json(await service.detail(IdParam.parse(req.params).id, req.user));
}));

purchasesRouter.post('/:id/void', requirePermission('documento.anular'), asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  res.json(await service.voidPurchase(id, VoidSchema.parse(req.body).motivo, req.user!));
}));
