-- Seed 002: datos de demostración reproducibles.
-- Parte 1: datos de seed_datos_prueba.sql (mismos IDs, para que los resultados esperados de
--          05_Plan_Pruebas_y_Reportes.md sigan siendo válidos).
-- Parte 2: ampliación para el asistente y el cotizador de pintura.
-- Las contraseñas son valores de prueba (ClaveSegura1), no credenciales reales.
-- Los rendimientos de las fichas técnicas son DATOS DE DEMOSTRACIÓN (DP-24), no del fabricante.

SET LOCAL app.suprimir_auditoria = 'on';

INSERT INTO unidad_medida (id, codigo, nombre, permite_decimal) VALUES
    (1, 'UND', 'Unidad', FALSE),
    (2, 'CAJA', 'Caja', FALSE),
    (3, 'MT', 'Metro', TRUE),
    (4, 'ROLLO', 'Rollo', TRUE),
    (5, 'GALON', 'Galón', TRUE),
    (6, 'TUBO', 'Tubo', FALSE),
    (7, 'CUNETE', 'Cuñete', FALSE),
    (8, 'KG', 'Kilogramo', TRUE),
    (9, 'BULTO', 'Bulto', FALSE),
    (10, 'L', 'Litro', TRUE),
    (11, 'PLIEGO', 'Pliego', FALSE);

INSERT INTO marca (id, nombre) VALUES
    (1, 'Truper'), (2, 'Stanley'), (3, 'Sika'), (4, 'Pavco'), (5, 'Centelsa'), (6, 'Bosch'),
    (7, 'Andina Pinturas'), (8, 'Cementos del Valle'), (9, 'Pintamax');

INSERT INTO categoria (id, nombre, categoria_padre_id) VALUES
    (1, 'Herramientas', NULL),
    (2, 'Herramientas manuales', 1),
    (3, 'Herramientas eléctricas', 1),
    (4, 'Construcción', NULL),
    (5, 'Selladores y adhesivos', 4),
    (6, 'Eléctricos', NULL),
    (7, 'Cables', 6),
    (8, 'Plomería', NULL),
    (9, 'Pinturas', NULL),
    (10, 'Accesorios de pintura', 9),
    (11, 'Cementos y agregados', 4);

INSERT INTO usuario (id, nombre, correo, hash_password, activo) VALUES
    (1, 'Ana Administradora', 'ana@ferreteria.test', crypt('ClaveSegura1', gen_salt('bf', 10)), TRUE),
    (2, 'Iván Inventario', 'ivan@ferreteria.test', crypt('ClaveSegura1', gen_salt('bf', 10)), TRUE),
    (3, 'Camila Compras', 'camila@ferreteria.test', crypt('ClaveSegura1', gen_salt('bf', 10)), TRUE),
    (4, 'Valentina Ventas', 'valentina@ferreteria.test', crypt('ClaveSegura1', gen_salt('bf', 10)), TRUE),
    (5, 'Gabriel Gerencia', 'gabriel@ferreteria.test', crypt('ClaveSegura1', gen_salt('bf', 10)), TRUE),
    (6, 'Iris Inactiva', 'iris@ferreteria.test', crypt('ClaveSegura1', gen_salt('bf', 10)), FALSE);

INSERT INTO usuario_rol (usuario_id, rol_id) VALUES (1, 1), (2, 2), (3, 3), (4, 4), (5, 5), (6, 4);

INSERT INTO tercero (id, tipo_persona, tipo_documento, numero_documento, nombre, apellido, razon_social, direccion, telefono, correo, es_cliente, es_proveedor) VALUES
    (1, 'juridica', 'nit', '900123456', NULL, NULL, 'Distribuciones Huila S.A.S.', 'Carrera 5 # 10-20, Neiva', '6088660001', 'ventas@distribucioneshuila.test', FALSE, TRUE),
    (2, 'juridica', 'nit', '901234567', NULL, NULL, 'Materiales del Sur S.A.S.', 'Calle 19 # 23-45, Neiva', '6088660002', 'pedidos@materialesdelsur.test', FALSE, TRUE),
    (3, 'natural', 'cedula', '1075234567', 'Laura', 'Gomez', NULL, 'Calle 8 # 12-34, Neiva', '3001234567', 'laura.gomez@test.com', TRUE, FALSE),
    (4, 'juridica', 'nit', '900765432', NULL, NULL, 'Construcciones del Alto S.A.S.', 'Avenida 26 # 7-18, Neiva', '6088660003', 'compras@construccionesalto.test', TRUE, FALSE),
    (5, 'natural', 'cedula', '1075999999', 'Carlos', 'Rojas', NULL, 'Carrera 2 # 4-15, Neiva', '3009999999', 'carlos.rojas@test.com', TRUE, TRUE);

INSERT INTO producto (id, codigo_barras, nombre, descripcion, marca_id, presentacion, categoria_id, unidad_base_id, decimales_permitidos, controla_vencimiento, controla_garantia, porcentaje_incremento, stock_minimo, activo) VALUES
    (1, '7701234500011', 'Martillo de uña 16 oz', 'Martillo de acero con mango de fibra', 1, 'Unidad', 2, 1, 0, FALSE, FALSE, 35.000, 10, TRUE),
    (2, '7701234500012', 'Martillo de uña 16 oz', 'Martillo de acero con mango de fibra', 2, 'Unidad', 2, 1, 0, FALSE, FALSE, 30.000, 8, TRUE),
    (3, '7701234500020', 'Sellador acrílico blanco', 'Sellador para juntas y grietas', 3, 'Tubo 300 ml', 5, 1, 0, TRUE, FALSE, 45.000, 20, TRUE),
    (4, '7701234500030', 'Cable eléctrico THHN #12', 'Cable de cobre calibre 12 AWG para instalaciones eléctricas', 5, 'Rollo 100 m', 7, 3, 2, FALSE, FALSE, 40.000, 50, TRUE),
    (5, '7701234500040', 'Taladro percutor 650 W', 'Taladro eléctrico con garantía de fabricante', 6, 'Unidad', 3, 1, 0, FALSE, TRUE, 25.000, 2, TRUE),
    (6, '7701234500050', 'Tornillo drywall 1 pulgada', 'Tornillo para drywall', 1, 'Caja x 100', 4, 1, 0, FALSE, FALSE, 50.000, 100, TRUE),
    (7, '7701234500060', 'Pegante PVC', 'Adhesivo para tubería PVC', 4, 'Tubo 50 g', 8, 1, 0, TRUE, FALSE, 40.000, 10, TRUE),
    (8, '7701234500080', 'Cemento gris uso general', 'Cemento hidráulico para obra general', 8, 'Bulto 50 kg', 11, 9, 0, FALSE, FALSE, 20.000, 20, TRUE),
    (9, '7701234500090', 'Pintura vinilo tipo 1 blanco', 'Pintura vinílica lavable para interiores', 7, 'Galón 3,785 L', 9, 5, 0, FALSE, FALSE, 35.000, 6, TRUE),
    (10, '7701234500100', 'Pintura vinilo tipo 1 blanco', 'Pintura vinílica lavable para interiores', 7, 'Cuñete 5 galones (18,93 L)', 9, 7, 0, FALSE, FALSE, 30.000, 1, TRUE),
    (11, '7701234500110', 'Pintura vinilo tipo 2 blanco', 'Pintura vinílica económica para interiores', 9, 'Galón 3,785 L', 9, 5, 0, FALSE, FALSE, 35.000, 4, TRUE),
    (12, '7701234500120', 'Pintura para techos blanca', 'Pintura antihongos para cielos rasos', 7, 'Galón 3,785 L', 9, 5, 0, FALSE, FALSE, 35.000, 5, TRUE),
    (13, '7701234500130', 'Sellador acrílico para muros', 'Imprimante para superficies nuevas o porosas', 7, 'Galón 3,785 L', 9, 5, 0, FALSE, FALSE, 35.000, 2, TRUE),
    (14, '7701234500140', 'Rodillo de felpa 9 pulgadas', 'Rodillo para pintura vinílica', 1, 'Unidad', 10, 1, 0, FALSE, FALSE, 40.000, 3, TRUE),
    (15, '7701234500150', 'Brocha 3 pulgadas', 'Brocha de cerda mixta', 1, 'Unidad', 10, 1, 0, FALSE, FALSE, 40.000, 3, TRUE),
    (16, '7701234500160', 'Brocha 2 pulgadas', 'Brocha de cerda mixta', 2, 'Unidad', 10, 1, 0, FALSE, FALSE, 40.000, 3, TRUE),
    (17, '7701234500170', 'Bandeja para rodillo 9 pulgadas', 'Bandeja plástica', 1, 'Unidad', 10, 1, 0, FALSE, FALSE, 40.000, 2, TRUE),
    (18, '7701234500180', 'Cinta de enmascarar 1 pulgada', 'Cinta de papel para enmascarar, rollo de 40 m', 9, 'Rollo 40 m', 10, 1, 0, FALSE, FALSE, 40.000, 5, TRUE),
    (19, '7701234500190', 'Plástico protector 4 x 5 m', 'Plástico para cubrir pisos y muebles', 9, 'Unidad', 10, 1, 0, FALSE, FALSE, 40.000, 5, TRUE),
    (20, '7701234500200', 'Lija de agua #150', 'Lija para preparar superficies', 9, 'Pliego', 10, 11, 0, FALSE, FALSE, 50.000, 10, TRUE),
    (21, '7701234500210', 'Masilla plástica para muros', 'Masilla para resanar grietas y huecos', 7, 'Galón 5 kg', 9, 5, 0, FALSE, FALSE, 35.000, 3, TRUE),
    (22, '7701234500220', 'Tubo PVC presión 1/2 pulgada', 'Tubo PVC para agua a presión', 4, 'Tubo 6 m', 8, 6, 0, FALSE, FALSE, 30.000, 10, TRUE),
    (23, '7701234500230', 'Pintura esmalte sintético azul', 'Esmalte para madera y metal', 9, 'Galón 3,785 L', 9, 5, 0, FALSE, FALSE, 35.000, 2, TRUE),
    (24, '7701234500240', 'Rodillo antigota 9 pulgadas', 'Rodillo para techos', 9, 'Unidad', 10, 1, 0, FALSE, FALSE, 40.000, 2, TRUE),
    (25, '7701234500250', 'Pintura vinilo tipo 1 crema', 'Referencia descontinuada', 7, 'Galón 3,785 L', 9, 5, 0, FALSE, FALSE, 35.000, 0, FALSE);

INSERT INTO unidad_conversion (producto_id, unidad_id, tipo, factor_a_base) VALUES
    (4, 4, 'compra', 100.000000),
    (4, 3, 'venta', 1.000000),
    (4, 4, 'venta', 100.000000),
    (6, 2, 'compra', 100.000000),
    (6, 2, 'venta', 100.000000);

INSERT INTO producto_ficha_tecnica (producto_id, tipo_producto, linea, superficies, acabado, contenido_litros, rendimiento, unidad_rendimiento, manos_recomendadas, compatibilidad, observaciones_fabricante, fuente) VALUES
    (9, 'pintura', 'Vinilo Tipo 1 Blanco Andina', '{pared,techo}', 'mate', 3.785, 10, 'm2_por_litro', 2, 'Muros interiores de pañete, estuco o drywall', 'Diluir hasta 10 % con agua', 'Dato de demostración — validar con la ficha del fabricante'),
    (10, 'pintura', 'Vinilo Tipo 1 Blanco Andina', '{pared,techo}', 'mate', 18.927, 10, 'm2_por_litro', 2, 'Muros interiores de pañete, estuco o drywall', 'Diluir hasta 10 % con agua', 'Dato de demostración — validar con la ficha del fabricante'),
    (11, 'pintura', 'Vinilo Tipo 2 Blanco Pintamax', '{pared}', 'mate', 3.785, 8, 'm2_por_litro', 2, 'Muros interiores', NULL, 'Dato de demostración — validar con la ficha del fabricante'),
    (12, 'pintura', 'Techos Blanco Andina', '{techo}', 'mate', 3.785, 9, 'm2_por_litro', 2, 'Cielos rasos interiores', 'Con aditivo antihongos', 'Dato de demostración — validar con la ficha del fabricante'),
    (13, 'sellador', 'Sellador muros Andina', '{pared,techo}', NULL, 3.785, 12, 'm2_por_litro', 1, 'Superficies nuevas o porosas antes de pintar', NULL, 'Dato de demostración — validar con la ficha del fabricante'),
    (14, 'rodillo', NULL, '{pared,techo}', NULL, NULL, 100, 'm2_por_unidad', NULL, 'Pinturas base agua', 'Vida útil estimada por unidad', 'Dato de demostración — validar'),
    (15, 'brocha', NULL, '{pared,techo}', NULL, NULL, 60, 'm2_por_unidad', NULL, 'Recortes y bordes', 'Vida útil estimada por unidad', 'Dato de demostración — validar'),
    (16, 'brocha', NULL, '{pared,techo}', NULL, NULL, 40, 'm2_por_unidad', NULL, 'Recortes y bordes', 'Vida útil estimada por unidad', 'Dato de demostración — validar'),
    (17, 'bandeja', NULL, '{pared,techo}', NULL, NULL, 150, 'm2_por_unidad', NULL, 'Rodillos de 9 pulgadas', NULL, 'Dato de demostración — validar'),
    (18, 'cinta', NULL, '{pared,techo}', NULL, NULL, 25, 'm2_por_unidad', NULL, NULL, 'Rollo de 40 m', 'Dato de demostración — validar'),
    (19, 'plastico', NULL, '{pared,techo}', NULL, NULL, 20, 'm2_por_unidad', NULL, NULL, 'Cubre 20 m² de piso o muebles', 'Dato de demostración — validar'),
    (20, 'lija', NULL, '{pared,techo}', NULL, NULL, 5, 'm2_por_unidad', NULL, NULL, NULL, 'Dato de demostración — validar'),
    (21, 'masilla', NULL, '{pared,techo}', NULL, NULL, 8, 'm2_por_unidad', NULL, 'Resane de muros interiores', NULL, 'Dato de demostración — validar'),
    (24, 'rodillo', NULL, '{techo}', NULL, NULL, NULL, NULL, NULL, 'Techos', 'Sin rendimiento registrado', NULL);

-- Lotes, compras y ventas originales (IDs fijos del seed original).
INSERT INTO lote (id, producto_id, cantidad_recibida, cantidad_disponible, costo_unitario, fecha_vencimiento, referencia_garantia, fecha_ingreso) VALUES
    (1, 1, 240, 0, 25000, NULL, NULL, now() - interval '10 days'),
    (2, 3, 40, 0, 50000, CURRENT_DATE + interval '30 days', NULL, now() - interval '8 days'),
    (3, 4, 100, 0, 1800, NULL, NULL, now() - interval '7 days'),
    (4, 5, 5, 0, 220000, NULL, 'Garantía fabricante 12 meses', now() - interval '6 days'),
    (5, 6, 200, 0, 200, NULL, NULL, now() - interval '5 days'),
    (6, 7, 30, 0, 7500, CURRENT_DATE + interval '45 days', NULL, now() - interval '4 days');

INSERT INTO compra (id, numero, proveedor_id, fecha, usuario_id, estado, total) VALUES
    (1, 'ING-000001', 1, now() - interval '10 days', 3, 'confirmado', 6000000),
    (2, 'ING-000002', 2, now() - interval '8 days', 3, 'confirmado', 2000000),
    (3, 'ING-000003', 1, now() - interval '7 days', 3, 'confirmado', 180000),
    (4, 'ING-000004', 2, now() - interval '6 days', 3, 'confirmado', 1100000),
    (5, 'ING-000005', 1, now() - interval '5 days', 3, 'confirmado', 40000),
    (6, 'ING-000006', 2, now() - interval '4 days', 3, 'confirmado', 225000);

INSERT INTO compra_detalle (compra_id, producto_id, cantidad, unidad_id, costo_unitario, subtotal, lote_id, fecha_vencimiento, referencia_garantia) VALUES
    (1, 1, 240, 1, 25000, 6000000, 1, NULL, NULL),
    (2, 3, 40, 1, 50000, 2000000, 2, CURRENT_DATE + interval '30 days', NULL),
    (3, 4, 1, 4, 1800, 180000, 3, NULL, NULL),
    (4, 5, 5, 1, 220000, 1100000, 4, NULL, 'Garantía fabricante 12 meses'),
    (5, 6, 2, 2, 200, 40000, 5, NULL, NULL),
    (6, 7, 30, 1, 7500, 225000, 6, CURRENT_DATE + interval '45 days', NULL);

SELECT setval(pg_get_serial_sequence('unidad_medida', 'id'), (SELECT max(id) FROM unidad_medida));
SELECT setval(pg_get_serial_sequence('marca', 'id'), (SELECT max(id) FROM marca));
SELECT setval(pg_get_serial_sequence('categoria', 'id'), (SELECT max(id) FROM categoria));
SELECT setval(pg_get_serial_sequence('usuario', 'id'), (SELECT max(id) FROM usuario));
SELECT setval(pg_get_serial_sequence('tercero', 'id'), (SELECT max(id) FROM tercero));
SELECT setval(pg_get_serial_sequence('producto', 'id'), (SELECT max(id) FROM producto));
SELECT setval(pg_get_serial_sequence('lote', 'id'), (SELECT max(id) FROM lote));
SELECT setval(pg_get_serial_sequence('compra', 'id'), (SELECT max(id) FROM compra));
SELECT setval('seq_documento_ingreso', 6);

SET LOCAL app.suprimir_auditoria = 'off';
SET LOCAL app.usuario_id = '3';
SET LOCAL app.origen = 'online';

SELECT fn_aplicar_entrada_compra(1, 240, 1, 25000, 1, 3, 1);
SELECT fn_aplicar_entrada_compra(3, 40, 1, 50000, 2, 3, 2);
SELECT fn_aplicar_entrada_compra(4, 1, 4, 1800, 3, 3, 3);
SELECT fn_aplicar_entrada_compra(5, 5, 1, 220000, 4, 3, 4);
SELECT fn_aplicar_entrada_compra(6, 2, 2, 200, 5, 3, 5);
SELECT fn_aplicar_entrada_compra(7, 30, 1, 7500, 6, 3, 6);

INSERT INTO venta (id, numero, cliente_id, fecha, usuario_id, subtotal, impuesto, total, medio_pago, estado, canal) VALUES
    (1, 'FAC-000001', 3, now() - interval '2 days', 4, 168750, 0, 168750, 'efectivo', 'confirmado', 'online'),
    (2, 'FAC-000002', 4, now() - interval '1 day', 4, 725000, 0, 725000, 'transferencia', 'confirmado', 'online'),
    (3, 'FAC-000003', 3, now() - interval '1 day', 4, 14400, 0, 14400, 'efectivo', 'confirmado', 'online');

INSERT INTO venta_detalle (venta_id, producto_id, cantidad, unidad_id, precio_unitario, subtotal, lote_id) VALUES
    (1, 1, 5, 1, 33750, 168750, 1),
    (2, 3, 10, 1, 72500, 725000, 2),
    (3, 4, 8, 3, 1800, 14400, 3);

SET LOCAL app.usuario_id = '4';
SELECT fn_aplicar_salida_venta(1, 5, 1, 1, 4, 1);
SELECT fn_aplicar_salida_venta(3, 10, 1, 2, 4, 2);
SELECT fn_aplicar_salida_venta(4, 8, 3, NULL, 4, 3);

SET LOCAL app.usuario_id = '2';
SELECT fn_cambiar_estado_existencia(1, 'disponible', 'danada', 3, 2, 'Caja golpeada en transporte');

SELECT setval(pg_get_serial_sequence('venta', 'id'), (SELECT max(id) FROM venta));
SELECT setval('seq_factura', 3);

-- ---------------------------------------------------------------------------
-- Parte 2: compras y ventas de demostración por las funciones de negocio,
-- para que kardex, lotes, existencias y precios queden consistentes.
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.seed_compra(p_producto BIGINT, p_cantidad NUMERIC, p_costo NUMERIC, p_proveedor BIGINT)
RETURNS VOID AS $$
DECLARE
    v_unidad BIGINT;
    v_lote BIGINT;
    v_compra BIGINT;
BEGIN
    SELECT unidad_base_id INTO v_unidad FROM producto WHERE id = p_producto;
    INSERT INTO lote(producto_id, cantidad_recibida, cantidad_disponible, costo_unitario, fecha_ingreso)
    VALUES (p_producto, p_cantidad, 0, p_costo, now() - interval '3 days') RETURNING id INTO v_lote;
    INSERT INTO compra(numero, proveedor_id, fecha, usuario_id, total)
    VALUES (fn_siguiente_numero('compra'), p_proveedor, now() - interval '3 days', 3, round(p_cantidad * p_costo, 2))
    RETURNING id INTO v_compra;
    INSERT INTO compra_detalle(compra_id, producto_id, cantidad, unidad_id, costo_unitario, subtotal, lote_id)
    VALUES (v_compra, p_producto, p_cantidad, v_unidad, p_costo, round(p_cantidad * p_costo, 2), v_lote);
    PERFORM fn_aplicar_entrada_compra(p_producto, p_cantidad, v_unidad, p_costo, v_lote, 3, v_compra);
END;
$$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.seed_venta(p_producto BIGINT, p_cantidad NUMERIC, p_cliente BIGINT)
RETURNS VOID AS $$
DECLARE
    v_unidad BIGINT;
    v_precio NUMERIC;
    v_venta BIGINT;
BEGIN
    SELECT unidad_base_id INTO v_unidad FROM producto WHERE id = p_producto;
    v_precio := fn_precio_vigente(p_producto);
    INSERT INTO venta(numero, cliente_id, fecha, usuario_id, subtotal, impuesto, total, medio_pago)
    VALUES (fn_siguiente_numero('venta'), p_cliente, now() - interval '1 day', 4,
            round(p_cantidad * v_precio, 2), 0, round(p_cantidad * v_precio, 2), 'efectivo')
    RETURNING id INTO v_venta;
    INSERT INTO venta_detalle(venta_id, producto_id, cantidad, unidad_id, precio_unitario, subtotal)
    VALUES (v_venta, p_producto, p_cantidad, v_unidad, v_precio, round(p_cantidad * v_precio, 2));
    PERFORM fn_aplicar_salida_venta(p_producto, p_cantidad, v_unidad, NULL, 4, v_venta);
END;
$$ LANGUAGE plpgsql;

SET LOCAL app.usuario_id = '3';
SELECT pg_temp.seed_compra(8, 45, 28000, 2);      -- cemento gris: 45 bultos
SELECT pg_temp.seed_compra(9, 12, 62000, 1);      -- vinilo T1 galón
SELECT pg_temp.seed_compra(10, 2, 280000, 1);     -- vinilo T1 cuñete
SELECT pg_temp.seed_compra(11, 4, 41000, 2);      -- vinilo T2 galón (se vende todo → agotado)
SELECT pg_temp.seed_compra(12, 4, 48000, 1);      -- techos: 4 < mínimo 5
SELECT pg_temp.seed_compra(13, 6, 45000, 1);      -- sellador muros
SELECT pg_temp.seed_compra(14, 10, 9000, 2);      -- rodillo felpa
SELECT pg_temp.seed_compra(15, 2, 6000, 2);       -- brocha 3" (se daña todo → agotado con dañada)
SELECT pg_temp.seed_compra(16, 7, 4500, 2);       -- brocha 2"
SELECT pg_temp.seed_compra(17, 8, 7000, 2);       -- bandeja
SELECT pg_temp.seed_compra(18, 6, 5000, 2);       -- cinta (se reserva todo → agotado con reservada)
SELECT pg_temp.seed_compra(19, 15, 3500, 2);      -- plástico
SELECT pg_temp.seed_compra(20, 50, 1200, 2);      -- lija
SELECT pg_temp.seed_compra(21, 9, 38000, 1);      -- masilla
SELECT pg_temp.seed_compra(22, 10, 9000, 2);      -- tubo PVC (se vende todo → agotado)
SELECT pg_temp.seed_compra(23, 5, 70000, 1);      -- esmalte sin ficha técnica
SELECT pg_temp.seed_compra(25, 3, 60000, 1);      -- producto inactivo con saldo
-- Producto 24 (rodillo antigota) queda sin compra: sin precio vigente ni existencia.

SET LOCAL app.usuario_id = '4';
SELECT pg_temp.seed_venta(11, 4, 3);
SELECT pg_temp.seed_venta(22, 10, 4);

SET LOCAL app.usuario_id = '2';
SELECT fn_cambiar_estado_existencia(15, 'disponible', 'danada', 2, 2, 'Cerdas deformadas');
SELECT fn_cambiar_estado_existencia(18, 'disponible', 'reservada', 6, 2, 'Separado para Construcciones del Alto');
