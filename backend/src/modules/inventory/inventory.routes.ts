import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, PaginationSchema } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as productsService from '../products/products.service.js';
import { ProductQuerySchema } from '../products/products.schemas.js';
import * as service from './inventory.service.js';

export const inventoryRouter = Router();
const read = requirePermission('inventario.consultar');

const Estado = z.enum(['disponible', 'reservada', 'danada']);
export const StateTransferSchema = z
  .object({
    producto_id: z.number().int().positive(),
    estado_origen: Estado,
    estado_destino: Estado,
    cantidad: z.number().positive('La cantidad debe ser mayor que cero'),
    motivo: z.string().trim().min(3).max(200),
  })
  .refine((v) => v.estado_origen !== v.estado_destino, { message: 'Origen y destino deben ser distintos', path: ['estado_destino'] });

const MovementQuery = PaginationSchema.extend({
  productoId: z.coerce.number().int().positive().optional(),
  tipo: z.enum(['entrada_compra', 'salida_venta', 'cambio_estado']).optional(),
  desde: z.string().date().optional(),
  hasta: z.string().date().optional(),
});

inventoryRouter.get('/', read, asyncHandler(async (req, res) => {
  res.json(await productsService.list(ProductQuerySchema.parse(req.query), req.user));
}));

inventoryRouter.get('/out-of-stock', read, asyncHandler(async (req, res) => {
  res.json(await service.outOfStock(PaginationSchema.parse(req.query), req.user));
}));

inventoryRouter.get('/low-stock', read, asyncHandler(async (req, res) => {
  const q = PaginationSchema.extend({
    umbral: z.coerce.number().positive().optional(),
    incluirAgotados: z.enum(['true', 'false']).transform((v) => v === 'true').optional(),
  }).parse(req.query);
  res.json(await service.lowStock(q, req.user));
}));

inventoryRouter.get('/movements', requirePermission('kardex.consultar'), asyncHandler(async (req, res) => {
  res.json(await service.movements(MovementQuery.parse(req.query)));
}));

inventoryRouter.get('/lots', read, asyncHandler(async (req, res) => {
  const q = z.object({
    tipo: z.enum(['vencimiento', 'garantia']).default('vencimiento'),
    dias: z.coerce.number().int().min(0).max(3650).default(60),
    productoId: z.coerce.number().int().positive().optional(),
  }).parse(req.query);
  res.json({ data: await service.expiringLots(q) });
}));

inventoryRouter.post('/state-transfers', requirePermission('inventario.cambiar_estado'), asyncHandler(async (req, res) => {
  res.status(201).json(await service.transferState(StateTransferSchema.parse(req.body), req.user!));
}));

inventoryRouter.get('/:productId', read, asyncHandler(async (req, res) => {
  const { productId } = z.object({ productId: z.coerce.number().int().positive() }).parse(req.params);
  res.json(await service.productStock(productId, req.user));
}));
