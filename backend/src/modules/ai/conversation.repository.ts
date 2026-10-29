import { query, queryOne } from '../../db/pool.js';

export const create = async (usuarioId: number, titulo: string) =>
  (await queryOne<{ id: string }>('INSERT INTO ia_conversacion(usuario_id, titulo) VALUES ($1, $2) RETURNING id', [usuarioId, titulo.slice(0, 120)]))!.id;

/** La conversación solo se recupera si pertenece al usuario de la sesión. */
export const findOwned = (id: string, usuarioId: number) =>
  queryOne<{ id: string }>('SELECT id FROM ia_conversacion WHERE id = $1 AND usuario_id = $2', [id, usuarioId]);

export const history = (id: string, limit: number) =>
  query<{ rol: 'user' | 'assistant'; contenido: string }>(
    `SELECT rol, contenido FROM (
       SELECT id, rol, contenido FROM ia_mensaje WHERE conversacion_id = $1 AND rol IN ('user', 'assistant')
        ORDER BY id DESC LIMIT $2) t
      ORDER BY id`,
    [id, limit],
  );

export async function append(
  conversacionId: string,
  m: { rol: 'user' | 'assistant' | 'tool'; contenido: string; tool_name?: string; tool_calls?: unknown; metadata?: unknown },
) {
  await query(
    'INSERT INTO ia_mensaje(conversacion_id, rol, contenido, tool_name, tool_calls, metadata) VALUES ($1, $2, $3, $4, $5, $6)',
    [conversacionId, m.rol, m.contenido, m.tool_name ?? null, m.tool_calls ? JSON.stringify(m.tool_calls) : null, m.metadata ? JSON.stringify(m.metadata) : null],
  );
  await query('UPDATE ia_conversacion SET actualizada_en = now() WHERE id = $1', [conversacionId]);
}

export const listForUser = (usuarioId: number) =>
  query('SELECT id, titulo, creada_en, actualizada_en FROM ia_conversacion WHERE usuario_id = $1 ORDER BY actualizada_en DESC LIMIT 50', [usuarioId]);

export const messages = (id: string) =>
  query(`SELECT id, rol, contenido, metadata, creado_en FROM ia_mensaje WHERE conversacion_id = $1 AND rol IN ('user', 'assistant') ORDER BY id`, [id]);
