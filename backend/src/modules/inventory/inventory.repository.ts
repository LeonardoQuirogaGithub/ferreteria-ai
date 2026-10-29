import { query, queryOne, type Db } from '../../db/pool.js';
import { PRODUCT_JOINS, PRODUCT_SELECT, type ProductRow } from '../products/products.repository.js';

/** Productos activos con existencia DISPONIBLE igual a cero (la reservada o dañada no cuenta). */
export const outOfStock = (limit: number, offset: number, db?: Db) =>
  query<ProductRow>(
    `SELECT ${PRODUCT_SELECT}, count(*) OVER () AS total_count ${PRODUCT_JOINS}
      WHERE p.activo AND COALESCE(ex.disponible, 0) = 0
      ORDER BY p.nombre, p.id LIMIT $1 OFFSET $2`,
    [limit, offset],
    db,
  );

/**
 * Productos activos que necesitan reposición: disponible <= stock mínimo (R-02),
 * o disponible < umbral si se indica un umbral explícito ("menos de 5 unidades").
 */
export const lowStock = (opts: { umbral?: number; incluirAgotados: boolean; limit: number; offset: number }, db?: Db) =>
  query<ProductRow>(
    `SELECT ${PRODUCT_SELECT}, count(*) OVER () AS total_count ${PRODUCT_JOINS}
      WHERE p.activo
        AND CASE WHEN $1::numeric IS NULL THEN COALESCE(ex.disponible, 0) <= p.stock_minimo
                 ELSE COALESCE(ex.disponible, 0) < $1::numeric END
        AND ($2::boolean OR COALESCE(ex.disponible, 0) > 0)
      ORDER BY COALESCE(ex.disponible, 0), p.nombre LIMIT $3 OFFSET $4`,
    [opts.umbral ?? null, opts.incluirAgotados, opts.limit, opts.offset],
    db,
  );

export const lots = (productoId: number, db?: Db) =>
  query(
    `SELECT id, cantidad_recibida, cantidad_disponible, costo_unitario, fecha_vencimiento, referencia_garantia, fecha_ingreso
       FROM lote WHERE producto_id = $1 ORDER BY fecha_ingreso, id`,
    [productoId],
    db,
  );

export interface MovementFilters {
  productoId?: number;
  tipo?: string;
  desde?: string;
  hasta?: string;
  limit: number;
  offset: number;
}

/** Kardex (RF-MOV-001): orden cronológico con documento y responsable. */
export const movements = (f: MovementFilters, db?: Db) =>
  query(
    `SELECT mi.id, mi.fecha_hora, mi.tipo, mi.cantidad, mi.estado_origen, mi.estado_destino, mi.lote_id,
            mi.documento_tipo, mi.documento_id,
            COALESCE(c.numero, v.numero) AS documento_numero,
            mi.producto_id, p.nombre AS producto, p.codigo_barras, u.codigo AS unidad_codigo,
            us.nombre AS usuario, mi.canal, mi.motivo, count(*) OVER () AS total_count
       FROM movimiento_inventario mi
       JOIN producto p ON p.id = mi.producto_id
       JOIN unidad_medida u ON u.id = p.unidad_base_id
       JOIN usuario us ON us.id = mi.usuario_id
       LEFT JOIN compra c ON mi.documento_tipo = 'compra' AND c.id = mi.documento_id
       LEFT JOIN venta v ON mi.documento_tipo = 'venta' AND v.id = mi.documento_id
      WHERE ($1::bigint IS NULL OR mi.producto_id = $1)
        AND ($2::tipo_movimiento IS NULL OR mi.tipo = $2)
        AND ($3::timestamptz IS NULL OR mi.fecha_hora >= $3)
        AND ($4::timestamptz IS NULL OR mi.fecha_hora < ($4::date + 1))
      ORDER BY mi.fecha_hora, mi.id
      LIMIT $5 OFFSET $6`,
    [f.productoId ?? null, f.tipo ?? null, f.desde ?? null, f.hasta ?? null, f.limit, f.offset],
    db,
  );

/** RF-LOT-001: lotes con saldo que vencen dentro de la ventana, o lotes con garantía. */
export const expiringLots = (opts: { tipo: 'vencimiento' | 'garantia'; dias: number; productoId?: number }, db?: Db) =>
  query(
    `SELECT l.id AS lote_id, l.producto_id, p.nombre AS producto, m.nombre AS marca, p.presentacion,
            l.cantidad_disponible, l.fecha_vencimiento, l.referencia_garantia, l.fecha_ingreso,
            (l.fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer
       FROM lote l JOIN producto p ON p.id = l.producto_id JOIN marca m ON m.id = p.marca_id
      WHERE l.cantidad_disponible > 0
        AND ($3::bigint IS NULL OR l.producto_id = $3)
        AND CASE WHEN $1 = 'vencimiento'
                 THEN l.fecha_vencimiento IS NOT NULL AND l.fecha_vencimiento <= CURRENT_DATE + $2::int
                 ELSE l.referencia_garantia IS NOT NULL END
      ORDER BY l.fecha_vencimiento NULLS LAST, l.fecha_ingreso DESC`,
    [opts.tipo, opts.dias, opts.productoId ?? null],
    db,
  );

export const changeState = (
  p: { productoId: number; origen: string; destino: string; cantidad: number; motivo: string; usuarioId: number },
  db: Db,
) =>
  query('SELECT fn_cambiar_estado_existencia($1, $2, $3, $4, $5, $6)', [
    p.productoId, p.origen, p.destino, p.cantidad, p.usuarioId, p.motivo,
  ], db);

export const productExists = async (id: number, db?: Db) =>
  !!(await queryOne('SELECT 1 FROM producto WHERE id = $1', [id], db));
