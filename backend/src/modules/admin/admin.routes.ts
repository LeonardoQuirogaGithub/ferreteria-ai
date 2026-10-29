import bcrypt from 'bcryptjs';
import { Router } from 'express';
import { z } from 'zod';
import { query, queryOne, withTransaction } from '../../db/pool.js';
import { businessRule, notFound } from '../../lib/errors.js';
import { asyncHandler, IdParam, offset, paginated, PaginationSchema } from '../../lib/http.js';
import { requirePermission } from '../../middlewares/auth.js';

// Usuarios, roles y permisos (RF-SEG-002), auditoría (RF-AUD-001) y cierres (RF-CIE-001).
export const adminRouter = Router();
const manageUsers = requirePermission('usuario.gestionar');

const Password = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Debe incluir letras')
  .regex(/[0-9]/, 'Debe incluir números');

const UserCreate = z.object({
  nombre: z.string().trim().min(2).max(120),
  correo: z.string().trim().toLowerCase().email().max(120),
  contrasena: Password,
  roles: z.array(z.number().int().positive()).min(1, 'Asigne al menos un rol'),
  activo: z.boolean().default(true),
});
const UserUpdate = z.object({
  nombre: z.string().trim().min(2).max(120).optional(),
  contrasena: Password.optional(),
  roles: z.array(z.number().int().positive()).min(1).optional(),
  activo: z.boolean().optional(),
});

const USER_LIST = `
  SELECT u.id, u.nombre, u.correo, u.activo, u.creado_en,
         COALESCE(json_agg(json_build_object('id', r.id, 'nombre', r.nombre) ORDER BY r.nombre) FILTER (WHERE r.id IS NOT NULL), '[]') AS roles
    FROM usuario u LEFT JOIN usuario_rol ur ON ur.usuario_id = u.id LEFT JOIN rol r ON r.id = ur.rol_id`;

adminRouter.get('/users', manageUsers, asyncHandler(async (_req, res) => {
  res.json({ data: await query(`${USER_LIST} GROUP BY u.id ORDER BY u.nombre`) });
}));

adminRouter.post('/users', manageUsers, asyncHandler(async (req, res) => {
  const u = UserCreate.parse(req.body);
  const hash = await bcrypt.hash(u.contrasena, 12);
  const id = await withTransaction({ usuarioId: req.user!.id }, async (db) => {
    const row = await queryOne<{ id: number }>(
      'INSERT INTO usuario(nombre, correo, hash_password, activo) VALUES ($1, $2, $3, $4) RETURNING id',
      [u.nombre, u.correo, hash, u.activo],
      db,
    );
    await query('INSERT INTO usuario_rol(usuario_id, rol_id) SELECT $1, unnest($2::bigint[])', [row!.id, u.roles], db);
    return row!.id;
  });
  res.status(201).json(await queryOne(`${USER_LIST} WHERE u.id = $1 GROUP BY u.id`, [id]));
}));

adminRouter.patch('/users/:id', manageUsers, asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const u = UserUpdate.parse(req.body);
  if (id === req.user!.id && u.activo === false) throw businessRule('No puede desactivar su propio usuario');
  if (!(await queryOne('SELECT 1 FROM usuario WHERE id = $1', [id]))) throw notFound('El usuario no existe');
  const hash = u.contrasena ? await bcrypt.hash(u.contrasena, 12) : null;
  await withTransaction({ usuarioId: req.user!.id }, async (db) => {
    await query(
      `UPDATE usuario SET nombre = COALESCE($2, nombre), hash_password = COALESCE($3, hash_password), activo = COALESCE($4, activo)
        WHERE id = $1`,
      [id, u.nombre ?? null, hash, u.activo ?? null],
      db,
    );
    if (u.roles) {
      await query('DELETE FROM usuario_rol WHERE usuario_id = $1 AND rol_id <> ALL($2::bigint[])', [id, u.roles], db);
      await query('INSERT INTO usuario_rol(usuario_id, rol_id) SELECT $1, unnest($2::bigint[]) ON CONFLICT DO NOTHING', [id, u.roles], db);
    }
    // Un usuario desactivado pierde sus sesiones de renovación.
    if (u.activo === false) await query('UPDATE sesion_refresh SET revocado_en = now() WHERE usuario_id = $1 AND revocado_en IS NULL', [id], db);
  });
  res.json(await queryOne(`${USER_LIST} WHERE u.id = $1 GROUP BY u.id`, [id]));
}));

adminRouter.get('/roles', manageUsers, asyncHandler(async (_req, res) => {
  res.json({
    data: await query(
      `SELECT r.id, r.nombre, r.descripcion,
              COALESCE(json_agg(p.codigo ORDER BY p.codigo) FILTER (WHERE p.id IS NOT NULL), '[]') AS permisos
         FROM rol r LEFT JOIN rol_permiso rp ON rp.rol_id = r.id LEFT JOIN permiso p ON p.id = rp.permiso_id
        GROUP BY r.id ORDER BY r.id`,
    ),
  });
}));

adminRouter.get('/permissions', manageUsers, asyncHandler(async (_req, res) => {
  res.json({ data: await query('SELECT id, codigo, descripcion FROM permiso ORDER BY codigo') });
}));

// RNF-MAN-001: los permisos de un rol se cambian por configuración.
adminRouter.put('/roles/:id/permissions', manageUsers, asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const { permisos } = z.object({ permisos: z.array(z.string().max(60)).max(100) }).parse(req.body);
  if (id === 1 && !permisos.includes('usuario.gestionar')) {
    throw businessRule('El rol Administrador debe conservar usuario.gestionar');
  }
  await withTransaction({ usuarioId: req.user!.id }, async (db) => {
    await query('DELETE FROM rol_permiso WHERE rol_id = $1 AND permiso_id NOT IN (SELECT id FROM permiso WHERE codigo = ANY($2))', [id, permisos], db);
    await query('INSERT INTO rol_permiso(rol_id, permiso_id) SELECT $1, id FROM permiso WHERE codigo = ANY($2) ON CONFLICT DO NOTHING', [id, permisos], db);
  });
  res.json({ ok: true });
}));

// ---------------------------------------------------------------------------
// Auditoría: solo lectura. La tabla rechaza UPDATE, DELETE y TRUNCATE.
// ---------------------------------------------------------------------------
adminRouter.get('/audit', requirePermission('auditoria.consultar'), asyncHandler(async (req, res) => {
  const q = PaginationSchema.extend({
    tabla: z.string().trim().max(60).optional(),
    usuarioId: z.coerce.number().int().positive().optional(),
    accion: z.enum(['insert', 'update', 'delete']).optional(),
    registroId: z.string().trim().max(100).optional(),
    desde: z.string().date().optional(),
    hasta: z.string().date().optional(),
  }).parse(req.query);
  const rows = await query(
    `SELECT a.id, a.fecha_hora, a.tabla_afectada, a.registro_id, a.accion, a.origen, a.usuario_id, u.nombre AS usuario,
            a.valores_antes, a.valores_despues, count(*) OVER () AS total_count
       FROM auditoria a LEFT JOIN usuario u ON u.id = a.usuario_id
      WHERE ($1::text IS NULL OR a.tabla_afectada = $1) AND ($2::bigint IS NULL OR a.usuario_id = $2)
        AND ($3::text IS NULL OR a.accion = $3) AND ($4::date IS NULL OR a.fecha_hora >= $4)
        AND ($5::date IS NULL OR a.fecha_hora < $5::date + 1) AND ($6::text IS NULL OR a.registro_id = $6)
      ORDER BY a.fecha_hora DESC, a.id DESC LIMIT $7 OFFSET $8`,
    [q.tabla ?? null, q.usuarioId ?? null, q.accion ?? null, q.desde ?? null, q.hasta ?? null, q.registroId ?? null, q.pageSize, offset(q)],
  );
  res.json(paginated(rows.map(({ total_count: _t, ...r }) => r), Number(rows[0]?.total_count ?? 0), q));
}));

adminRouter.get('/audit/tables', requirePermission('auditoria.consultar'), asyncHandler(async (_req, res) => {
  res.json({ data: (await query<{ t: string }>('SELECT DISTINCT tabla_afectada AS t FROM auditoria ORDER BY 1')).map((r) => r.t) });
}));

// ---------------------------------------------------------------------------
// Cierres mensuales (RF-CIE-001, RN-08).
// ---------------------------------------------------------------------------
export async function runClosure(periodo: string, usuarioId: number, observaciones: string | null) {
  return withTransaction({ usuarioId }, async (db) => {
    const r = await queryOne<{ id: number }>('SELECT fn_ejecutar_cierre_mensual($1::char(7), $2, $3) AS id', [periodo, usuarioId, observaciones], db);
    return r!.id;
  });
}

adminRouter.get('/closures', requirePermission('cierre.ejecutar', 'reporte.consultar'), asyncHandler(async (_req, res) => {
  res.json({
    data: await query(
      `SELECT c.id, c.periodo, c.fecha_ejecucion, c.estado, c.valor_total_inventario, c.observaciones, u.nombre AS usuario
         FROM cierre_mensual c JOIN usuario u ON u.id = c.usuario_id ORDER BY c.periodo DESC`,
    ),
  });
}));

adminRouter.get('/closures/pending', requirePermission('cierre.ejecutar'), asyncHandler(async (_req, res) => {
  res.json({
    conflictos: await query(
      `SELECT id, sistema_origen, tipo_evento, identificador_externo, fecha_recibido, mensaje_error
         FROM integracion_evento WHERE estado IN ('pendiente', 'pendiente_conflicto') ORDER BY fecha_recibido`,
    ),
  });
}));

adminRouter.get('/closures/:id', requirePermission('cierre.ejecutar', 'reporte.consultar'), asyncHandler(async (req, res) => {
  const { id } = IdParam.parse(req.params);
  const cierre = await queryOne('SELECT * FROM cierre_mensual WHERE id = $1', [id]);
  if (!cierre) throw notFound('El cierre no existe');
  const detalle = await query(
    `SELECT d.producto_id, p.codigo_barras, p.nombre, d.estado, d.cantidad, d.costo_promedio, d.valor_total
       FROM cierre_mensual_detalle d JOIN producto p ON p.id = d.producto_id WHERE d.cierre_id = $1 ORDER BY p.nombre, d.estado`,
    [id],
  );
  res.json({ ...cierre, detalle });
}));

adminRouter.post('/closures', requirePermission('cierre.ejecutar'), asyncHandler(async (req, res) => {
  const b = z.object({
    periodo: z.string().regex(/^[0-9]{4}-(0[1-9]|1[0-2])$/, 'Formato AAAA-MM'),
    observaciones: z.string().trim().max(1000).nullish(),
  }).parse(req.body);
  const id = await runClosure(b.periodo, req.user!.id, b.observaciones ?? null);
  res.status(201).json(await queryOne('SELECT * FROM cierre_mensual WHERE id = $1', [id]));
}));
