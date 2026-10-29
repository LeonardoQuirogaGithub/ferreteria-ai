import { query, queryOne, type Db } from '../../db/pool.js';

export interface ProductRow {
  id: number;
  codigo_barras: string;
  nombre: string;
  descripcion: string | null;
  marca_id: number;
  marca: string;
  categoria_id: number | null;
  categoria: string | null;
  presentacion: string;
  unidad_base_id: number;
  unidad_codigo: string;
  unidad_nombre: string;
  decimales_permitidos: number;
  controla_vencimiento: boolean;
  controla_garantia: boolean;
  porcentaje_incremento: string;
  stock_minimo: string;
  activo: boolean;
  disponible: string;
  reservada: string;
  danada: string;
  precio_vigente: string | null;
  costo_promedio: string | null;
  tiene_precio_manual: boolean;
  score?: number;
  total_count?: number;
}

/** Columnas comunes: existencias por estado y precio vigente leídos de las tablas reales. */
export const PRODUCT_SELECT = `
  p.id, p.codigo_barras, p.nombre, p.descripcion, p.marca_id, m.nombre AS marca,
  p.categoria_id, c.nombre AS categoria, p.presentacion, p.unidad_base_id,
  u.codigo AS unidad_codigo, u.nombre AS unidad_nombre, p.decimales_permitidos,
  p.controla_vencimiento, p.controla_garantia, p.porcentaje_incremento, p.stock_minimo, p.activo,
  COALESCE(ex.disponible, 0) AS disponible, COALESCE(ex.reservada, 0) AS reservada, COALESCE(ex.danada, 0) AS danada,
  COALESCE(ph.precio_manual, ph.precio_calculado) AS precio_vigente, ph.costo_promedio,
  (ph.precio_manual IS NOT NULL) AS tiene_precio_manual`;

export const PRODUCT_JOINS = `
  FROM producto p
  JOIN marca m ON m.id = p.marca_id
  LEFT JOIN categoria c ON c.id = p.categoria_id
  JOIN unidad_medida u ON u.id = p.unidad_base_id
  LEFT JOIN LATERAL (
    SELECT SUM(cantidad) FILTER (WHERE estado = 'disponible') AS disponible,
           SUM(cantidad) FILTER (WHERE estado = 'reservada') AS reservada,
           SUM(cantidad) FILTER (WHERE estado = 'danada') AS danada
      FROM existencia WHERE producto_id = p.id
  ) ex ON TRUE
  LEFT JOIN LATERAL (
    SELECT precio_manual, precio_calculado, costo_promedio
      FROM precio_historial WHERE producto_id = p.id AND vigente_hasta IS NULL
     ORDER BY vigente_desde DESC, id DESC LIMIT 1
  ) ph ON TRUE`;

export interface SearchFilters {
  texto?: string;
  tokens: string[];
  marcaId?: number;
  categoriaId?: number;
  incluirInactivos?: boolean;
  limit: number;
  offset: number;
}

/**
 * Búsqueda por código exacto, o por términos en nombre, descripción, marca, categoría y presentación.
 * Los términos numéricos se comparan como palabra completa para que "12" no coincida con "1200".
 */
export async function search(f: SearchFilters, db?: Db) {
  return query<ProductRow>(
    `WITH base AS (
       SELECT ${PRODUCT_SELECT},
              f_unaccent(lower(concat_ws(' ', p.nombre, p.descripcion, m.nombre, c.nombre, p.presentacion))) AS texto
       ${PRODUCT_JOINS}
       WHERE ($3::boolean OR p.activo)
         AND ($4::bigint IS NULL OR p.marca_id = $4)
         AND ($5::bigint IS NULL OR p.categoria_id = $5 OR c.categoria_padre_id = $5)
     ), scored AS (
       SELECT b.*,
              (SELECT count(*) FROM unnest($2::text[]) t
                WHERE CASE WHEN t ~ '^[0-9]+$' THEN b.texto ~ ('(^|[^0-9])' || t || '([^0-9]|$)')
                           ELSE b.texto LIKE '%' || t || '%' END)::int AS score
         FROM base b
     )
     SELECT s.*, count(*) OVER () AS total_count
       FROM scored s
      WHERE ($1::text IS NULL AND cardinality($2::text[]) = 0)
         OR s.codigo_barras = $1
         OR s.score > 0
      ORDER BY (s.codigo_barras = $1) DESC NULLS LAST, s.score DESC, s.nombre, s.id
      LIMIT $6 OFFSET $7`,
    [f.texto ?? null, f.tokens, f.incluirInactivos ?? false, f.marcaId ?? null, f.categoriaId ?? null, f.limit, f.offset],
    db,
  );
}

export const findById = (id: number, db?: Db) =>
  queryOne<ProductRow>(`SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE p.id = $1`, [id], db);

export const findByBarcode = (codigo: string, db?: Db) =>
  queryOne<ProductRow>(`SELECT ${PRODUCT_SELECT} ${PRODUCT_JOINS} WHERE p.codigo_barras = $1`, [codigo], db);

export const conversions = (productoId: number, db?: Db) =>
  query<{ id: number; unidad_id: number; unidad_codigo: string; unidad_nombre: string; tipo: string; factor_a_base: string }>(
    `SELECT uc.id, uc.unidad_id, u.codigo AS unidad_codigo, u.nombre AS unidad_nombre, uc.tipo, uc.factor_a_base
       FROM unidad_conversion uc JOIN unidad_medida u ON u.id = uc.unidad_id
      WHERE uc.producto_id = $1 ORDER BY uc.tipo, u.codigo`,
    [productoId],
    db,
  );

export interface TechnicalSheet {
  producto_id: number;
  tipo_producto: string;
  linea: string | null;
  superficies: string[];
  acabado: string | null;
  contenido_litros: string | null;
  rendimiento: string | null;
  unidad_rendimiento: 'm2_por_litro' | 'm2_por_unidad' | null;
  manos_recomendadas: number | null;
  compatibilidad: string | null;
  observaciones_fabricante: string | null;
  fuente: string | null;
}

export const technicalSheet = (productoId: number, db?: Db) =>
  queryOne<TechnicalSheet>('SELECT * FROM producto_ficha_tecnica WHERE producto_id = $1', [productoId], db);

export interface ProductInput {
  codigo_barras: string;
  nombre: string;
  descripcion?: string | null;
  marca_id: number;
  presentacion: string;
  categoria_id?: number | null;
  unidad_base_id: number;
  decimales_permitidos: number;
  controla_vencimiento: boolean;
  controla_garantia: boolean;
  porcentaje_incremento: number;
  stock_minimo: number;
  activo?: boolean;
}

export async function insert(p: ProductInput, db: Db) {
  const row = await queryOne<{ id: number }>(
    `INSERT INTO producto(codigo_barras, nombre, descripcion, marca_id, presentacion, categoria_id, unidad_base_id,
                          decimales_permitidos, controla_vencimiento, controla_garantia, porcentaje_incremento, stock_minimo, activo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,COALESCE($13, TRUE)) RETURNING id`,
    [
      p.codigo_barras, p.nombre, p.descripcion ?? null, p.marca_id, p.presentacion, p.categoria_id ?? null, p.unidad_base_id,
      p.decimales_permitidos, p.controla_vencimiento, p.controla_garantia, p.porcentaje_incremento, p.stock_minimo, p.activo ?? null,
    ],
    db,
  );
  return row!.id;
}

const UPDATABLE = [
  'codigo_barras', 'nombre', 'descripcion', 'marca_id', 'presentacion', 'categoria_id', 'unidad_base_id',
  'decimales_permitidos', 'controla_vencimiento', 'controla_garantia', 'stock_minimo', 'activo',
] as const;

export async function update(id: number, changes: Partial<ProductInput>, db: Db) {
  const sets: string[] = [];
  const values: unknown[] = [];
  for (const key of UPDATABLE) {
    if (key in changes) {
      values.push((changes as Record<string, unknown>)[key]);
      sets.push(`${key} = $${values.length}`);
    }
  }
  if (sets.length === 0) return;
  values.push(id);
  await query(`UPDATE producto SET ${sets.join(', ')}, actualizado_en = now() WHERE id = $${values.length}`, values, db);
}

export const hasMovements = async (id: number, db?: Db) =>
  !!(await queryOne('SELECT 1 FROM movimiento_inventario WHERE producto_id = $1 LIMIT 1', [id], db));

export async function insertConversion(productoId: number, unidadId: number, tipo: string, factor: number, db: Db) {
  return (await queryOne<{ id: number }>(
    'INSERT INTO unidad_conversion(producto_id, unidad_id, tipo, factor_a_base) VALUES ($1,$2,$3,$4) RETURNING id',
    [productoId, unidadId, tipo, factor],
    db,
  ))!.id;
}

export async function upsertTechnicalSheet(s: Omit<TechnicalSheet, 'contenido_litros' | 'rendimiento'> & {
  contenido_litros: number | null;
  rendimiento: number | null;
}, db: Db) {
  await query(
    `INSERT INTO producto_ficha_tecnica(producto_id, tipo_producto, linea, superficies, acabado, contenido_litros, rendimiento,
                                        unidad_rendimiento, manos_recomendadas, compatibilidad, observaciones_fabricante, fuente)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (producto_id) DO UPDATE SET
       tipo_producto = EXCLUDED.tipo_producto, linea = EXCLUDED.linea, superficies = EXCLUDED.superficies,
       acabado = EXCLUDED.acabado, contenido_litros = EXCLUDED.contenido_litros, rendimiento = EXCLUDED.rendimiento,
       unidad_rendimiento = EXCLUDED.unidad_rendimiento, manos_recomendadas = EXCLUDED.manos_recomendadas,
       compatibilidad = EXCLUDED.compatibilidad, observaciones_fabricante = EXCLUDED.observaciones_fabricante,
       fuente = EXCLUDED.fuente, actualizado_en = now()`,
    [
      s.producto_id, s.tipo_producto, s.linea, s.superficies, s.acabado, s.contenido_litros, s.rendimiento,
      s.unidad_rendimiento, s.manos_recomendadas, s.compatibilidad, s.observaciones_fabricante, s.fuente,
    ],
    db,
  );
}
