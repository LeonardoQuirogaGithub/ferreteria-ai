import { query, queryOne, withTransaction } from '../../db/pool.js';
import { AppError, businessRule, mapDatabaseError, notFound } from '../../lib/errors.js';
import { SaleSchema } from '../sales/sales.routes.js';
import { registerIn } from '../sales/sales.service.js';

// RF-OFF-001 y RF-INT-001: cada evento se identifica de forma única y se aplica una sola vez (RN-16).
// Un evento que viola una regla (saldo, período, cliente) queda en "pendiente_conflicto" sin tocar existencias.

export interface IncomingEvent {
  sistema_origen: string;
  tipo_evento: string;
  identificador_externo: string;
  payload: unknown;
}

interface EventRow {
  id: number;
  estado: string;
  identificador_externo: string;
  resultado: unknown;
  mensaje_error: string | null;
  intentos: number;
  tipo_evento: string;
  payload: unknown;
  sistema_origen: string;
}

const SUPPORTED = new Set(['venta']); // DP-17 / DP-18

async function apply(evento: EventRow, usuarioId: number, offline: boolean) {
  try {
    if (!SUPPORTED.has(evento.tipo_evento)) throw businessRule(`Tipo de evento no soportado: ${evento.tipo_evento}`);
    const venta = SaleSchema.parse((evento.payload as { venta?: unknown })?.venta ?? evento.payload);
    const ventaId = await withTransaction({ usuarioId, origen: offline ? 'offline' : 'online' }, async (db) => {
      const id = await registerIn(db, venta, usuarioId, {
        canal: offline ? 'offline' : 'online',
        uuidOffline: offline ? evento.identificador_externo : undefined,
      });
      const numero = await queryOne<{ numero: string }>('SELECT numero FROM venta WHERE id = $1', [id], db);
      await query(
        `UPDATE integracion_evento SET estado = 'aplicado', fecha_aplicado = now(), mensaje_error = NULL,
                resultado = jsonb_build_object('venta_id', $2::bigint, 'numero', $3::text)
          WHERE id = $1`,
        [evento.id, id, numero!.numero],
        db,
      );
      return id;
    });
    return { estado: 'aplicado', venta_id: ventaId };
  } catch (error) {
    const mapped = error instanceof AppError ? error : mapDatabaseError(error);
    const conflicto = !!mapped && mapped.status < 500;
    const mensaje = mapped?.message ?? 'Error inesperado al aplicar el evento';
    await query('UPDATE integracion_evento SET estado = $2, mensaje_error = $3 WHERE id = $1', [
      evento.id, conflicto ? 'pendiente_conflicto' : 'error', mensaje,
    ]);
    return { estado: conflicto ? 'pendiente_conflicto' : 'error', mensaje_error: mensaje };
  }
}

export async function receive(e: IncomingEvent, usuarioId: number, offline = false) {
  const inserted = await withTransaction({ usuarioId, origen: offline ? 'offline' : 'online' }, (db) =>
    queryOne<EventRow>(
      `INSERT INTO integracion_evento(sistema_origen, tipo_evento, identificador_externo, payload)
       VALUES ($1, $2, $3, $4) ON CONFLICT (identificador_externo) DO NOTHING RETURNING *`,
      [e.sistema_origen, e.tipo_evento, e.identificador_externo, JSON.stringify(e.payload)],
      db,
    ),
  );
  if (!inserted) {
    const existing = await queryOne<EventRow>('SELECT * FROM integracion_evento WHERE identificador_externo = $1', [e.identificador_externo]);
    return { duplicado: true, evento: existing };
  }
  const resultado = await apply(inserted, usuarioId, offline);
  return { duplicado: false, resultado, evento: await queryOne('SELECT * FROM integracion_evento WHERE id = $1', [inserted.id]) };
}

/** Revisión manual de un conflicto (estado pendiente_conflicto → aplicado). */
export async function retry(id: number, usuarioId: number) {
  const evento = await queryOne<EventRow>('SELECT * FROM integracion_evento WHERE id = $1', [id]);
  if (!evento) throw notFound('El evento no existe');
  if (evento.estado === 'aplicado') throw businessRule('El evento ya fue aplicado');
  await query('UPDATE integracion_evento SET intentos = intentos + 1 WHERE id = $1', [id]);
  const offline = evento.sistema_origen.startsWith('offline:');
  const resultado = await apply(evento, usuarioId, offline);
  return { resultado, evento: await queryOne('SELECT * FROM integracion_evento WHERE id = $1', [id]) };
}

export const list = (estado?: string) =>
  query(
    `SELECT id, sistema_origen, tipo_evento, identificador_externo, estado, fecha_recibido, fecha_aplicado, mensaje_error, intentos, resultado
       FROM integracion_evento WHERE ($1::estado_integracion IS NULL OR estado = $1)
      ORDER BY fecha_recibido DESC LIMIT 200`,
    [estado ?? null],
  );
