import type pg from 'pg';
import { describe, expect, it } from 'vitest';
import { pool } from '../helpers.js';

// Pruebas PB-01 a PB-18 de 05_Plan_Pruebas_y_Reportes.md, ejecutadas sobre el esquema real.
// Cada caso corre en una transacción que se revierte para no alterar los datos de las demás pruebas.

async function inTx<T>(fn: (c: pg.PoolClient) => Promise<T>, usuario = '1', origen = 'online'): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(`SELECT set_config('app.usuario_id', $1, true), set_config('app.origen', $2, true)`, [usuario, origen]);
    return await fn(c);
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }
}

const one = async <T = Record<string, string>>(c: pg.PoolClient, sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows[0] as T;

describe('Reglas de negocio en PostgreSQL (PB-01 … PB-18)', () => {
  it('el seed reproduce los saldos esperados del plan de pruebas', async () => {
    const rows = (await pool.query(`SELECT estado, cantidad FROM existencia WHERE producto_id = 1 ORDER BY estado`)).rows;
    expect(rows).toEqual([
      { estado: 'disponible', cantidad: '232.0000' },
      { estado: 'danada', cantidad: '3.0000' },
    ]);
    expect((await pool.query('SELECT fn_precio_vigente(1) AS p')).rows[0].p).toBe('33750.00');
  });

  it('PB-01 compra: aumenta existencia, recalcula costo promedio y precio, y registra kardex y auditoría', () =>
    inTx(async (c) => {
      const lote = await one(c, `INSERT INTO lote(producto_id, cantidad_recibida, cantidad_disponible, costo_unitario) VALUES (1, 10, 0, 26000) RETURNING id`);
      const compra = await one(c, `INSERT INTO compra(numero, proveedor_id, usuario_id, total) VALUES ('ING-PRUEBA-001', 1, 3, 260000) RETURNING id`);
      await c.query(`INSERT INTO compra_detalle(compra_id, producto_id, cantidad, unidad_id, costo_unitario, subtotal, lote_id) VALUES ($1, 1, 10, 1, 26000, 260000, $2)`, [compra.id, lote.id]);
      await c.query('SELECT fn_aplicar_entrada_compra(1, 10, 1, 26000, $1, 3, $2)', [lote.id, compra.id]);
      const r = await one(c, `SELECT e.cantidad, ph.costo_promedio, ph.precio_calculado FROM existencia e
        JOIN precio_historial ph ON ph.producto_id = e.producto_id AND ph.vigente_hasta IS NULL WHERE e.producto_id = 1 AND e.estado = 'disponible'`);
      expect(r.cantidad).toBe('242.0000');
      // (232 × 25.000 + 10 × 26.000) / 242 = 25.041,3223 ; × 1,35 = 33.805,79
      expect(r.costo_promedio).toBe('25041.3223');
      expect(r.precio_calculado).toBe('33805.79');
      expect((await one(c, `SELECT count(*) AS n FROM precio_historial WHERE producto_id = 1 AND vigente_hasta IS NULL`)).n).toBe(1);
      const aud = await one(c, `SELECT count(*) AS n FROM auditoria WHERE tabla_afectada = 'movimiento_inventario' AND valores_despues->>'documento_id' = $1::text`, [compra.id]);
      expect(Number(aud.n)).toBe(1);
    }, '3'));

  it('PB-02 / PB-18 venta: descuenta disponible y consume el lote más antiguo (FIFO)', () =>
    inTx(async (c) => {
      const antes = (await c.query(`SELECT id, cantidad_disponible FROM lote WHERE producto_id = 1 AND cantidad_disponible > 0 ORDER BY fecha_ingreso, id`)).rows;
      const v = await one(c, `INSERT INTO venta(numero, cliente_id, usuario_id, subtotal, impuesto, total) VALUES ('FAC-PRUEBA-001', 3, 4, 67500, 0, 67500) RETURNING id`);
      await c.query('SELECT fn_aplicar_salida_venta(1, 2, 1, NULL, 4, $1)', [v.id]);
      expect((await one(c, `SELECT cantidad FROM existencia WHERE producto_id = 1 AND estado = 'disponible'`)).cantidad).toBe('230.0000');
      const lote = await one(c, 'SELECT cantidad_disponible FROM lote WHERE id = $1', [antes[0].id]);
      expect(Number(lote.cantidad_disponible)).toBe(Number(antes[0].cantidad_disponible) - 2);
    }, '4'));

  it('PB-03 rechaza stock negativo sin modificar existencias', async () => {
    await expect(inTx((c) => c.query('SELECT fn_aplicar_salida_venta(1, 99999, 1, NULL, 4, 99999)'), '4')).rejects.toThrow(/Stock insuficiente/);
    expect((await pool.query(`SELECT cantidad FROM existencia WHERE producto_id = 1 AND estado = 'disponible'`)).rows[0].cantidad).toBe('232.0000');
  });

  it('PB-04 rechaza código de barras duplicado', async () => {
    await expect(
      inTx((c) => c.query(`INSERT INTO producto(codigo_barras, nombre, marca_id, presentacion, unidad_base_id) VALUES ('7701234500011', 'Duplicado', 1, 'Unidad', 1)`)),
    ).rejects.toMatchObject({ code: '23505', constraint: 'producto_codigo_barras_key' });
  });

  it('PB-05 rechaza persona natural sin nombre y apellido', async () => {
    await expect(
      inTx((c) => c.query(`INSERT INTO tercero(tipo_persona, tipo_documento, numero_documento, es_cliente) VALUES ('natural', 'cedula', '9999999', TRUE)`)),
    ).rejects.toMatchObject({ constraint: 'chk_persona_natural' });
  });

  it('PB-06 la auditoría registra usuario, origen y llave compuesta producto:estado, sin hashes de contraseña', async () => {
    const r = (await pool.query(`SELECT registro_id, usuario_id, origen FROM auditoria WHERE tabla_afectada = 'existencia' ORDER BY id LIMIT 1`)).rows[0];
    expect(r.registro_id).toMatch(/^\d+:(disponible|reservada|danada)$/);
    expect(r.usuario_id).not.toBeNull();
    expect(r.origen).toBe('online');
    const hashes = (await pool.query(`SELECT count(*) AS n FROM auditoria WHERE (valores_despues ? 'hash_password') OR (valores_antes ? 'hash_password')`)).rows[0];
    expect(hashes.n).toBe(0);
  });

  it('PB-07 rechaza existencia negativa por actualización directa', async () => {
    await expect(inTx((c) => c.query(`UPDATE existencia SET cantidad = -5 WHERE producto_id = 1 AND estado = 'disponible'`))).rejects.toMatchObject({ code: '23514' });
  });

  it('PB-08 cambio de estado: mueve 2 a dañada sin alterar el total', () =>
    inTx(async (c) => {
      const total = async () => (await one(c, 'SELECT SUM(cantidad) AS t FROM existencia WHERE producto_id = 1')).t;
      const t0 = await total();
      await c.query(`SELECT fn_cambiar_estado_existencia(1, 'disponible', 'danada', 2, 2, 'Prueba de daño')`);
      const rows = (await c.query('SELECT estado, cantidad FROM existencia WHERE producto_id = 1 ORDER BY estado')).rows;
      expect(rows).toEqual([{ estado: 'disponible', cantidad: '230.0000' }, { estado: 'danada', cantidad: '5.0000' }]);
      expect(await total()).toBe(t0);
    }, '2'));

  it('PB-09 / PB-10 conversiones de caja y rollo a unidad base', async () => {
    const r = (await pool.query(`SELECT fn_convertir_a_base(6, 2, 'compra', 2) a, fn_convertir_a_base(4, 4, 'compra', 1) b, fn_convertir_a_base(4, 3, 'venta', 12.50) c`)).rows[0];
    expect(r).toEqual({ a: '200.0000', b: '100.0000', c: '12.5000' });
  });

  it('rechaza factores de conversión no positivos y cantidades negativas', async () => {
    await expect(inTx((c) => c.query(`INSERT INTO unidad_conversion(producto_id, unidad_id, tipo, factor_a_base) VALUES (1, 2, 'compra', 0)`))).rejects.toMatchObject({ code: '23514' });
    await expect(pool.query(`SELECT fn_convertir_a_base(1, 1, 'venta', -1)`)).rejects.toThrow(/mayor que cero/);
    await expect(pool.query(`SELECT fn_convertir_a_base(1, 1, 'venta', 1.5)`)).rejects.toThrow(/decimales/);
  });

  it('PB-11 exige fecha de vencimiento al comprar un producto que la controla', async () => {
    await expect(
      inTx(async (c) => {
        const compra = await one(c, `INSERT INTO compra(numero, proveedor_id, usuario_id, total) VALUES ('ING-PRUEBA-VENCE', 1, 3, 100000) RETURNING id`);
        await c.query(`INSERT INTO compra_detalle(compra_id, producto_id, cantidad, unidad_id, costo_unitario, subtotal, lote_id, fecha_vencimiento) VALUES ($1, 3, 2, 1, 50000, 100000, 2, NULL)`, [compra.id]);
      }, '3'),
    ).rejects.toThrow(/requiere fecha de vencimiento/);
  });

  it('PB-12 / PB-13 exige cliente en ventas y proveedor en compras', async () => {
    await expect(inTx((c) => c.query(`INSERT INTO venta(numero, cliente_id, usuario_id, subtotal, impuesto, total) VALUES ('FAC-T', 1, 4, 0, 0, 0)`))).rejects.toThrow(/no es un cliente activo/);
    await expect(inTx((c) => c.query(`INSERT INTO compra(numero, proveedor_id, usuario_id, total) VALUES ('ING-T', 3, 3, 0)`))).rejects.toThrow(/no es un proveedor activo/);
  });

  it('PB-14 precio manual: cierra la vigencia anterior y prevalece sobre el calculado', () =>
    inTx(async (c) => {
      await c.query('SELECT fn_registrar_precio_manual(1, 35000, 2)');
      const rows = (await c.query('SELECT precio_manual, vigente_hasta FROM precio_historial WHERE producto_id = 1 ORDER BY id')).rows;
      expect(rows.at(-1)).toMatchObject({ precio_manual: '35000.00', vigente_hasta: null });
      expect(rows.at(-2).vigente_hasta).not.toBeNull();
      expect((await one(c, 'SELECT fn_precio_vigente(1) AS p')).p).toBe('35000.00');
    }, '2'));

  it('PB-15 cierre mensual: fotografía, impide segundo cierre y bloquea movimientos del período', () =>
    inTx(async (c) => {
      // Período histórico sin conflictos de integración pendientes (otras pruebas dejan conflictos en el mes actual).
      const periodo = '2019-03';
      await c.query(`SELECT fn_ejecutar_cierre_mensual($1::char(7), 1, 'Cierre de prueba')`, [periodo]);
      const det = await one(c, `SELECT count(*) AS n FROM cierre_mensual_detalle d JOIN cierre_mensual m ON m.id = d.cierre_id WHERE m.periodo = $1`, [periodo]);
      expect(Number(det.n)).toBeGreaterThan(0);
      await c.query('SAVEPOINT s1');
      await expect(c.query(`SELECT fn_ejecutar_cierre_mensual($1::char(7), 1, NULL)`, [periodo])).rejects.toThrow(/ya tiene cierre/);
      await c.query('ROLLBACK TO SAVEPOINT s1');
      await expect(
        c.query(`INSERT INTO venta(numero, cliente_id, fecha, usuario_id, subtotal, impuesto, total) VALUES ('FAC-POST-CIERRE', 3, '2019-03-15', 4, 0, 0, 0)`),
      ).rejects.toThrow(/está cerrado/);
    }));

  it('PB-16 auditoría y cierres no se pueden modificar, borrar ni truncar', async () => {
    await expect(inTx((c) => c.query(`UPDATE auditoria SET accion = 'update' WHERE id = (SELECT min(id) FROM auditoria)`))).rejects.toThrow(/inmutable/);
    await expect(inTx((c) => c.query('DELETE FROM auditoria'))).rejects.toThrow(/inmutable/);
    await expect(inTx((c) => c.query('TRUNCATE auditoria'))).rejects.toThrow(/inmutable/);
    await expect(inTx((c) => c.query('UPDATE movimiento_inventario SET cantidad = 1'))).rejects.toThrow(/inmutable/);
  });

  it('RN-06 documentos confirmados no se editan ni se borran; solo se anulan', async () => {
    await expect(inTx((c) => c.query(`UPDATE venta SET total = 1 WHERE id = 3`))).rejects.toThrow(/no se editan/);
    await expect(inTx((c) => c.query(`DELETE FROM compra WHERE id = 1`))).rejects.toThrow(/no se eliminan/);
    await inTx(async (c) => {
      await c.query(`SELECT fn_anular_documento('venta', 3, 1, 'Error de digitación')`);
      expect(await one(c, 'SELECT estado, motivo_anulacion FROM venta WHERE id = 3')).toEqual({ estado: 'anulado', motivo_anulacion: 'Error de digitación' });
    });
  });

  it('RN-18 los usuarios no se eliminan', async () => {
    await expect(inTx((c) => c.query('DELETE FROM usuario WHERE id = 6'))).rejects.toThrow(/no se eliminan/);
  });

  it('PB-17 idempotencia: un identificador externo repetido se rechaza', async () => {
    await expect(
      inTx(async (c) => {
        await c.query(`INSERT INTO integracion_evento(sistema_origen, tipo_evento, identificador_externo, payload) VALUES ('app-movil-01', 'venta', 'uuid-prueba-001', '{}')`);
        await c.query(`INSERT INTO integracion_evento(sistema_origen, tipo_evento, identificador_externo, payload) VALUES ('app-movil-01', 'venta', 'uuid-prueba-001', '{}')`);
      }, '4', 'offline'),
    ).rejects.toMatchObject({ constraint: 'integracion_evento_identificador_externo_key' });
  });

  it('RF-MOV-001 la suma del kardex coincide con las existencias y los lotes con el total físico', async () => {
    expect((await pool.query('SELECT * FROM fn_verificar_kardex()')).rowCount).toBe(0);
    expect((await pool.query('SELECT * FROM fn_verificar_lotes()')).rowCount).toBe(0);
  });
});
