import { queryOne } from '../../db/pool.js';
import { logger } from '../../lib/logger.js';
import { runClosure } from './admin.routes.js';

/**
 * Tarea programada de cierre (RF-CIE-001). Desactivada por defecto (DP-14, CIERRE_AUTOMATICO).
 * Cada hora comprueba si el mes anterior sigue abierto y lo cierra a nombre del primer administrador activo.
 */
export function scheduleMonthlyClosure() {
  const tick = async () => {
    const now = new Date();
    const prev = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const periodo = prev.toISOString().slice(0, 7);
    try {
      if (await queryOne('SELECT 1 FROM cierre_mensual WHERE periodo = $1', [periodo])) return;
      const admin = await queryOne<{ id: number }>(
        `SELECT u.id FROM usuario u JOIN usuario_rol ur ON ur.usuario_id = u.id JOIN rol_permiso rp ON rp.rol_id = ur.rol_id
           JOIN permiso p ON p.id = rp.permiso_id WHERE u.activo AND p.codigo = 'cierre.ejecutar' ORDER BY u.id LIMIT 1`,
      );
      if (!admin) return logger.warn('Cierre automático: no hay usuario con permiso cierre.ejecutar');
      await runClosure(periodo, admin.id, 'Cierre automático programado');
      logger.info({ periodo }, 'Cierre mensual automático ejecutado');
    } catch (error) {
      logger.error({ err: error, periodo }, 'Cierre mensual automático falló; queda pendiente para revisión');
    }
  };
  const timer = setInterval(tick, 3_600_000);
  void tick();
  return () => clearInterval(timer);
}
