import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import { notFound } from '../../lib/errors.js';
import { asyncHandler, IdParam, offset, paginated, PaginationSchema } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';

// RF-TER-001: clientes, proveedores o ambos. Las reglas RN-11 también se validan en la base (CHECK).
export const thirdPartiesRouter = Router();
const read = requirePermission('tercero.gestionar', 'venta.registrar', 'compra.registrar', 'cotizacion.gestionar');
const write = requirePermission('tercero.gestionar');

const opt = (max: number) => z.string().trim().max(max).nullish().transform((v) => (v ? v : null));
const Base = z.object({
  tipo_persona: z.enum(['natural', 'juridica']),
  tipo_documento: z.enum(['cedula', 'nit']),
  numero_documento: z.string().trim().regex(/^[0-9A-Za-z\-]{3,30}$/, 'Número de documento inválido'),
  nombre: opt(100),
  apellido: opt(100),
  razon_social: opt(200),
  direccion: opt(200), // DP-19: obligatoriedad por definir
  telefono: opt(30),
  correo: z.string().trim().email().max(120).nullish().or(z.literal('')).transform((v) => (v ? v : null)),
  es_cliente: z.boolean(),
  es_proveedor: z.boolean(),
  activo: z.boolean().optional(),
});
export const ThirdPartySchema = Base.refine((v) => v.tipo_persona !== 'natural' || (v.nombre && v.apellido), {
  message: 'Una persona natural requiere nombre y apellido',
  path: ['nombre'],
})
  .refine((v) => v.tipo_persona !== 'juridica' || v.razon_social, {
    message: 'Una persona jurídica requiere razón social',
    path: ['razon_social'],
  })
  .refine((v) => v.es_cliente || v.es_proveedor, {
    message: 'El tercero debe ser cliente, proveedor o ambos',
    path: ['es_cliente'],
  });

const ListQuery = PaginationSchema.extend({
  q: z.string().trim().max(100).optional(),
  rol: z.enum(['cliente', 'proveedor']).optional(),
});

const SELECT = `SELECT id, tipo_persona, tipo_documento, numero_documento, nombre, apellido, razon_social,
  COALESCE(razon_social, concat_ws(' ', nombre, apellido)) AS nombre_completo,
  direccion, telefono, correo, es_cliente, es_proveedor, activo, creado_en FROM tercero`;

thirdPartiesRouter.get('/', read, asyncHandler(async (req, res) => {
  const q = ListQuery.parse(req.query);
  const rows = await query(
    `${SELECT.replace('FROM tercero', ', count(*) OVER () AS total_count FROM tercero')}
      WHERE ($1::text IS NULL OR f_unaccent(lower(concat_ws(' ', nombre, apellido, razon_social, numero_documento)))
                                  LIKE '%' || f_unaccent(lower($1)) || '%')
        AND ($2::text IS NULL OR ($2 = 'cliente' AND es_cliente) OR ($2 = 'proveedor' AND es_proveedor))
      ORDER BY nombre_completo LIMIT $3 OFFSET $4`,
    [q.q ?? null, q.rol ?? null, q.pageSize, offset(q)],
  );
  res.json(paginated(rows.map(({ total_count: _t, ...r }) => r), Number(rows[0]?.total_count ?? 0), q));
}));

thirdPartiesRouter.get('/:id', read, asyncHandler(async (req, res) => {
  const row = await queryOne(`${SELECT} WHERE id = $1`, [IdParam.parse(req.params).id]);
  if (!row) throw notFound('El tercero no existe');
  res.json(row);
}));

thirdPartiesRouter.post('/', write, asyncHandler(async (req, res) => {
  const t = ThirdPartySchema.parse(req.body);
  const row = await withTransaction({ usuarioId: req.user!.id }, (db) =>
    queryOne(
      `INSERT INTO tercero(tipo_persona, tipo_documento, numero_documento, nombre, apellido, razon_social, direccion,
                           telefono, correo, es_cliente, es_proveedor, activo)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,COALESCE($12, TRUE)) RETURNING id`,
      [t.tipo_persona, t.tipo_documento, t.numero_documento, t.nombre, t.apellido, t.razon_social, t.direccion,
       t.telefono, t.correo, t.es_cliente, t.es_proveedor, t.activo ?? null],
      db,
    ),
  );
  res.status(201).json(await queryOne(`${SELECT} WHERE id = $1`, [row!.id]));
}));

thirdPartiesRouter.patch('/:id', write, asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const actual = await queryOne<z.infer<typeof Base>>(`${SELECT} WHERE id = $1`, [id]);
  if (!actual) throw notFound('El tercero no existe');
  // Se valida el registro resultante completo, no solo los campos enviados.
  const t = ThirdPartySchema.parse({ ...actual, ...Base.partial().parse(req.body) });
  await withTransaction({ usuarioId: req.user!.id }, (db) =>
    query(
      `UPDATE tercero SET tipo_persona=$2, tipo_documento=$3, numero_documento=$4, nombre=$5, apellido=$6, razon_social=$7,
              direccion=$8, telefono=$9, correo=$10, es_cliente=$11, es_proveedor=$12, activo=COALESCE($13, activo)
        WHERE id = $1`,
      [id, t.tipo_persona, t.tipo_documento, t.numero_documento, t.nombre, t.apellido, t.razon_social, t.direccion,
       t.telefono, t.correo, t.es_cliente, t.es_proveedor, t.activo ?? null],
      db,
    ),
  );
  res.json(await queryOne(`${SELECT} WHERE id = $1`, [id]));
}));
