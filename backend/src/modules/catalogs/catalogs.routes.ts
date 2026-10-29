import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../../db/pool.js';
import { conflict } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';
import * as repo from './catalogs.repository.js';

// RF-CAT-001: marcas, categorías y unidades.
export const catalogsRouter = Router();
const read = requirePermission('inventario.consultar');
const write = requirePermission('producto.gestionar');

const Nombre = z.string().trim().min(1).max(100);
const CategorySchema = z.object({ nombre: Nombre, categoria_padre_id: z.number().int().positive().nullish() });
const UnitSchema = z.object({
  codigo: z.string().trim().regex(/^[A-Za-z0-9]{1,10}$/, 'Código de 1 a 10 caracteres alfanuméricos'),
  nombre: z.string().trim().min(1).max(50),
  permite_decimal: z.boolean(),
});

catalogsRouter.get('/brands', read, asyncHandler(async (_req, res) => res.json({ data: await repo.brands() })));
catalogsRouter.get('/categories', read, asyncHandler(async (_req, res) => res.json({ data: await repo.categories() })));
catalogsRouter.get('/units', read, asyncHandler(async (_req, res) => res.json({ data: await repo.units() })));

catalogsRouter.post('/brands', write, asyncHandler(async (req, res) => {
  const { nombre } = z.object({ nombre: Nombre }).parse(req.body);
  res.status(201).json(await withTransaction({ usuarioId: req.user!.id }, (db) => repo.insertBrand(nombre, db)));
}));

catalogsRouter.post('/categories', write, asyncHandler(async (req, res) => {
  const { nombre, categoria_padre_id } = CategorySchema.parse(req.body);
  const row = await withTransaction({ usuarioId: req.user!.id }, (db) => repo.insertCategory(nombre, categoria_padre_id ?? null, db));
  if (!row) throw conflict('Ya existe esa categoría en el mismo nivel');
  res.status(201).json(row);
}));

catalogsRouter.post('/units', write, asyncHandler(async (req, res) => {
  const u = UnitSchema.parse(req.body);
  res.status(201).json(await withTransaction({ usuarioId: req.user!.id }, (db) => repo.insertUnit(u.codigo, u.nombre, u.permite_decimal, db)));
}));
