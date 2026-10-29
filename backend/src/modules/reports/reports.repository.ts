import { query, queryOne } from '../../db/pool.js';

// Consultas de solo lectura basadas en R-01 a R-08 de 05_Plan_Pruebas_y_Reportes.md.

/** R-01 valorización (requiere costo.consultar). */
export const valuation = () =>
  query(
    `SELECT p.id AS producto_id, p.codigo_barras, p.nombre, m.nombre AS marca, p.presentacion, e.estado, e.cantidad,
            ph.costo_promedio, ROUND(e.cantidad * ph.costo_promedio, 2) AS valor_total
       FROM existencia e
       JOIN producto p ON p.id = e.producto_id
       JOIN marca m ON m.id = p.marca_id
       JOIN LATERAL (SELECT costo_promedio FROM precio_historial WHERE producto_id = e.producto_id
                      ORDER BY vigente_desde DESC, id DESC LIMIT 1) ph ON TRUE
      WHERE e.cantidad > 0
      ORDER BY valor_total DESC, p.nombre`,
  );

export const inventoryValue = async () =>
  (await queryOne<{ valor: string }>(
    `SELECT COALESCE(SUM(e.cantidad * ph.costo_promedio), 0)::numeric(16,2) AS valor
       FROM existencia e
       JOIN LATERAL (SELECT costo_promedio FROM precio_historial WHERE producto_id = e.producto_id
                      ORDER BY vigente_desde DESC, id DESC LIMIT 1) ph ON TRUE`,
  ))!.valor;

/** R-04 más vendidos; los documentos anulados se excluyen (RF-REP-001). */
export const topSelling = (desde: string | null, hasta: string | null, limit: number) =>
  query(
    `SELECT p.id AS producto_id, p.nombre, m.nombre AS marca, p.presentacion, ub.codigo AS unidad_base,
            SUM(vd.cantidad * fn_factor_conversion(vd.producto_id, vd.unidad_id, 'venta')) AS cantidad_base,
            SUM(vd.subtotal) AS total_facturado
       FROM venta_detalle vd
       JOIN venta v ON v.id = vd.venta_id AND v.estado = 'confirmado'
       JOIN producto p ON p.id = vd.producto_id
       JOIN marca m ON m.id = p.marca_id
       JOIN unidad_medida ub ON ub.id = p.unidad_base_id
      WHERE ($1::date IS NULL OR v.fecha >= $1) AND ($2::date IS NULL OR v.fecha < $2::date + 1)
      GROUP BY p.id, p.nombre, m.nombre, p.presentacion, ub.codigo
      ORDER BY total_facturado DESC, cantidad_base DESC LIMIT $3`,
    [desde, hasta, limit],
  );

export const documentTotals = (tabla: 'compra' | 'venta', desde: string, hasta: string) =>
  queryOne<{ documentos: number; total: string }>(
    `SELECT count(*)::int AS documentos, COALESCE(SUM(total), 0) AS total
       FROM ${tabla} WHERE estado = 'confirmado' AND fecha >= $1::date AND fecha < $2::date + 1`,
    [desde, hasta],
  );

export const documentsByDay = (tabla: 'compra' | 'venta', desde: string, hasta: string) =>
  query(
    `SELECT date_trunc('day', fecha)::date AS dia, count(*)::int AS documentos, SUM(total) AS total
       FROM ${tabla} WHERE estado = 'confirmado' AND fecha >= $1::date AND fecha < $2::date + 1
      GROUP BY 1 ORDER BY 1`,
    [desde, hasta],
  );

export const counters = () =>
  queryOne<{ activos: number; agotados: number; bajo_minimo: number }>(
    `WITH d AS (
       SELECT p.id, p.stock_minimo,
              COALESCE((SELECT cantidad FROM existencia WHERE producto_id = p.id AND estado = 'disponible'), 0) AS disp
         FROM producto p WHERE p.activo)
     SELECT count(*)::int AS activos,
            count(*) FILTER (WHERE disp = 0)::int AS agotados,
            count(*) FILTER (WHERE disp > 0 AND disp <= stock_minimo)::int AS bajo_minimo
       FROM d`,
  );

export const recentActivity = (limit: number) =>
  query(
    `SELECT mi.id, mi.fecha_hora, mi.tipo, mi.cantidad, mi.estado_origen, mi.estado_destino, p.nombre AS producto,
            u.codigo AS unidad, us.nombre AS usuario, COALESCE(c.numero, v.numero) AS documento_numero
       FROM movimiento_inventario mi
       JOIN producto p ON p.id = mi.producto_id
       JOIN unidad_medida u ON u.id = p.unidad_base_id
       JOIN usuario us ON us.id = mi.usuario_id
       LEFT JOIN compra c ON mi.documento_tipo = 'compra' AND c.id = mi.documento_id
       LEFT JOIN venta v ON mi.documento_tipo = 'venta' AND v.id = mi.documento_id
      ORDER BY mi.fecha_hora DESC, mi.id DESC LIMIT $1`,
    [limit],
  );
