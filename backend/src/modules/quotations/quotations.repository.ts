import { env } from '../../config/env.js';
import { query, queryOne, type Db } from '../../db/pool.js';

export interface CatalogItem {
  id: number;
  codigo_barras: string;
  nombre: string;
  marca: string;
  presentacion: string;
  activo: boolean;
  unidad_base_id: number;
  unidad_codigo: string;
  decimales_permitidos: number;
  precio_vigente: string | null;
  disponible: string;
  reservada: string;
  danada: string;
  tipo_producto: string | null;
  linea: string | null;
  superficies: string[] | null;
  acabado: string | null;
  contenido_litros: string | null;
  rendimiento: string | null;
  unidad_rendimiento: 'm2_por_litro' | 'm2_por_unidad' | null;
  manos_recomendadas: number | null;
  fuente: string | null;
}

const SELECT = `
  SELECT p.id, p.codigo_barras, p.nombre, m.nombre AS marca, p.presentacion, p.activo, p.unidad_base_id,
         u.codigo AS unidad_codigo, p.decimales_permitidos, fn_precio_vigente(p.id) AS precio_vigente,
         COALESCE((SELECT cantidad FROM existencia WHERE producto_id = p.id AND estado = 'disponible'), 0) AS disponible,
         COALESCE((SELECT cantidad FROM existencia WHERE producto_id = p.id AND estado = 'reservada'), 0) AS reservada,
         COALESCE((SELECT cantidad FROM existencia WHERE producto_id = p.id AND estado = 'danada'), 0) AS danada,
         f.tipo_producto, f.linea, f.superficies, f.acabado, f.contenido_litros, f.rendimiento, f.unidad_rendimiento,
         f.manos_recomendadas, f.fuente
    FROM producto p
    JOIN marca m ON m.id = p.marca_id
    JOIN unidad_medida u ON u.id = p.unidad_base_id
    LEFT JOIN producto_ficha_tecnica f ON f.producto_id = p.id`;

export const itemsByIds = (ids: number[], db?: Db) => query<CatalogItem>(`${SELECT} WHERE p.id = ANY($1::bigint[])`, [ids], db);

/** Productos activos de un tipo técnico (pintura, sellador, rodillo, ...) con su ficha. */
export const itemsByType = (tipos: string[], db?: Db) =>
  query<CatalogItem>(`${SELECT} WHERE p.activo AND f.tipo_producto = ANY($1::text[]) ORDER BY p.id`, [tipos], db);

export const conversionFactor = async (productoId: number, unidadId: number, db?: Db) =>
  (await queryOne<{ f: string }>(`SELECT fn_factor_conversion($1, $2, 'venta') AS f`, [productoId, unidadId], db))!.f;

export const toBase = async (productoId: number, unidadId: number, cantidad: number, db?: Db) =>
  (await queryOne<{ b: string }>(`SELECT fn_convertir_a_base($1, $2, 'venta', $3) AS b`, [productoId, unidadId, cantidad], db))!.b;

export const unitCode = async (unidadId: number, db?: Db) =>
  (await queryOne<{ codigo: string }>('SELECT codigo FROM unidad_medida WHERE id = $1', [unidadId], db))?.codigo;

/** `vencida` se calcula al consultar (DP-22). */
export const ESTADO_EFECTIVO = `CASE WHEN c.estado = 'emitida' AND c.vence_en < now() THEN 'vencida' ELSE c.estado::text END`;

export async function insertQuotation(
  q: {
    cliente_id: number | null; usuario_id: number; tipo: string; origen: string; descripcion: string | null;
    area_m2: number | null; manos: number | null; parametros: unknown; supuestos: string[]; advertencias: string[];
    observaciones: string | null; total: string; total_disponible: string;
  },
  db: Db,
) {
  return (await queryOne<{ id: number }>(
    `INSERT INTO cotizacion(numero, cliente_id, usuario_id, vence_en, tipo, origen, descripcion_proyecto, area_m2, manos,
                            parametros, supuestos, advertencias, observaciones, total, total_disponible)
     VALUES (fn_siguiente_numero('cotizacion'), $1, $2, now() + make_interval(days => $3), $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     RETURNING id`,
    [q.cliente_id, q.usuario_id, env.COTIZACION_VIGENCIA_DIAS, q.tipo, q.origen, q.descripcion, q.area_m2, q.manos,
     JSON.stringify(q.parametros ?? {}), JSON.stringify(q.supuestos), JSON.stringify(q.advertencias), q.observaciones,
     q.total, q.total_disponible],
    db,
  ))!.id;
}

export async function insertLine(cotizacionId: number, linea: number, l: Record<string, unknown>, db: Db) {
  await query(
    `INSERT INTO cotizacion_detalle(cotizacion_id, linea, producto_id, rol, codigo_barras, nombre, marca, presentacion, unidad_codigo,
                                    cantidad_necesaria, unidad_necesaria, cantidad, cantidad_base, precio_unitario, subtotal,
                                    disponible_al_cotizar, disponibilidad)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
    [cotizacionId, linea, l.producto_id, l.rol, l.codigo_barras, l.nombre, l.marca, l.presentacion, l.unidad_codigo,
     l.cantidad_necesaria ?? null, l.unidad_necesaria ?? null, l.cantidad, l.cantidad_base, l.precio_unitario, l.subtotal,
     l.disponible, l.disponibilidad],
    db,
  );
}

export interface QuotationHeader {
  id: number;
  numero: string;
  usuario_id: number;
  estado: string;
  estado_efectivo: string;
  creada_en: string;
  vence_en: string;
  total: string;
  total_disponible: string;
  [key: string]: unknown;
}

export const findHeader = (where: 'id' | 'numero', value: number | string) =>
  queryOne<QuotationHeader>(
    `SELECT c.*, ${ESTADO_EFECTIVO} AS estado_efectivo, u.nombre AS usuario,
            COALESCE(t.razon_social, concat_ws(' ', t.nombre, t.apellido)) AS cliente
       FROM cotizacion c JOIN usuario u ON u.id = c.usuario_id LEFT JOIN tercero t ON t.id = c.cliente_id
      WHERE c.${where} = $1`,
    [value],
  );

export const lines = (id: number) =>
  query('SELECT * FROM cotizacion_detalle WHERE cotizacion_id = $1 ORDER BY linea', [id]);

export const list = (f: { usuarioId: number | null; limit: number; offset: number; q?: string }) =>
  query(
    `SELECT c.id, c.numero, c.creada_en, c.vence_en, c.estado, ${ESTADO_EFECTIVO} AS estado_efectivo, c.tipo, c.origen,
            c.descripcion_proyecto, c.total, c.total_disponible, u.nombre AS usuario,
            COALESCE(t.razon_social, concat_ws(' ', t.nombre, t.apellido)) AS cliente, count(*) OVER () AS total_count
       FROM cotizacion c JOIN usuario u ON u.id = c.usuario_id LEFT JOIN tercero t ON t.id = c.cliente_id
      WHERE ($1::bigint IS NULL OR c.usuario_id = $1)
        AND ($4::text IS NULL OR c.numero ILIKE '%' || $4 || '%' OR c.descripcion_proyecto ILIKE '%' || $4 || '%')
      ORDER BY c.creada_en DESC, c.id DESC LIMIT $2 OFFSET $3`,
    [f.usuarioId, f.limit, f.offset, f.q ?? null],
  );

export const updateState = (id: number, estado: string | null, motivo: string | null, observaciones: string | null, db: Db) =>
  query(
    `UPDATE cotizacion SET estado = COALESCE($2::estado_cotizacion, estado), motivo_estado = COALESCE($3, motivo_estado),
            observaciones = COALESCE($4, observaciones), actualizado_en = now() WHERE id = $1`,
    [id, estado, motivo, observaciones],
    db,
  );
