import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';
import { badRequest } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as service from './imports.service.js';

export const importsRouter = Router();
const perm = requirePermission('migracion.ejecutar');
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const Tipo = z.enum(['productos', 'terceros', 'saldos']);

importsRouter.get('/', perm, asyncHandler(async (_req, res) => res.json({ data: await service.list() })));

importsRouter.get('/template/:tipo', perm, asyncHandler(async (req, res) => {
  const tipo = Tipo.parse(req.params.tipo);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="plantilla_${tipo}.xlsx"`);
  res.send(await service.template(tipo));
}));

importsRouter.post('/', perm, upload.single('archivo'), asyncHandler(async (req, res) => {
  const { tipo, fecha_corte } = z.object({ tipo: Tipo, fecha_corte: z.string().date().optional() }).parse(req.body);
  if (!req.file) throw badRequest('Adjunte el archivo .xlsx en el campo "archivo"');
  if (!req.file.originalname.toLowerCase().endsWith('.xlsx')) throw badRequest('Solo se aceptan archivos .xlsx');
  const rows = await service.parseWorkbook(req.file.buffer);
  const id = await service.stage(tipo, rows, req.user!.id, req.file.originalname.slice(0, 200), fecha_corte ?? null);
  res.status(201).json(await service.get(id));
}));

importsRouter.get('/:id', perm, asyncHandler(async (req, res) => {
  res.json(await service.get(z.string().uuid().parse(req.params.id)));
}));

importsRouter.post('/:id/confirm', perm, asyncHandler(async (req, res) => {
  res.json(await service.confirm(z.string().uuid().parse(req.params.id), req.user!.id));
}));
