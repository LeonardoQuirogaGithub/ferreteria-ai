-- Seed 001: roles y permisos (configuración base, necesaria también fuera de la demo).
-- Tomado de seed_datos_prueba.sql y ampliado con los permisos del asistente y cotizaciones.
-- La matriz definitiva de permisos está por definir (DP-02).

SET LOCAL app.suprimir_auditoria = 'on';

INSERT INTO rol (id, nombre, descripcion) VALUES
    (1, 'Administrador', 'Administra usuarios, permisos, cierres y migración'),
    (2, 'Inventario', 'Gestiona catálogo, estados, precios y kardex'),
    (3, 'Compras', 'Registra proveedores y compras'),
    (4, 'Ventas', 'Registra clientes, ventas y facturas'),
    (5, 'Gerencia', 'Consulta reportes y auditoría');

INSERT INTO permiso (id, codigo, descripcion) VALUES
    (1, 'usuario.gestionar', 'Crear, modificar y desactivar usuarios'),
    (2, 'producto.gestionar', 'Crear y modificar productos y catálogos'),
    (3, 'conversion.gestionar', 'Gestionar conversiones'),
    (4, 'tercero.gestionar', 'Gestionar clientes y proveedores'),
    (5, 'compra.registrar', 'Registrar compras'),
    (6, 'venta.registrar', 'Registrar ventas'),
    (7, 'inventario.cambiar_estado', 'Cambiar estado de existencias'),
    (8, 'precio.gestionar', 'Gestionar precios'),
    (9, 'cierre.ejecutar', 'Ejecutar cierre mensual'),
    (10, 'reporte.consultar', 'Consultar reportes'),
    (11, 'auditoria.consultar', 'Consultar auditoría'),
    (12, 'migracion.ejecutar', 'Migrar datos desde Excel'),
    (13, 'documento.anular', 'Anular compras o ventas'),
    (14, 'inventario.consultar', 'Consultar productos, existencias y precios de venta'),
    (15, 'costo.consultar', 'Ver costos y valorización del inventario'),
    (16, 'kardex.consultar', 'Consultar movimientos y kardex'),
    (17, 'cotizacion.gestionar', 'Calcular, guardar y consultar cotizaciones'),
    (18, 'ia.usar', 'Usar el asistente de IA'),
    (19, 'integracion.ejecutar', 'Enviar eventos externos y sincronizar operaciones offline');

INSERT INTO rol_permiso (rol_id, permiso_id)
SELECT 1, p.id FROM permiso p
UNION ALL
SELECT 2, p.id FROM permiso p WHERE p.codigo IN (
    'producto.gestionar', 'conversion.gestionar', 'inventario.cambiar_estado', 'precio.gestionar',
    'reporte.consultar', 'inventario.consultar', 'costo.consultar', 'kardex.consultar',
    'cotizacion.gestionar', 'ia.usar')
UNION ALL
SELECT 3, p.id FROM permiso p WHERE p.codigo IN (
    'tercero.gestionar', 'compra.registrar', 'inventario.consultar', 'costo.consultar', 'ia.usar')
UNION ALL
SELECT 4, p.id FROM permiso p WHERE p.codigo IN (
    'tercero.gestionar', 'venta.registrar', 'inventario.consultar', 'cotizacion.gestionar',
    'ia.usar', 'integracion.ejecutar')
UNION ALL
SELECT 5, p.id FROM permiso p WHERE p.codigo IN (
    'reporte.consultar', 'auditoria.consultar', 'inventario.consultar', 'costo.consultar',
    'kardex.consultar', 'cotizacion.gestionar', 'ia.usar');

SELECT setval(pg_get_serial_sequence('rol', 'id'), (SELECT max(id) FROM rol));
SELECT setval(pg_get_serial_sequence('permiso', 'id'), (SELECT max(id) FROM permiso));
