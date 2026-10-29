import { query, queryOne, type Db } from '../../db/pool.js';

export const brands = () => query('SELECT id, nombre FROM marca ORDER BY nombre');
export const categories = () =>
  query(
    `SELECT c.id, c.nombre, c.categoria_padre_id, p.nombre AS categoria_padre
       FROM categoria c LEFT JOIN categoria p ON p.id = c.categoria_padre_id
      ORDER BY COALESCE(p.nombre, c.nombre), c.categoria_padre_id NULLS FIRST, c.nombre`,
  );
export const units = () => query('SELECT id, codigo, nombre, permite_decimal FROM unidad_medida ORDER BY codigo');

export const insertBrand = async (nombre: string, db: Db) =>
  (await queryOne<{ id: number }>('INSERT INTO marca(nombre) VALUES ($1) RETURNING id, nombre', [nombre], db))!;

export async function insertCategory(nombre: string, padreId: number | null, db: Db) {
  // UNIQUE(nombre, padre) no detecta duplicados en la raíz porque NULL <> NULL.
  const dup = await queryOne(
    'SELECT 1 FROM categoria WHERE lower(nombre) = lower($1) AND categoria_padre_id IS NOT DISTINCT FROM $2',
    [nombre, padreId],
    db,
  );
  if (dup) return null;
  return (await queryOne(
    'INSERT INTO categoria(nombre, categoria_padre_id) VALUES ($1, $2) RETURNING id, nombre, categoria_padre_id',
    [nombre, padreId],
    db,
  ))!;
}

export const insertUnit = async (codigo: string, nombre: string, permiteDecimal: boolean, db: Db) =>
  (await queryOne(
    'INSERT INTO unidad_medida(codigo, nombre, permite_decimal) VALUES (upper($1), $2, $3) RETURNING id, codigo, nombre, permite_decimal',
    [codigo, nombre, permiteDecimal],
    db,
  ))!;
