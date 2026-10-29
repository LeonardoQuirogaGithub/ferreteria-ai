import ExcelJS from 'exceljs';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { dec } from '../../lib/money.js';

// RF-MIG-001: Excel → staging (validación fila a fila) → confirmación → tablas definitivas.
// La plantilla de columnas es un supuesto propio (DP-16).

export type ImportType = 'productos' | 'terceros' | 'saldos';

export const TEMPLATES: Record<ImportType, string[]> = {
  productos: [
    'codigo_barras', 'nombre', 'descripcion', 'marca', 'presentacion', 'categoria', 'unidad_base',
    'decimales_permitidos', 'controla_vencimiento', 'controla_garantia', 'porcentaje_incremento', 'stock_minimo',
  ],
  terceros: [
    'tipo_persona', 'tipo_documento', 'numero_documento', 'nombre', 'apellido', 'razon_social', 'direccion',
    'telefono', 'correo', 'es_cliente', 'es_proveedor',
  ],
  saldos: ['codigo_barras', 'cantidad', 'estado', 'costo_unitario', 'fecha_vencimiento', 'referencia_garantia'],
};

type Row = Record<string, string | null>;

function cellText(v: ExcelJS.CellValue): string | null {
  if (v == null) return null;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('text' in v) return String(v.text).trim() || null;
    if ('richText' in v) return v.richText.map((t) => t.text).join('').trim() || null;
  }
  const s = String(v).trim();
  return s === '' ? null : s;
}

export async function parseWorkbook(buffer: Buffer): Promise<Row[]> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) throw businessRule('El archivo no contiene hojas');
  const headers: string[] = [];
  ws.getRow(1).eachCell((cell, col) => {
    headers[col] = (cellText(cell.value) ?? '').toLowerCase().trim();
  });
  const rows: Row[] = [];
  ws.eachRow((row, n) => {
    if (n === 1) return;
    const r: Row = { __fila: String(n) };
    let vacia = true;
    headers.forEach((h, col) => {
      if (!h) return;
      const v = cellText(row.getCell(col).value);
      if (v != null) vacia = false;
      r[h] = v;
    });
    if (!vacia) rows.push(r);
  });
  if (rows.length > 5000) throw businessRule('Máximo 5.000 filas por importación');
  return rows;
}

const asBool = (v: string | null) => (v == null ? null : ['si', 'sí', 'true', '1', 'x', 's'].includes(v.toLowerCase()));
const asNum = (v: string | null) => (v == null || v === '' || Number.isNaN(Number(v.replace(',', '.'))) ? null : Number(v.replace(',', '.')));

export async function template(tipo: ImportType) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(tipo);
  ws.addRow(TEMPLATES[tipo]);
  ws.getRow(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Valida cada fila con las mismas reglas del registro manual y la deja en staging con su error. */
export async function stage(tipo: ImportType, rows: Row[], usuarioId: number, nombreArchivo: string, fechaCorte: string | null) {
  if (tipo === 'saldos' && !fechaCorte) throw businessRule('La fecha de corte es obligatoria para saldos iniciales');
  return withTransaction({ usuarioId }, async (db) => {
    const imp = await queryOne<{ id: string }>(
      'INSERT INTO importacion(tipo, nombre_archivo, fecha_corte, usuario_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [tipo, nombreArchivo, fechaCorte, usuarioId],
      db,
    );
    const marcas = new Map((await query<{ id: number; n: string }>('SELECT id, lower(nombre) AS n FROM marca', [], db)).map((r) => [r.n, r.id]));
    const unidades = new Map((await query<{ id: number; c: string }>('SELECT id, upper(codigo) AS c FROM unidad_medida', [], db)).map((r) => [r.c, r.id]));
    const vistos = new Set<string>();
    let validas = 0;
    let invalidas = 0;

    for (const r of rows) {
      const errores: string[] = [];
      const fila = Number(r.__fila);
      if (tipo === 'productos') {
        const codigo = r.codigo_barras;
        if (!codigo) errores.push('codigo_barras obligatorio');
        else if (vistos.has(codigo)) errores.push('codigo_barras repetido en el archivo');
        else if (await queryOne('SELECT 1 FROM producto WHERE codigo_barras = $1', [codigo], db)) errores.push('codigo_barras ya existe (RN-01)');
        if (codigo) vistos.add(codigo);
        if (!r.nombre) errores.push('nombre obligatorio');
        if (!r.presentacion) errores.push('presentacion obligatoria');
        if (!r.marca || !marcas.has(r.marca.toLowerCase())) errores.push(`marca "${r.marca ?? ''}" no registrada`);
        if (!r.unidad_base || !unidades.has(r.unidad_base.toUpperCase())) errores.push(`unidad_base "${r.unidad_base ?? ''}" no registrada`);
        const decimales = asNum(r.decimales_permitidos) ?? 0;
        const decimalesOk = Number.isInteger(decimales) && decimales >= 0 && decimales <= 4;
        if (!decimalesOk) errores.push('decimales_permitidos debe ser 0 a 4');
        const pct = asNum(r.porcentaje_incremento);
        if (pct == null || pct < 0) errores.push('porcentaje_incremento debe ser un número no negativo');
        const min = asNum(r.stock_minimo);
        if (min == null || min < 0) errores.push('stock_minimo debe ser un número no negativo');
        await query(
          `INSERT INTO staging_producto(importacion_id, fila_origen, codigo_barras, nombre, descripcion, marca, presentacion, categoria,
                                        unidad_base, decimales_permitidos, controla_vencimiento, controla_garantia,
                                        porcentaje_incremento, stock_minimo, error_validacion)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
          [imp!.id, fila, codigo, r.nombre, r.descripcion, r.marca, r.presentacion, r.categoria, r.unidad_base?.toUpperCase() ?? null,
           decimalesOk ? decimales : null, asBool(r.controla_vencimiento) ?? false, asBool(r.controla_garantia) ?? false,
           pct, min, errores.join('; ') || null],
          db,
        );
      } else if (tipo === 'terceros') {
        const tp = r.tipo_persona?.toLowerCase();
        const td = r.tipo_documento?.toLowerCase();
        if (tp !== 'natural' && tp !== 'juridica') errores.push('tipo_persona debe ser natural o juridica');
        if (td !== 'cedula' && td !== 'nit') errores.push('tipo_documento debe ser cedula o nit');
        if (!r.numero_documento) errores.push('numero_documento obligatorio');
        const clave = `${td}:${r.numero_documento}`;
        if (vistos.has(clave)) errores.push('documento repetido en el archivo');
        else if (await queryOne('SELECT 1 FROM tercero WHERE tipo_documento::text = $1 AND numero_documento = $2', [td, r.numero_documento], db)) {
          errores.push('documento ya registrado (RN-11)');
        }
        vistos.add(clave);
        if (tp === 'natural' && (!r.nombre || !r.apellido)) errores.push('persona natural requiere nombre y apellido');
        if (tp === 'juridica' && !r.razon_social) errores.push('persona jurídica requiere razón social');
        const cli = asBool(r.es_cliente) ?? false;
        const prov = asBool(r.es_proveedor) ?? false;
        if (!cli && !prov) errores.push('debe ser cliente, proveedor o ambos');
        if (r.correo && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.correo)) errores.push('correo inválido');
        await query(
          `INSERT INTO staging_tercero(importacion_id, fila_origen, tipo_persona, tipo_documento, numero_documento, nombre, apellido,
                                       razon_social, direccion, telefono, correo, es_cliente, es_proveedor, error_validacion)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [imp!.id, fila, tp ?? null, td ?? null, r.numero_documento, r.nombre, r.apellido, r.razon_social, r.direccion, r.telefono,
           r.correo, cli, prov, errores.join('; ') || null],
          db,
        );
      } else {
        const p = r.codigo_barras
          ? await queryOne<{ id: number; decimales_permitidos: number; controla_vencimiento: boolean; controla_garantia: boolean }>(
              'SELECT id, decimales_permitidos, controla_vencimiento, controla_garantia FROM producto WHERE codigo_barras = $1',
              [r.codigo_barras],
              db,
            )
          : undefined;
        if (!p) errores.push(`producto "${r.codigo_barras ?? ''}" no existe`);
        const cant = asNum(r.cantidad);
        if (cant == null || cant <= 0) errores.push('cantidad debe ser mayor que cero');
        else if (p && !dec(cant).eq(dec(cant).toDecimalPlaces(p.decimales_permitidos))) errores.push(`cantidad excede ${p.decimales_permitidos} decimales`);
        const estado = (r.estado ?? 'disponible').toLowerCase().replace('dañada', 'danada');
        if (!['disponible', 'reservada', 'danada'].includes(estado)) errores.push('estado debe ser disponible, reservada o danada');
        const costo = asNum(r.costo_unitario);
        if (costo == null || costo < 0) errores.push('costo_unitario debe ser un número no negativo');
        const venc = r.fecha_vencimiento && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha_vencimiento) ? r.fecha_vencimiento : null;
        if (r.fecha_vencimiento && !venc) errores.push('fecha_vencimiento debe tener formato AAAA-MM-DD');
        if (p?.controla_vencimiento && !venc) errores.push('el producto exige fecha_vencimiento (RN-09)');
        if (p?.controla_garantia && !r.referencia_garantia) errores.push('el producto exige referencia_garantia (RN-09)');
        await query(
          `INSERT INTO staging_saldo_inicial(importacion_id, fila_origen, codigo_barras, cantidad, estado, costo_unitario,
                                             fecha_vencimiento, referencia_garantia, error_validacion)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [imp!.id, fila, r.codigo_barras, cant, estado, costo, venc, r.referencia_garantia, errores.join('; ') || null],
          db,
        );
      }
      if (errores.length) invalidas++;
      else validas++;
    }
    await query('UPDATE importacion SET filas_validas = $2, filas_invalidas = $3 WHERE id = $1', [imp!.id, validas, invalidas], db);
    return imp!.id;
  });
}

const STAGING: Record<ImportType, string> = {
  productos: 'staging_producto',
  terceros: 'staging_tercero',
  saldos: 'staging_saldo_inicial',
};

export async function get(id: string) {
  const imp = await queryOne<{ id: string; tipo: ImportType }>('SELECT * FROM importacion WHERE id = $1', [id]);
  if (!imp) throw notFound('La importación no existe');
  const filas = await query(`SELECT * FROM ${STAGING[imp.tipo]} WHERE importacion_id = $1 ORDER BY fila_origen`, [id]);
  return { ...imp, filas };
}

/** Carga solo las filas válidas, en una transacción, aplicando de nuevo las reglas de la base. */
export async function confirm(id: string, usuarioId: number) {
  const imp = await queryOne<{ tipo: ImportType; estado: string }>('SELECT tipo, estado FROM importacion WHERE id = $1', [id]);
  if (!imp) throw notFound('La importación no existe');
  if (imp.estado === 'cargada') throw businessRule('La importación ya fue cargada');
  await withTransaction({ usuarioId }, async (db) => {
    let cargadas = 0;
    if (imp.tipo === 'productos') {
      const r = await query(
        `INSERT INTO producto(codigo_barras, nombre, descripcion, marca_id, presentacion, categoria_id, unidad_base_id,
                              decimales_permitidos, controla_vencimiento, controla_garantia, porcentaje_incremento, stock_minimo)
         SELECT s.codigo_barras, s.nombre, s.descripcion, m.id, s.presentacion,
                (SELECT id FROM categoria c WHERE lower(c.nombre) = lower(s.categoria) LIMIT 1),
                u.id, s.decimales_permitidos, s.controla_vencimiento, s.controla_garantia, s.porcentaje_incremento, s.stock_minimo
           FROM staging_producto s
           JOIN marca m ON lower(m.nombre) = lower(s.marca)
           JOIN unidad_medida u ON upper(u.codigo) = s.unidad_base
          WHERE s.importacion_id = $1 AND s.error_validacion IS NULL
         RETURNING id`,
        [id],
        db,
      );
      cargadas = r.length;
    } else if (imp.tipo === 'terceros') {
      const r = await query(
        `INSERT INTO tercero(tipo_persona, tipo_documento, numero_documento, nombre, apellido, razon_social, direccion, telefono,
                             correo, es_cliente, es_proveedor)
         SELECT tipo_persona::tipo_persona, tipo_documento::tipo_documento, numero_documento, nombre, apellido, razon_social,
                direccion, telefono, correo, es_cliente, es_proveedor
           FROM staging_tercero WHERE importacion_id = $1 AND error_validacion IS NULL
         RETURNING id`,
        [id],
        db,
      );
      cargadas = r.length;
    } else {
      const filas = await query<{ codigo_barras: string; cantidad: string; estado: string; costo_unitario: string; fecha_vencimiento: string | null; referencia_garantia: string | null }>(
        'SELECT * FROM staging_saldo_inicial WHERE importacion_id = $1 AND error_validacion IS NULL ORDER BY fila_origen',
        [id],
        db,
      );
      for (const f of filas) {
        await query(
          `SELECT fn_aplicar_saldo_inicial((SELECT id FROM producto WHERE codigo_barras = $1), $2, $3, $4::estado_existencia, $5, $6, $7)`,
          [f.codigo_barras, f.cantidad, f.costo_unitario, f.estado, f.fecha_vencimiento, f.referencia_garantia, usuarioId],
          db,
        );
        cargadas++;
      }
    }
    await query(`UPDATE importacion SET estado = 'cargada', filas_cargadas = $2, cargada_en = now() WHERE id = $1`, [id, cargadas], db);
  });
  return get(id);
}

export const list = () =>
  query(`SELECT i.*, u.nombre AS usuario FROM importacion i JOIN usuario u ON u.id = i.usuario_id ORDER BY i.creada_en DESC LIMIT 100`);
