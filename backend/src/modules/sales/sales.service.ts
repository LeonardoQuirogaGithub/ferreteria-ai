import type pg from 'pg';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { offset, paginated, type Pagination } from '../../lib/http.js';
import { dec, money } from '../../lib/money.js';
import type { AuthUser } from '../../middlewares/auth.js';

export interface SaleLine {
  producto_id: number;
  cantidad: number;
  unidad_id?: number;
  lote_id?: number | null;
}

export interface SaleInput {
  cliente_id: number;
  medio_pago?: string | null;
  lineas: SaleLine[];
}

export interface SaleOptions {
  canal?: 'online' | 'offline';
  uuidOffline?: string;
}

/**
 * Inserta la venta dentro de una transacción existente. Los precios se toman del precio vigente
 * del servidor; el cliente no envía importes (RF-VEN-001, RN-10, RN-13).
 */
export async function registerIn(db: pg.PoolClient, input: SaleInput, usuarioId: number, opts: SaleOptions = {}) {
  // Orden estable por producto para que ventas concurrentes bloqueen filas en el mismo orden (evita deadlocks).
  const lineas = [...input.lineas].sort((a, b) => a.producto_id - b.producto_id);
  const calculadas = [];
  for (const l of lineas) {
    const p = await queryOne<{ activo: boolean; unidad_base_id: number; nombre: string; precio: string | null }>(
      'SELECT activo, unidad_base_id, nombre, fn_precio_vigente(id) AS precio FROM producto WHERE id = $1',
      [l.producto_id],
      db,
    );
    if (!p) throw businessRule(`El producto ${l.producto_id} no existe`);
    if (!p.activo) throw businessRule(`El producto ${p.nombre} está inactivo`);
    if (p.precio == null) throw businessRule(`El producto ${p.nombre} no tiene precio vigente`);
    const unidadId = l.unidad_id ?? p.unidad_base_id;
    const r = await queryOne<{ factor: string }>(`SELECT fn_factor_conversion($1, $2, 'venta') AS factor`, [l.producto_id, unidadId], db);
    const precioUnitario = money(dec(p.precio).mul(r!.factor));
    calculadas.push({ ...l, unidadId, precioUnitario, subtotal: money(dec(precioUnitario).mul(l.cantidad)) });
  }
  const subtotal = money(calculadas.reduce((acc, l) => acc.add(l.subtotal), dec(0)));

  const venta = await queryOne<{ id: number }>(
    `INSERT INTO venta(numero, cliente_id, usuario_id, subtotal, impuesto, total, medio_pago, canal, uuid_offline)
     VALUES (fn_siguiente_numero('venta'), $1, $2, $3, 0, $3, $4, $5, $6) RETURNING id`,
    [input.cliente_id, usuarioId, subtotal, input.medio_pago ?? null, opts.canal ?? 'online', opts.uuidOffline ?? null],
    db,
  );
  for (const l of calculadas) {
    await query(
      `INSERT INTO venta_detalle(venta_id, producto_id, cantidad, unidad_id, precio_unitario, subtotal, lote_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [venta!.id, l.producto_id, l.cantidad, l.unidadId, l.precioUnitario, l.subtotal, l.lote_id ?? null],
      db,
    );
    // Bloquea la existencia disponible (FOR UPDATE), consume lotes FIFO y registra el kardex.
    await query('SELECT fn_aplicar_salida_venta($1, $2, $3, $4, $5, $6, $7)', [
      l.producto_id, l.cantidad, l.unidadId, l.lote_id ?? null, usuarioId, venta!.id, opts.canal ?? 'online',
    ], db);
  }
  return venta!.id;
}

export async function register(input: SaleInput, user: AuthUser) {
  const id = await withTransaction({ usuarioId: user.id }, (db) => registerIn(db, input, user.id));
  return detail(id);
}

export async function detail(id: number) {
  const venta = await queryOne(
    `SELECT v.id, v.numero, v.fecha, v.estado, v.subtotal, v.impuesto, v.total, v.medio_pago, v.canal, v.uuid_offline,
            v.motivo_anulacion, v.anulado_en, v.cliente_id,
            COALESCE(t.razon_social, concat_ws(' ', t.nombre, t.apellido)) AS cliente, t.numero_documento,
            u.nombre AS usuario
       FROM venta v JOIN tercero t ON t.id = v.cliente_id JOIN usuario u ON u.id = v.usuario_id
      WHERE v.id = $1`,
    [id],
  );
  if (!venta) throw notFound('La venta no existe');
  const lineas = await query(
    `SELECT d.id, d.producto_id, p.nombre AS producto, p.codigo_barras, m.nombre AS marca, p.presentacion,
            d.cantidad, u.codigo AS unidad, d.precio_unitario, d.subtotal, d.lote_id
       FROM venta_detalle d JOIN producto p ON p.id = d.producto_id JOIN marca m ON m.id = p.marca_id
       JOIN unidad_medida u ON u.id = d.unidad_id
      WHERE d.venta_id = $1 ORDER BY d.id`,
    [id],
  );
  return { ...venta, lineas };
}

export async function list(f: Pagination & { desde?: string; hasta?: string; clienteId?: number }) {
  const rows = await query(
    `SELECT v.id, v.numero, v.fecha, v.estado, v.total, v.canal,
            COALESCE(t.razon_social, concat_ws(' ', t.nombre, t.apellido)) AS cliente, u.nombre AS usuario,
            count(*) OVER () AS total_count
       FROM venta v JOIN tercero t ON t.id = v.cliente_id JOIN usuario u ON u.id = v.usuario_id
      WHERE ($1::date IS NULL OR v.fecha >= $1) AND ($2::date IS NULL OR v.fecha < $2::date + 1)
        AND ($3::bigint IS NULL OR v.cliente_id = $3)
      ORDER BY v.fecha DESC, v.id DESC LIMIT $4 OFFSET $5`,
    [f.desde ?? null, f.hasta ?? null, f.clienteId ?? null, f.pageSize, offset(f)],
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), Number(rows[0]?.total_count ?? 0), f);
}

export async function voidSale(id: number, motivo: string, user: AuthUser) {
  await withTransaction({ usuarioId: user.id }, (db) =>
    query(`SELECT fn_anular_documento('venta', $1, $2, $3)`, [id, user.id, motivo], db),
  );
  return detail(id);
}
