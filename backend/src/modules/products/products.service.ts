import { query, withTransaction } from '../../db/pool.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { offset, paginated, type Pagination } from '../../lib/http.js';
import { searchTokens } from '../../lib/search.js';
import { can, type AuthUser } from '../../middlewares/auth.js';
import * as repo from './products.repository.js';
import type { ProductCreate } from './products.schemas.js';

/** Vista pública de un producto: el costo solo se incluye con permiso costo.consultar (DP-03). */
export function presentProduct(row: repo.ProductRow, user?: AuthUser) {
  const { costo_promedio, score: _s, total_count: _t, ...rest } = row;
  const disponible = Number(row.disponible);
  return {
    ...rest,
    estado_stock: !row.activo
      ? 'inactivo'
      : disponible <= 0
        ? 'agotado'
        : disponible <= Number(row.stock_minimo)
          ? 'bajo_minimo'
          : 'normal',
    ...(can(user, 'costo.consultar') ? { costo_promedio } : {}),
  };
}

export async function list(
  filters: { q?: string; marcaId?: number; categoriaId?: number; incluirInactivos?: boolean } & Pagination,
  user?: AuthUser,
) {
  const rows = await repo.search({
    texto: filters.q || undefined,
    tokens: filters.q ? searchTokens(filters.q) : [],
    marcaId: filters.marcaId,
    categoriaId: filters.categoriaId,
    incluirInactivos: filters.incluirInactivos,
    limit: filters.pageSize,
    offset: offset(filters),
  });
  return paginated(rows.map((r) => presentProduct(r, user)), rows[0]?.total_count ?? 0, filters);
}

export async function detail(id: number, user?: AuthUser) {
  const row = await repo.findById(id);
  if (!row) throw notFound('El producto no existe');
  const [conversiones, ficha, lotes] = await Promise.all([
    repo.conversions(id),
    repo.technicalSheet(id),
    query(
      `SELECT id, cantidad_recibida, cantidad_disponible, fecha_vencimiento, referencia_garantia, fecha_ingreso
              ${can(user, 'costo.consultar') ? ', costo_unitario' : ''}
         FROM lote WHERE producto_id = $1 AND cantidad_disponible > 0 ORDER BY fecha_ingreso, id`,
      [id],
    ),
  ]);
  return { ...presentProduct(row, user), conversiones, ficha_tecnica: ficha ?? null, lotes };
}

export async function byBarcode(codigo: string, user?: AuthUser) {
  const row = await repo.findByBarcode(codigo);
  if (!row) throw notFound('No existe un producto con ese código de barras');
  return presentProduct(row, user);
}

export async function create(data: ProductCreate, user: AuthUser) {
  const id = await withTransaction({ usuarioId: user.id }, (db) => repo.insert(data, db));
  return detail(id, user);
}

export async function update(id: number, data: Partial<ProductCreate>, user: AuthUser) {
  const actual = await repo.findById(id);
  if (!actual) throw notFound('El producto no existe');
  await withTransaction({ usuarioId: user.id }, async (db) => {
    if (data.unidad_base_id && data.unidad_base_id !== actual.unidad_base_id && (await repo.hasMovements(id, db))) {
      throw businessRule('No se puede cambiar la unidad base de un producto con movimientos');
    }
    const { porcentaje_incremento, ...rest } = data;
    await repo.update(id, rest, db);
    if (porcentaje_incremento !== undefined && porcentaje_incremento !== Number(actual.porcentaje_incremento)) {
      // El cambio de porcentaje recalcula el precio y deja historial (RF-PRE-001).
      await query('SELECT fn_actualizar_porcentaje($1, $2, $3)', [id, porcentaje_incremento, user.id], db);
    }
  });
  return detail(id, user);
}

export async function addConversion(id: number, c: { unidad_id: number; tipo: string; factor_a_base: number }, user: AuthUser) {
  if (!(await repo.findById(id))) throw notFound('El producto no existe');
  await withTransaction({ usuarioId: user.id }, (db) => repo.insertConversion(id, c.unidad_id, c.tipo, c.factor_a_base, db));
  return repo.conversions(id);
}

export async function saveTechnicalSheet(id: number, sheet: Record<string, unknown>, user: AuthUser) {
  if (!(await repo.findById(id))) throw notFound('El producto no existe');
  const s = sheet as Parameters<typeof repo.upsertTechnicalSheet>[0];
  await withTransaction({ usuarioId: user.id }, (db) =>
    repo.upsertTechnicalSheet(
      {
        producto_id: id,
        tipo_producto: s.tipo_producto,
        linea: s.linea ?? null,
        superficies: s.superficies ?? [],
        acabado: s.acabado ?? null,
        contenido_litros: s.contenido_litros ?? null,
        rendimiento: s.rendimiento ?? null,
        unidad_rendimiento: s.unidad_rendimiento ?? null,
        manos_recomendadas: s.manos_recomendadas ?? null,
        compatibilidad: s.compatibilidad ?? null,
        observaciones_fabricante: s.observaciones_fabricante ?? null,
        fuente: s.fuente ?? null,
      },
      db,
    ),
  );
  return repo.technicalSheet(id);
}
