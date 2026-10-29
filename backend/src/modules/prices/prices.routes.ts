import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler } from '../../lib/http.js';
import { can, requirePermission, type AuthUser } from '../../middlewares/auth.js';
import * as products from '../products/products.repository.js';

// RF-PRE-001 y RF-PRE-002: historial de costos y precios, precio manual y porcentaje.
export const pricesRouter = Router();
const ProductParam = z.object({ productId: z.coerce.number().int().positive() });

async function history(productoId: number, user?: AuthUser) {
  const rows = await query(
    `SELECT ph.id, ph.costo_promedio, ph.porcentaje_incremento, ph.precio_calculado, ph.precio_manual,
            COALESCE(ph.precio_manual, ph.precio_calculado) AS precio_aplicado, ph.motivo,
            ph.vigente_desde, ph.vigente_hasta, (ph.vigente_hasta IS NULL) AS vigente, u.nombre AS usuario
       FROM precio_historial ph LEFT JOIN usuario u ON u.id = ph.usuario_id
      WHERE ph.producto_id = $1 ORDER BY ph.vigente_desde DESC, ph.id DESC`,
    [productoId],
  );
  return can(user, 'costo.consultar') ? rows : rows.map(({ costo_promedio: _c, ...r }) => r);
}

async function ensureProduct(id: number) {
  if (!(await products.findById(id))) throw notFound('El producto no existe');
}

pricesRouter.get('/:productId/history', requirePermission('inventario.consultar'), asyncHandler(async (req, res) => {
  const { productId } = ProductParam.parse(req.params);
  await ensureProduct(productId);
  res.json({ data: await history(productId, req.user) });
}));

pricesRouter.post('/:productId/manual', requirePermission('precio.gestionar'), asyncHandler(async (req, res) => {
  const { productId } = ProductParam.parse(req.params);
  const body = z.object({
    precio_manual: z.number().min(0, 'El precio no puede ser negativo'),
    motivo: z.string().trim().max(200).nullish(),
  }).parse(req.body);
  await ensureProduct(productId);
  await withTransaction({ usuarioId: req.user!.id }, async (db) => {
    await query('SELECT fn_registrar_precio_manual($1, $2, $3)', [productId, body.precio_manual, req.user!.id], db);
    if (body.motivo) {
      await query('UPDATE precio_historial SET motivo = $2 WHERE producto_id = $1 AND vigente_hasta IS NULL', [productId, body.motivo], db);
    }
  });
  res.status(201).json({ data: await history(productId, req.user) });
}));

pricesRouter.post('/:productId/percentage', requirePermission('precio.gestionar'), asyncHandler(async (req, res) => {
  const { productId } = ProductParam.parse(req.params);
  const { porcentaje } = z.object({ porcentaje: z.number().min(0, 'El porcentaje no puede ser negativo').max(999) }).parse(req.body);
  await ensureProduct(productId);
  await withTransaction({ usuarioId: req.user!.id }, (db) =>
    query('SELECT fn_actualizar_porcentaje($1, $2, $3)', [productId, porcentaje, req.user!.id], db),
  );
  res.status(201).json({ data: await history(productId, req.user) });
}));
