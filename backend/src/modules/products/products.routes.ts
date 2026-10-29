import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, IdParam } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as s from './products.schemas.js';
import * as service from './products.service.js';

export const productsRouter = Router();
const read = requirePermission('inventario.consultar');
const write = requirePermission('producto.gestionar');

productsRouter.get('/', read, asyncHandler(async (req, res) => {
  res.json(await service.list(s.ProductQuerySchema.parse(req.query), req.user));
}));

// Lector de código de barras (RF-LEC-001): un código desconocido responde 404 sin modificar datos.
productsRouter.get('/barcode/:codigo', read, asyncHandler(async (req, res) => {
  const codigo = z.string().trim().min(1).max(50).parse(req.params.codigo);
  res.json(await service.byBarcode(codigo, req.user));
}));

productsRouter.get('/:id', read, asyncHandler(async (req, res) => {
  res.json(await service.detail(IdParam.parse(req.params).id, req.user));
}));

productsRouter.post('/', write, asyncHandler(async (req, res) => {
  res.status(201).json(await service.create(s.ProductCreateSchema.parse(req.body), req.user!));
}));

productsRouter.patch('/:id', write, asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const data = s.ProductUpdateSchema.parse(req.body);
  if (data.porcentaje_incremento !== undefined && !req.user!.permisos.includes('precio.gestionar')) {
    delete data.porcentaje_incremento; // el porcentaje es un dato de precios
  }
  res.json(await service.update(id, data, req.user!));
}));

productsRouter.post('/:id/conversions', requirePermission('conversion.gestionar'), asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  res.status(201).json(await service.addConversion(id, s.ConversionSchema.parse(req.body), req.user!));
}));

productsRouter.put('/:id/technical-sheet', write, asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  res.json(await service.saveTechnicalSheet(id, s.TechnicalSheetSchema.parse(req.body), req.user!));
}));
