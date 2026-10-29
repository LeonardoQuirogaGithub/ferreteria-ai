import { describe, expect, it } from 'vitest';
import { api, count, pool, token } from '../helpers.js';

const habitacion = {
  descripcion_proyecto: 'Habitación 4 × 3 m',
  espacios: [{ nombre: 'Habitación', largo: 4, ancho: 3, alto: 2.5 }],
  aberturas: [
    { tipo: 'puerta', ancho: 0.9, alto: 2 },
    { tipo: 'ventana', ancho: 1.2, alto: 1 },
  ],
  manos: 2,
  desperdicio_pct: 10,
  estado_superficie: 'buena',
};

type Line = { producto_id: number; cantidad: string; precio_unitario: string; subtotal: string; disponibilidad: string; rol: string };

describe('Cotizador de pintura con datos reales del catálogo', () => {
  it('calcula área neta, litros, presentaciones, auxiliares, precios y disponibilidad', async () => {
    const res = await api().post('/api/quotations/paint/calculate').set('Authorization', await token('ventas')).send(habitacion);
    expect(res.status).toBe(200);
    const q = res.body;
    expect(q.estado).toBe('calculado');
    expect(q.areas).toMatchObject({ area_paredes_bruta: '35.00', area_aberturas: '3.00', area_paredes_neta: '32.00', area_neta_total: '32.00' });
    expect(q.pintura[0]).toMatchObject({ litros_necesarios: '7.04', rendimiento_m2_por_litro: '10', manos: 2 });

    const byId = new Map<number, Line>(q.lineas.map((l: Line) => [l.producto_id, l]));
    // 7,04 L → 2 galones de 3,785 L (más económico que un cuñete). Vinilo T2 está agotado y no se elige.
    expect(byId.get(9)).toMatchObject({ cantidad: '2', precio_unitario: '83700.00', subtotal: '167400.00', disponibilidad: 'disponible', rol: 'pintura' });
    expect(byId.has(11)).toBe(false);
    expect(byId.get(14)).toMatchObject({ cantidad: '1', subtotal: '12600.00' }); // rodillo: 1 por 100 m²
    expect(byId.get(16)).toMatchObject({ cantidad: '1' }); // brocha 2": la de 3" está agotada (dañada)
    expect(byId.has(15)).toBe(false);
    expect(byId.get(17)).toMatchObject({ cantidad: '1' });
    expect(byId.get(18)).toMatchObject({ cantidad: '2', disponibilidad: 'agotado' }); // cinta: 6 reservadas, 0 disponibles
    expect(byId.get(19)).toMatchObject({ cantidad: '2' }); // plástico: 1 por 20 m²

    expect(q.total).toBe('219900.00');
    expect(q.total_disponible).toBe('205900.00');
    expect(q.total_faltante).toBe('14000.00');
    expect(q.advertencias.join(' ')).toMatch(/Cinta de enmascarar.*agotado.*reservada 6/);
    expect(q.advertencias.join(' ')).toMatch(/demostración/);
    expect(q.supuestos.join(' ')).toMatch(/No incluye impuestos/);
    expect(q.alternativas.some((a: { para: string }) => a.para === 'pintura de paredes')).toBe(true);
  });

  it('no confunde área construida con área de paredes: pide datos o estima solo con permiso', async () => {
    const auth = await token('ventas');
    const sin = await api().post('/api/quotations/paint/calculate').set('Authorization', auth).send({ area_construccion_m2: 80 });
    expect(sin.body.estado).toBe('faltan_datos');
    expect(sin.body.faltantes[0]).toMatch(/80 m².*no equivale/);
    const con = await api().post('/api/quotations/paint/calculate').set('Authorization', auth).send({ area_construccion_m2: 80, permitir_estimacion: true, manos: 2 });
    expect(con.body.estado).toBe('calculado');
    expect(con.body.areas.area_paredes_neta).toBe('200.00');
    expect(con.body.supuestos[0]).toMatch(/^ESTIMACIÓN/);
  });

  it('incluye techo con su pintura específica y sellador para superficies nuevas', async () => {
    const res = await api().post('/api/quotations/paint/calculate').set('Authorization', await token('ventas'))
      .send({ ...habitacion, incluir_techo: true, estado_superficie: 'nueva', incluir_auxiliares: false });
    const q = res.body;
    expect(q.areas.area_techo).toBe('12.00');
    expect(q.pintura.map((p: { superficie: string }) => p.superficie)).toEqual(['paredes', 'techos']);
    expect(q.lineas.some((l: Line) => l.producto_id === 13)).toBe(true); // sellador
    expect(q.supuestos.join(' ')).toMatch(/Sellador: 44.00 m²/);
  });

  it('marca como pendiente un auxiliar sin rendimiento y no lo suma al total', async () => {
    const res = await api().post('/api/quotations/paint/calculate').set('Authorization', await token('ventas'))
      .send({ ...habitacion, auxiliares: [{ tipo: 'rodillo', producto_id: 24 }] });
    // El rodillo antigota no tiene precio vigente → queda pendiente.
    expect(res.body.pendientes).toEqual(expect.arrayContaining([expect.objectContaining({ tipo: 'rodillo' })]));
    expect(res.body.lineas.some((l: Line) => l.producto_id === 24)).toBe(false);
  });
});

describe('Cotización de productos: precios del servidor, conversiones y validaciones', () => {
  it('convierte unidades y calcula precio unitario y subtotal', async () => {
    const res = await api().post('/api/quotations/calculate').set('Authorization', await token('ventas'))
      .send({ items: [{ producto_id: 4, cantidad: 1, unidad_id: 4 }, { producto_id: 8, cantidad: 3 }] });
    expect(res.status).toBe(200);
    expect(res.body.lineas[0]).toMatchObject({ unidad_codigo: 'ROLLO', cantidad_base: '100.0000', precio_unitario: '252000.00', subtotal: '252000.00', disponibilidad: 'insuficiente' });
    expect(res.body.lineas[1]).toMatchObject({ precio_unitario: '33600.00', subtotal: '100800.00', disponibilidad: 'disponible' });
    expect(res.body.total).toBe('352800.00');
  });

  it('identifica agotados y rechaza productos sin precio vigente o inactivos', async () => {
    const auth = await token('ventas');
    const ag = await api().post('/api/quotations/calculate').set('Authorization', auth).send({ items: [{ producto_id: 11, cantidad: 1 }] });
    expect(ag.body.lineas[0].disponibilidad).toBe('agotado');
    expect(ag.body.total_disponible).toBe('0.00');
    const sinPrecio = await api().post('/api/quotations/calculate').set('Authorization', auth).send({ items: [{ producto_id: 24, cantidad: 1 }, { producto_id: 25, cantidad: 1 }] });
    expect(sinPrecio.status).toBe(422);
    expect(sinPrecio.body.error.details.errores.join(' ')).toMatch(/no tiene precio vigente.*inactivo/);
  });

  it('exige el permiso de cotizaciones', async () => {
    expect((await api().post('/api/quotations/calculate').set('Authorization', await token('compras')).send({ items: [{ producto_id: 1, cantidad: 1 }] })).status).toBe(403);
  });
});

describe('Guardar cotizaciones: revalidación e instantánea histórica', () => {
  it('revalida precios al guardar, conserva la instantánea y no reserva inventario', async () => {
    const auth = await token('ventas');
    const antes = await count(`SELECT count(*) AS n FROM movimiento_inventario`);
    const lineas = [{ producto_id: 9, cantidad: 2, rol: 'pintura', precio_unitario_esperado: 1 }];
    const cambio = await api().post('/api/quotations').set('Authorization', auth).send({ tipo: 'pintura', descripcion_proyecto: 'Sala', lineas });
    expect(cambio.status).toBe(409);
    expect(cambio.body.error.details.cambios[0]).toMatchObject({ precio_esperado: '1.00', precio_actual: '83700.00' });

    const ok = await api().post('/api/quotations').set('Authorization', auth)
      .send({ tipo: 'pintura', descripcion_proyecto: 'Sala', cliente_id: 3, lineas: [{ ...lineas[0], precio_unitario_esperado: 83700 }], supuestos: ['Dos manos'] });
    expect(ok.status).toBe(201);
    expect(ok.body.numero).toMatch(/^COT-\d{6}$/);
    expect(ok.body).toMatchObject({ total: '167400.00', estado_efectivo: 'emitida', cliente: 'Laura Gomez' });
    expect(new Date(ok.body.vence_en).getTime()).toBeGreaterThan(Date.now() + 14 * 86_400_000);
    expect(await count(`SELECT count(*) AS n FROM movimiento_inventario`)).toBe(antes);

    // Cambia el catálogo: la cotización conserva nombre y precio cotizados.
    await api().patch('/api/products/9').set('Authorization', await token('inventario')).send({ nombre: 'Vinilo T1 blanco (renombrado)' }).expect(200);
    await api().post('/api/prices/9/manual').set('Authorization', await token('inventario')).send({ precio_manual: 90000 }).expect(201);
    const det = await api().get(`/api/quotations/${ok.body.numero}`).set('Authorization', auth);
    expect(det.body.lineas[0]).toMatchObject({ nombre: 'Pintura vinilo tipo 1 blanco', precio_unitario: '83700.00' });
    await expect(pool.query('UPDATE cotizacion_detalle SET precio_unitario = 1')).rejects.toThrow(/inmutable/);
    await expect(pool.query('UPDATE cotizacion SET total = 1 WHERE id = $1', [ok.body.id])).rejects.toThrow(/no se modifica/);
  });

  it('cambia el estado: anular exige motivo y una anulada no se acepta', async () => {
    const auth = await token('ventas');
    const q = await api().post('/api/quotations').set('Authorization', auth).send({ lineas: [{ producto_id: 8, cantidad: 1 }] });
    expect((await api().patch(`/api/quotations/${q.body.id}`).set('Authorization', auth).send({ estado: 'anulada' })).status).toBe(400);
    await api().patch(`/api/quotations/${q.body.id}`).set('Authorization', auth).send({ estado: 'anulada', motivo_estado: 'Cliente desistió' }).expect(200);
    expect((await api().patch(`/api/quotations/${q.body.id}`).set('Authorization', auth).send({ estado: 'aceptada' })).status).toBe(422);
  });
});
