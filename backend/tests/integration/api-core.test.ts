import ExcelJS from 'exceljs';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { api, count, PASSWORD, stock, token, USERS } from '../helpers.js';

describe('Autenticación y autorización (RF-SEG-001, RF-SEG-002, RNF-SEG-001)', () => {
  it('un usuario activo inicia sesión y recibe roles y permisos', async () => {
    const res = await api().post('/api/auth/login').send({ correo: USERS.ventas, contrasena: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.accessToken).toBeTruthy();
    expect(res.body.user.roles).toEqual(['Ventas']);
    expect(res.body.user.permisos).toContain('venta.registrar');
    expect(res.body.user).not.toHaveProperty('hash_password');
  });

  it('rechaza credenciales incorrectas y usuarios inactivos', async () => {
    expect((await api().post('/api/auth/login').send({ correo: USERS.ventas, contrasena: 'incorrecta' })).status).toBe(401);
    const inactivo = await api().post('/api/auth/login').send({ correo: USERS.inactiva, contrasena: PASSWORD });
    expect(inactivo.status).toBe(401);
    expect(inactivo.body.error.message).toMatch(/inactivo/);
  });

  it('el token de renovación rota y no se puede reutilizar; logout lo revoca', async () => {
    const login = await api().post('/api/auth/login').send({ correo: USERS.gerencia, contrasena: PASSWORD });
    const r1 = await api().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken });
    expect(r1.status).toBe(200);
    expect((await api().post('/api/auth/refresh').send({ refreshToken: login.body.refreshToken })).status).toBe(401);
    await api().post('/api/auth/logout').send({ refreshToken: r1.body.refreshToken }).expect(204);
    expect((await api().post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
  });

  it('exige autenticación y permisos en el backend', async () => {
    expect((await api().get('/api/products')).status).toBe(401);
    expect((await api().get('/api/users').set('Authorization', await token('ventas'))).status).toBe(403);
    expect((await api().get('/api/audit').set('Authorization', await token('ventas'))).status).toBe(403);
    expect((await api().get('/api/users').set('Authorization', await token('admin'))).status).toBe(200);
  });

  it('el administrador crea usuarios, rechaza correos duplicados y deja auditoría', async () => {
    const auth = await token('admin');
    const nuevo = { nombre: 'Prueba Usuario', correo: 'prueba.usuario@ferreteria.test', contrasena: 'OtraClave123', roles: [4] };
    const res = await api().post('/api/users').set('Authorization', auth).send(nuevo);
    expect(res.status).toBe(201);
    expect((await api().post('/api/users').set('Authorization', auth).send(nuevo)).status).toBe(409);
    expect(await count(`SELECT count(*) AS n FROM auditoria WHERE tabla_afectada = 'usuario' AND registro_id = $1`, [String(res.body.id)])).toBe(1);
    // Desactivar impide el acceso de inmediato (RN-18).
    const login = await api().post('/api/auth/login').send({ correo: nuevo.correo, contrasena: nuevo.contrasena });
    await api().patch(`/api/users/${res.body.id}`).set('Authorization', auth).send({ activo: false }).expect(200);
    expect((await api().get('/api/auth/me').set('Authorization', `Bearer ${login.body.accessToken}`)).status).toBe(401);
  });
});

describe('Catálogo y consultas (RF-CAT-001, RF-PRO-001..003, RF-LEC-001)', () => {
  it('busca por términos y por código de barras', async () => {
    const auth = await token('ventas');
    const cable = await api().get('/api/products').query({ q: 'cable eléctrico calibre 12' }).set('Authorization', auth);
    expect(cable.body.data[0]).toMatchObject({ id: 4, unidad_codigo: 'MT', disponible: '92.0000' });
    const lector = await api().get('/api/products/barcode/7701234500011').set('Authorization', auth);
    expect(lector.body).toMatchObject({ nombre: 'Martillo de uña 16 oz', marca: 'Truper', disponible: '232.0000', precio_vigente: '33750.00' });
    expect((await api().get('/api/products/barcode/0000000000').set('Authorization', auth)).status).toBe(404);
  });

  it('un usuario sin permiso de costos no ve el costo; uno con permiso sí', async () => {
    const ventas = await api().get('/api/products/1').set('Authorization', await token('ventas'));
    expect(ventas.body).not.toHaveProperty('costo_promedio');
    expect(ventas.body.lotes[0]).not.toHaveProperty('costo_unitario');
    const inv = await api().get('/api/products/1').set('Authorization', await token('inventario'));
    expect(inv.body.costo_promedio).toBe('25000.0000');
  });

  it('rechaza código duplicado, porcentajes negativos y factores de conversión no positivos', async () => {
    const auth = await token('inventario');
    const base = { nombre: 'Prueba', marca_id: 1, presentacion: 'Unidad', unidad_base_id: 1, decimales_permitidos: 0, controla_vencimiento: false, controla_garantia: false, porcentaje_incremento: 30, stock_minimo: 1 };
    expect((await api().post('/api/products').set('Authorization', auth).send({ ...base, codigo_barras: '7701234500011' })).status).toBe(409);
    expect((await api().post('/api/products').set('Authorization', auth).send({ ...base, codigo_barras: '999000111', porcentaje_incremento: -1 })).status).toBe(400);
    const ok = await api().post('/api/products').set('Authorization', auth).send({ ...base, codigo_barras: '999000222' });
    expect(ok.status).toBe(201);
    expect((await api().post(`/api/products/${ok.body.id}/conversions`).set('Authorization', auth).send({ unidad_id: 2, tipo: 'compra', factor_a_base: 0 })).status).toBe(400);
    expect((await api().post(`/api/products/${ok.body.id}/conversions`).set('Authorization', auth).send({ unidad_id: 2, tipo: 'compra', factor_a_base: 12 })).status).toBe(201);
    expect((await api().post(`/api/products/${ok.body.id}/conversions`).set('Authorization', auth).send({ unidad_id: 2, tipo: 'compra', factor_a_base: 12 })).status).toBe(409);
  });

  it('registra marcas, categorías y unidades y rechaza duplicados', async () => {
    const auth = await token('inventario');
    expect((await api().post('/api/brands').set('Authorization', auth).send({ nombre: 'Marca Nueva' })).status).toBe(201);
    expect((await api().post('/api/brands').set('Authorization', auth).send({ nombre: 'Marca Nueva' })).status).toBe(409);
    expect((await api().post('/api/units').set('Authorization', auth).send({ codigo: 'PAR', nombre: 'Par', permite_decimal: false })).status).toBe(201);
    expect((await api().post('/api/units').set('Authorization', auth).send({ codigo: 'UND', nombre: 'Otra', permite_decimal: false })).status).toBe(409);
    expect((await api().post('/api/categories').set('Authorization', auth).send({ nombre: 'Pinturas' })).status).toBe(409);
  });
});

describe('Terceros (RF-TER-001, RN-11)', () => {
  it('valida persona natural, jurídica y documento único', async () => {
    const auth = await token('ventas');
    const nat = { tipo_persona: 'natural', tipo_documento: 'cedula', numero_documento: '55667788', es_cliente: true, es_proveedor: false };
    expect((await api().post('/api/third-parties').set('Authorization', auth).send(nat)).status).toBe(400);
    expect((await api().post('/api/third-parties').set('Authorization', auth).send({ ...nat, tipo_persona: 'juridica', tipo_documento: 'nit' })).status).toBe(400);
    expect((await api().post('/api/third-parties').set('Authorization', auth).send({ ...nat, nombre: 'Pedro', apellido: 'Paz' })).status).toBe(201);
    expect((await api().post('/api/third-parties').set('Authorization', auth).send({ ...nat, nombre: 'Otro', apellido: 'Igual' })).status).toBe(409);
  });
});

describe('Compras y ventas (RF-COM-001, RF-VEN-001, RNF-FIA-001)', () => {
  it('una compra por cajas aumenta las unidades base una sola vez y genera documento de ingreso', async () => {
    const antes = await stock(6);
    const res = await api().post('/api/purchases').set('Authorization', await token('compras')).send({
      proveedor_id: 1,
      lineas: [{ producto_id: 6, cantidad: 2, unidad_id: 2, costo_unitario: 20000 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.numero).toMatch(/^ING-\d{6}$/);
    expect((await stock(6)).disponible).toBe(antes.disponible + 200);
    // costo base = 20.000 / 100 = 200; el promedio no cambia y el precio sugerido es 200 × 1,5 = 300
    const precio = await api().get('/api/prices/6/history').set('Authorization', await token('inventario'));
    expect(precio.body.data[0]).toMatchObject({ vigente: true, costo_promedio: '200.0000', precio_calculado: '300.00' });
  });

  it('si una línea falla, la compra completa se revierte', async () => {
    const docs = await count('SELECT count(*) AS n FROM compra');
    const antes = await stock(1);
    const res = await api().post('/api/purchases').set('Authorization', await token('compras')).send({
      proveedor_id: 1,
      lineas: [
        { producto_id: 1, cantidad: 5, unidad_id: 1, costo_unitario: 25000 },
        { producto_id: 3, cantidad: 5, unidad_id: 1, costo_unitario: 50000 }, // exige vencimiento
      ],
    });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/vencimiento/);
    expect(await count('SELECT count(*) AS n FROM compra')).toBe(docs);
    expect(await stock(1)).toEqual(antes);
  });

  it('una compra a un tercero que no es proveedor se rechaza', async () => {
    const res = await api().post('/api/purchases').set('Authorization', await token('compras')).send({
      proveedor_id: 3, lineas: [{ producto_id: 1, cantidad: 1, unidad_id: 1, costo_unitario: 1000 }],
    });
    expect(res.status).toBe(422);
  });

  it('una venta usa el precio del servidor, descuenta disponible y genera factura', async () => {
    const antes = await stock(4);
    const res = await api().post('/api/sales').set('Authorization', await token('ventas')).send({
      cliente_id: 3, lineas: [{ producto_id: 4, cantidad: 12.5, unidad_id: 3 }],
    });
    expect(res.status).toBe(201);
    expect(res.body.numero).toMatch(/^FAC-\d{6}$/);
    expect(res.body.lineas[0]).toMatchObject({ precio_unitario: '2520.0000', subtotal: '31500.00' });
    expect((await stock(4)).disponible).toBe(antes.disponible - 12.5);
  });

  it('rechaza una venta superior a la existencia disponible sin cambiar saldos (la reservada no se vende)', async () => {
    const antes = await stock(18); // cinta: 0 disponible, 6 reservada
    const docs = await count('SELECT count(*) AS n FROM venta');
    const res = await api().post('/api/sales').set('Authorization', await token('ventas')).send({ cliente_id: 3, lineas: [{ producto_id: 18, cantidad: 1 }] });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/Stock insuficiente/);
    expect(await stock(18)).toEqual(antes);
    expect(await count('SELECT count(*) AS n FROM venta')).toBe(docs);
  });

  it('dos ventas concurrentes no consumen la misma existencia', async () => {
    const auth = await token('ventas');
    const { disponible } = await stock(5); // taladro
    const venta = { cliente_id: 3, lineas: [{ producto_id: 5, cantidad: disponible }] };
    const [a, b] = await Promise.all([
      api().post('/api/sales').set('Authorization', auth).send(venta),
      api().post('/api/sales').set('Authorization', auth).send(venta),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 422]);
    expect((await stock(5)).disponible).toBe(0);
  });

  it('anula una venta conservando el documento, el motivo y la auditoría', async () => {
    const auth = await token('admin');
    const res = await api().post('/api/sales/1/void').set('Authorization', auth).send({ motivo: 'Factura duplicada' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ estado: 'anulado', motivo_anulacion: 'Factura duplicada' });
    expect((await api().post('/api/sales/1/void').set('Authorization', auth).send({ motivo: 'otra vez' })).status).toBe(422);
    expect((await api().post('/api/sales/2/void').set('Authorization', await token('ventas')).send({ motivo: 'sin permiso' })).status).toBe(403);
  });
});

describe('Estados, kardex, precios y reportes (RF-EST-001, RF-MOV-001, RF-PRE-*, RF-REP-001)', () => {
  it('el cambio de estado no altera el total y rechaza cantidades superiores al origen', async () => {
    const auth = await token('inventario');
    const antes = await stock(9);
    const res = await api().post('/api/inventory/state-transfers').set('Authorization', auth).send({
      producto_id: 9, estado_origen: 'disponible', estado_destino: 'reservada', cantidad: 2, motivo: 'Separado para cliente',
    });
    expect(res.status).toBe(201);
    const despues = await stock(9);
    expect(despues.disponible + despues.reservada + despues.danada).toBe(antes.disponible + antes.reservada + antes.danada);
    expect(despues.reservada).toBe(antes.reservada + 2);
    const exceso = await api().post('/api/inventory/state-transfers').set('Authorization', auth).send({
      producto_id: 9, estado_origen: 'danada', estado_destino: 'disponible', cantidad: 999, motivo: 'Exceso',
    });
    expect(exceso.status).toBe(422);
  });

  it('el kardex se muestra en orden cronológico con documento y responsable, y cuadra con las existencias', async () => {
    const res = await api().get('/api/inventory/movements').query({ productoId: 1 }).set('Authorization', await token('gerencia'));
    expect(res.status).toBe(200);
    expect(res.body.data.slice(0, 3).map((m: { tipo: string }) => m.tipo)).toEqual(['entrada_compra', 'salida_venta', 'cambio_estado']);
    expect(res.body.data[0]).toMatchObject({ documento_numero: 'ING-000001', usuario: 'Camila Compras' });
    expect(await count('SELECT count(*) AS n FROM fn_verificar_kardex()')).toBe(0);
    expect(await count('SELECT count(*) AS n FROM fn_verificar_lotes()')).toBe(0);
  });

  it('precio manual: queda vigente, prevalece en ventas y exige permiso', async () => {
    expect((await api().post('/api/prices/2/manual').set('Authorization', await token('ventas')).send({ precio_manual: 1 })).status).toBe(403);
    await api().post('/api/prices/7/manual').set('Authorization', await token('inventario')).send({ precio_manual: 11000, motivo: 'Competencia' }).expect(201);
    const venta = await api().post('/api/sales').set('Authorization', await token('ventas')).send({ cliente_id: 3, lineas: [{ producto_id: 7, cantidad: 1 }] });
    expect(venta.body.lineas[0].precio_unitario).toBe('11000.0000');
  });

  it('con costo 25.000 y porcentaje 35 % el precio sugerido es 33.750 (RF-PRE-001)', async () => {
    const auth = await token('inventario');
    await api().post('/api/prices/1/percentage').set('Authorization', auth).send({ porcentaje: 35 }).expect(201);
    const h = await api().get('/api/prices/1/history').set('Authorization', auth);
    expect(h.body.data[0]).toMatchObject({ precio_calculado: '33750.00', vigente: true });
    expect(h.body.data.filter((r: { vigente: boolean }) => r.vigente)).toHaveLength(1);
  });

  it('reportes: valorización solo con permiso de costos; más vendidos excluye anulados', async () => {
    expect((await api().get('/api/reports/valuation').set('Authorization', await token('gerencia'))).status).toBe(200);
    expect((await api().get('/api/reports/valuation').set('Authorization', await token('ventas'))).status).toBe(403);
    const top = await api().get('/api/reports/top-selling').set('Authorization', await token('gerencia'));
    // La venta FAC-000001 del martillo se anuló en una prueba anterior.
    expect(top.body.data.find((r: { producto_id: number }) => r.producto_id === 1)).toBeUndefined();
    const dash = await api().get('/api/reports/dashboard').set('Authorization', await token('ventas'));
    expect(dash.body.productos_agotados).toBeGreaterThan(0);
    expect(dash.body.valor_inventario).toBeNull();
  });
});

describe('Cierres, auditoría, migración e integración', () => {
  it('cierre: guarda fotografía, rechaza un segundo cierre y bloquea compras con fecha del período', async () => {
    const auth = await token('admin');
    const r = await api().post('/api/closures').set('Authorization', auth).send({ periodo: '2020-01', observaciones: 'Período de prueba' });
    expect(r.status).toBe(201);
    const segundo = await api().post('/api/closures').set('Authorization', auth).send({ periodo: '2020-01' });
    expect(segundo.status).toBe(422);
    expect(segundo.body.error.message).toMatch(/ya tiene cierre/);
    const compra = await api().post('/api/purchases').set('Authorization', await token('compras')).send({
      proveedor_id: 1, fecha: '2020-01-15T10:00:00-05:00', lineas: [{ producto_id: 1, cantidad: 1, unidad_id: 1, costo_unitario: 1000 }],
    });
    expect(compra.status).toBe(422);
    expect(compra.body.error.message).toMatch(/cerrado/);
  });

  it('la auditoría solo se consulta; registra usuario y origen', async () => {
    const res = await api().get('/api/audit').query({ tabla: 'venta', accion: 'update' }).set('Authorization', await token('gerencia'));
    expect(res.status).toBe(200);
    expect(res.body.data[0]).toMatchObject({ usuario: 'Ana Administradora', origen: 'online' });
    expect(res.body.data[0].valores_antes.estado).toBe('confirmado');
    expect(res.body.data[0].valores_despues.estado).toBe('anulado');
  });

  it('importa desde Excel: carga filas válidas y reporta las inválidas con su error', async () => {
    const auth = await token('admin');
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('productos');
    ws.addRow(['codigo_barras', 'nombre', 'marca', 'presentacion', 'unidad_base', 'decimales_permitidos', 'porcentaje_incremento', 'stock_minimo']);
    ws.addRow(['IMP-0001', 'Llave inglesa 10"', 'Stanley', 'Unidad', 'UND', 0, 30, 2]);
    ws.addRow(['7701234500011', 'Duplicado', 'Truper', 'Unidad', 'UND', 0, 30, 2]);
    ws.addRow(['IMP-0002', 'Sin marca', 'MarcaInexistente', 'Unidad', 'UND', 0, -5, 2]);
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    const up = await api().post('/api/imports').set('Authorization', auth).field('tipo', 'productos').attach('archivo', buffer, 'productos.xlsx');
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ filas_validas: 1, filas_invalidas: 2 });
    expect(up.body.filas.find((f: { fila_origen: number }) => f.fila_origen === 3).error_validacion).toMatch(/ya existe/);
    expect(up.body.filas.find((f: { fila_origen: number }) => f.fila_origen === 4).error_validacion).toMatch(/marca.*porcentaje/);
    const conf = await api().post(`/api/imports/${up.body.id}/confirm`).set('Authorization', auth);
    expect(conf.body).toMatchObject({ estado: 'cargada', filas_cargadas: 1 });
    expect((await api().get('/api/products/barcode/IMP-0001').set('Authorization', auth)).status).toBe(200);

    // Saldo inicial del producto importado: genera existencia, costo y kardex.
    const ws2 = new ExcelJS.Workbook();
    const s = ws2.addWorksheet('saldos');
    s.addRow(['codigo_barras', 'cantidad', 'estado', 'costo_unitario']);
    s.addRow(['IMP-0001', 7, 'disponible', 18000]);
    s.addRow(['IMP-0001', -1, 'disponible', 18000]);
    const up2 = await api().post('/api/imports').set('Authorization', auth).field('tipo', 'saldos').field('fecha_corte', '2026-10-01')
      .attach('archivo', Buffer.from(await ws2.xlsx.writeBuffer()), 'saldos.xlsx');
    expect(up2.body).toMatchObject({ filas_validas: 1, filas_invalidas: 1 });
    await api().post(`/api/imports/${up2.body.id}/confirm`).set('Authorization', auth).expect(200);
    const prod = await api().get('/api/products/barcode/IMP-0001').set('Authorization', auth);
    expect(prod.body).toMatchObject({ disponible: '7.0000', precio_vigente: '23400.00' });
    expect(await count('SELECT count(*) AS n FROM fn_verificar_kardex()')).toBe(0);
  });

  it('una venta offline reenviada con el mismo UUID se aplica una sola vez', async () => {
    const auth = await token('ventas');
    const uuid = randomUUID();
    const body = { dispositivo: 'caja-01', uuid_offline: uuid, fecha_hora_local: new Date().toISOString(), venta: { cliente_id: 3, lineas: [{ producto_id: 8, cantidad: 2 }] } };
    const antes = await stock(8);
    const r1 = await api().post('/api/integration/offline/sales').set('Authorization', auth).send(body);
    expect(r1.status).toBe(201);
    expect(r1.body.resultado.estado).toBe('aplicado');
    const r2 = await api().post('/api/integration/offline/sales').set('Authorization', auth).send(body);
    expect(r2.status).toBe(200);
    expect(r2.body.duplicado).toBe(true);
    expect((await stock(8)).disponible).toBe(antes.disponible - 2);
    expect(await count(`SELECT count(*) AS n FROM venta WHERE uuid_offline = $1 AND canal = 'offline'`, [uuid])).toBe(1);
    expect(await count(`SELECT count(*) AS n FROM auditoria WHERE tabla_afectada = 'venta' AND origen = 'offline'`)).toBeGreaterThan(0);
  });

  it('una operación offline conflictiva queda pendiente y no modifica existencias', async () => {
    const auth = await token('ventas');
    const antes = await stock(22);
    const r = await api().post('/api/integration/offline/sales').set('Authorization', auth).send({
      dispositivo: 'caja-01', uuid_offline: randomUUID(), fecha_hora_local: new Date().toISOString(),
      venta: { cliente_id: 3, lineas: [{ producto_id: 22, cantidad: 3 }] },
    });
    expect(r.body.resultado.estado).toBe('pendiente_conflicto');
    expect(await stock(22)).toEqual(antes);
  });

  it('un evento externo repetido no genera movimientos duplicados', async () => {
    const auth = await token('ventas');
    const ev = { sistema_origen: 'tienda-web', tipo_evento: 'venta', identificador_externo: `web-${randomUUID()}`, payload: { cliente_id: 4, lineas: [{ producto_id: 20, cantidad: 3 }] } };
    const movs = await count('SELECT count(*) AS n FROM movimiento_inventario WHERE producto_id = 20');
    await api().post('/api/integration/events').set('Authorization', auth).send(ev).expect(201);
    await api().post('/api/integration/events').set('Authorization', auth).send(ev).expect(200);
    expect(await count('SELECT count(*) AS n FROM movimiento_inventario WHERE producto_id = 20')).toBe(movs + 1);
  });
});
