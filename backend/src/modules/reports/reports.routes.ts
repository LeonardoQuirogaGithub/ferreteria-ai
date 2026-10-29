import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../../lib/http.js';
import { can, requirePermission } from '../../middlewares/auth.js';
import * as inventory from '../inventory/inventory.repository.js';
import { presentProduct } from '../products/products.service.js';
import * as repo from './reports.repository.js';

export const reportsRouter = Router();
const reports = requirePermission('reporte.consultar');

const Range = z.object({ desde: z.string().date().optional(), hasta: z.string().date().optional() });

function monthRange(r: { desde?: string; hasta?: string }) {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10);
  return { desde: r.desde ?? first, hasta: r.hasta ?? now.toISOString().slice(0, 10) };
}

/** Indicadores del dashboard, todos calculados en el servidor desde la base. */
reportsRouter.get('/dashboard', requirePermission('inventario.consultar'), asyncHandler(async (req, res) => {
  const { desde, hasta } = monthRange(Range.parse(req.query));
  const verReportes = can(req.user, 'reporte.consultar');
  const [contadores, compras, ventas, top, vencimientos, actividad, valor] = await Promise.all([
    repo.counters(),
    verReportes ? repo.documentTotals('compra', desde, hasta) : null,
    verReportes ? repo.documentTotals('venta', desde, hasta) : null,
    verReportes ? repo.topSelling(desde, hasta, 5) : null,
    inventory.expiringLots({ tipo: 'vencimiento', dias: 60 }),
    can(req.user, 'kardex.consultar') ? repo.recentActivity(10) : null,
    can(req.user, 'costo.consultar') ? repo.inventoryValue() : null,
  ]);
  res.json({
    periodo: { desde, hasta },
    productos_activos: contadores!.activos,
    productos_agotados: contadores!.agotados,
    productos_bajo_minimo: contadores!.bajo_minimo,
    valor_inventario: valor,
    compras_periodo: compras,
    ventas_periodo: ventas,
    mas_vendidos: top,
    alertas_vencimiento: vencimientos,
    actividad_reciente: actividad,
  });
}));

reportsRouter.get('/valuation', reports, requirePermission('costo.consultar'), asyncHandler(async (_req, res) => {
  const rows = await repo.valuation();
  res.json({ data: rows, total: rows.reduce((a, r) => a + Number(r.valor_total), 0).toFixed(2) });
}));

reportsRouter.get('/low-stock', reports, asyncHandler(async (req, res) => {
  const rows = await inventory.lowStock({ incluirAgotados: true, limit: 500, offset: 0 });
  res.json({ data: rows.map((r) => presentProduct(r, req.user)) });
}));

reportsRouter.get('/expiring', reports, asyncHandler(async (req, res) => {
  const { dias } = z.object({ dias: z.coerce.number().int().min(0).max(3650).default(60) }).parse(req.query);
  res.json({ data: await inventory.expiringLots({ tipo: 'vencimiento', dias }) });
}));

reportsRouter.get('/warranties', reports, asyncHandler(async (_req, res) => {
  res.json({ data: await inventory.expiringLots({ tipo: 'garantia', dias: 0 }) });
}));

reportsRouter.get('/top-selling', reports, asyncHandler(async (req, res) => {
  const r = Range.extend({ limit: z.coerce.number().int().min(1).max(100).default(20) }).parse(req.query);
  res.json({ data: await repo.topSelling(r.desde ?? null, r.hasta ?? null, r.limit) });
}));

reportsRouter.get('/sales', reports, asyncHandler(async (req, res) => {
  const { desde, hasta } = monthRange(Range.parse(req.query));
  res.json({ periodo: { desde, hasta }, resumen: await repo.documentTotals('venta', desde, hasta), por_dia: await repo.documentsByDay('venta', desde, hasta) });
}));

reportsRouter.get('/purchases', reports, asyncHandler(async (req, res) => {
  const { desde, hasta } = monthRange(Range.parse(req.query));
  res.json({ periodo: { desde, hasta }, resumen: await repo.documentTotals('compra', desde, hasta), por_dia: await repo.documentsByDay('compra', desde, hasta) });
}));
