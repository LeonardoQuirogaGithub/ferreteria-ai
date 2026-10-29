import { query, queryOne, withTransaction } from '../../db/pool.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { dec, money } from '../../lib/money.js';
import { offset, paginated, type Pagination } from '../../lib/http.js';
import { can, type AuthUser } from '../../middlewares/auth.js';

export interface PurchaseLine {
  producto_id: number;
  cantidad: number;
  unidad_id: number;
  costo_unitario: number; // por unidad de compra (DP-08)
  fecha_vencimiento?: string | null;
  referencia_garantia?: string | null;
}

export interface PurchaseInput {
  proveedor_id: number;
  fecha?: string;
  observaciones?: string | null;
  lineas: PurchaseLine[];
}

/**
 * RF-COM-001: compra, documento de ingreso, lotes, existencia, costo promedio, precio y kardex en
 * una sola transacción. Si una línea falla, nada queda registrado (RNF-FIA-001).
 */
export async function register(input: PurchaseInput, user: AuthUser) {
  const id = await withTransaction({ usuarioId: user.id }, async (db) => {
    // Primero se calculan las líneas (conversión y costo base) para insertar el documento completo.
    const lineas = [];
    for (const l of input.lineas) {
      const r = await queryOne<{ base: string; factor: string }>(
        `SELECT fn_convertir_a_base($1, $2, 'compra', $3) AS base, fn_factor_conversion($1, $2, 'compra') AS factor`,
        [l.producto_id, l.unidad_id, l.cantidad],
        db,
      );
      lineas.push({
        ...l,
        cantidadBase: r!.base,
        costoBase: dec(l.costo_unitario).div(r!.factor).toDecimalPlaces(4).toString(),
        subtotal: money(dec(l.cantidad).mul(l.costo_unitario)),
      });
    }
    const total = money(lineas.reduce((acc, l) => acc.add(l.subtotal), dec(0)));

    const compra = await queryOne<{ id: number }>(
      `INSERT INTO compra(numero, proveedor_id, fecha, usuario_id, total, observaciones)
       VALUES (fn_siguiente_numero('compra'), $1, COALESCE($2::timestamptz, now()), $3, $4, $5) RETURNING id`,
      [input.proveedor_id, input.fecha ?? null, user.id, total, input.observaciones ?? null],
      db,
    );

    for (const l of lineas) {
      const lote = await queryOne<{ id: number }>(
        `INSERT INTO lote(producto_id, cantidad_recibida, cantidad_disponible, costo_unitario, fecha_vencimiento, referencia_garantia)
         VALUES ($1, $2, 0, $3, $4, $5) RETURNING id`,
        [l.producto_id, l.cantidadBase, l.costoBase, l.fecha_vencimiento ?? null, l.referencia_garantia ?? null],
        db,
      );
      await query(
        `INSERT INTO compra_detalle(compra_id, producto_id, cantidad, unidad_id, costo_unitario, subtotal, lote_id,
                                    fecha_vencimiento, referencia_garantia)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [compra!.id, l.producto_id, l.cantidad, l.unidad_id, l.costo_unitario, l.subtotal, lote!.id,
         l.fecha_vencimiento ?? null, l.referencia_garantia ?? null],
        db,
      );
      await query('SELECT fn_aplicar_entrada_compra($1, $2, $3, $4, $5, $6, $7)', [
        l.producto_id, l.cantidad, l.unidad_id, l.costoBase, lote!.id, user.id, compra!.id,
      ], db);
    }
    return compra!.id;
  });
  return detail(id, user);
}

export async function detail(id: number, user?: AuthUser) {
  const compra = await queryOne(
    `SELECT c.id, c.numero, c.fecha, c.estado, c.total, c.observaciones, c.motivo_anulacion, c.anulado_en,
            c.proveedor_id, t.razon_social, concat_ws(' ', t.nombre, t.apellido) AS nombre_persona,
            COALESCE(t.razon_social, concat_ws(' ', t.nombre, t.apellido)) AS proveedor, u.nombre AS usuario
       FROM compra c JOIN tercero t ON t.id = c.proveedor_id JOIN usuario u ON u.id = c.usuario_id
      WHERE c.id = $1`,
    [id],
  );
  if (!compra) throw notFound('La compra no existe');
  const lineas = await query(
    `SELECT d.id, d.producto_id, p.nombre AS producto, p.codigo_barras, m.nombre AS marca, p.presentacion,
            d.cantidad, u.codigo AS unidad, d.costo_unitario, d.subtotal, d.lote_id, d.fecha_vencimiento, d.referencia_garantia
       FROM compra_detalle d JOIN producto p ON p.id = d.producto_id JOIN marca m ON m.id = p.marca_id
       JOIN unidad_medida u ON u.id = d.unidad_id
      WHERE d.compra_id = $1 ORDER BY d.id`,
    [id],
  );
  const verCosto = can(user, 'costo.consultar');
  return {
    ...compra,
    ...(verCosto ? {} : { total: undefined }),
    lineas: lineas.map(({ costo_unitario, subtotal, ...l }) => (verCosto ? { ...l, costo_unitario, subtotal } : l)),
  };
}

export async function list(f: Pagination & { desde?: string; hasta?: string; proveedorId?: number }) {
  const rows = await query(
    `SELECT c.id, c.numero, c.fecha, c.estado, c.total, COALESCE(t.razon_social, concat_ws(' ', t.nombre, t.apellido)) AS proveedor,
            u.nombre AS usuario, count(*) OVER () AS total_count
       FROM compra c JOIN tercero t ON t.id = c.proveedor_id JOIN usuario u ON u.id = c.usuario_id
      WHERE ($1::date IS NULL OR c.fecha >= $1) AND ($2::date IS NULL OR c.fecha < $2::date + 1)
        AND ($3::bigint IS NULL OR c.proveedor_id = $3)
      ORDER BY c.fecha DESC, c.id DESC LIMIT $4 OFFSET $5`,
    [f.desde ?? null, f.hasta ?? null, f.proveedorId ?? null, f.pageSize, offset(f)],
  );
  return paginated(rows.map(({ total_count: _t, ...r }) => r), Number(rows[0]?.total_count ?? 0), f);
}

/** RF-DOC-001. DP-10: no revierte existencias. */
export async function voidPurchase(id: number, motivo: string, user: AuthUser) {
  if (!motivo.trim()) throw businessRule('El motivo de anulación es obligatorio');
  await withTransaction({ usuarioId: user.id }, (db) =>
    query(`SELECT fn_anular_documento('compra', $1, $2, $3)`, [id, user.id, motivo], db),
  );
  return detail(id, user);
}
