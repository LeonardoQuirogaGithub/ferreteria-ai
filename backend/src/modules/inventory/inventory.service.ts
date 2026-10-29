import { withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { offset, paginated, type Pagination } from '../../lib/http.js';
import { can, type AuthUser } from '../../middlewares/auth.js';
import * as products from '../products/products.repository.js';
import { presentProduct } from '../products/products.service.js';
import * as repo from './inventory.repository.js';

export async function outOfStock(p: Pagination, user?: AuthUser) {
  const rows = await repo.outOfStock(p.pageSize, offset(p));
  return paginated(rows.map((r) => presentProduct(r, user)), rows[0]?.total_count ?? 0, p);
}

export async function lowStock(p: Pagination & { umbral?: number; incluirAgotados?: boolean }, user?: AuthUser) {
  const rows = await repo.lowStock({ umbral: p.umbral, incluirAgotados: p.incluirAgotados ?? true, limit: p.pageSize, offset: offset(p) });
  return paginated(rows.map((r) => presentProduct(r, user)), rows[0]?.total_count ?? 0, p);
}

export async function productStock(productoId: number, user?: AuthUser) {
  const row = await products.findById(productoId);
  if (!row) throw notFound('El producto no existe');
  const lotes = await repo.lots(productoId);
  const verCosto = can(user, 'costo.consultar');
  return {
    producto: presentProduct(row, user),
    existencias: {
      disponible: row.disponible,
      reservada: row.reservada,
      danada: row.danada,
      total: (Number(row.disponible) + Number(row.reservada) + Number(row.danada)).toFixed(4),
      unidad: row.unidad_codigo,
    },
    lotes: lotes.map(({ costo_unitario, ...l }) => (verCosto ? { ...l, costo_unitario } : l)),
    consultado_en: new Date().toISOString(),
  };
}

export async function movements(f: { productoId?: number; tipo?: string; desde?: string; hasta?: string } & Pagination) {
  const rows = await repo.movements({ ...f, limit: f.pageSize, offset: offset(f) });
  return paginated(rows.map(({ total_count: _t, ...r }) => r), Number(rows[0]?.total_count ?? 0), f);
}

export const expiringLots = repo.expiringLots;

/** RF-EST-001: transfiere entre estados sin alterar el total ni permitir negativos. */
export async function transferState(
  t: { producto_id: number; estado_origen: string; estado_destino: string; cantidad: number; motivo: string },
  user: AuthUser,
) {
  if (!(await repo.productExists(t.producto_id))) throw notFound('El producto no existe');
  await withTransaction({ usuarioId: user.id }, (db) =>
    repo.changeState(
      { productoId: t.producto_id, origen: t.estado_origen, destino: t.estado_destino, cantidad: t.cantidad, motivo: t.motivo, usuarioId: user.id },
      db,
    ),
  );
  return productStock(t.producto_id, user);
}
