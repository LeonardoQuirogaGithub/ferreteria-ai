import type { ZodTypeAny } from 'zod';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { StateTransferSchema } from '../modules/inventory/inventory.routes.js';
import { ConversionSchema, ProductCreateSchema, TechnicalSheetSchema } from '../modules/products/products.schemas.js';
import { PurchaseSchema, VoidSchema } from '../modules/purchases/purchases.routes.js';
import { CalculateSchema, PaintParamsSchema, PatchQuotationSchema, SaveQuotationSchema } from '../modules/quotations/quotations.schemas.js';
import { SaleSchema } from '../modules/sales/sales.routes.js';
import { ThirdPartySchema } from '../modules/thirdparties/thirdparties.routes.js';

type Method = 'get' | 'post' | 'patch' | 'put';
interface Route {
  m: Method;
  p: string;
  tag: string;
  summary: string;
  perm?: string;
  body?: ZodTypeAny;
  publico?: boolean;
  req?: string;
}

const Login = z.object({ correo: z.string().email(), contrasena: z.string() });
const Refresh = z.object({ refreshToken: z.string() });
const Chat = z.object({ mensaje: z.string().max(2000), conversacion_id: z.string().uuid().optional() });

// Inventario de endpoints. Cada entrada indica el permiso que exige el backend.
const routes: Route[] = [
  { m: 'post', p: '/auth/login', tag: 'Autenticación', summary: 'Iniciar sesión', body: Login, publico: true, req: 'RF-SEG-001' },
  { m: 'post', p: '/auth/refresh', tag: 'Autenticación', summary: 'Renovar tokens (rotación)', body: Refresh, publico: true },
  { m: 'post', p: '/auth/logout', tag: 'Autenticación', summary: 'Revocar el token de renovación', body: Refresh, publico: true },
  { m: 'get', p: '/auth/me', tag: 'Autenticación', summary: 'Usuario, roles y permisos de la sesión' },

  { m: 'get', p: '/products', tag: 'Catálogo', summary: 'Buscar productos (q, marcaId, categoriaId, incluirInactivos, page, pageSize)', perm: 'inventario.consultar', req: 'RF-PRO-003' },
  { m: 'get', p: '/products/barcode/{codigo}', tag: 'Catálogo', summary: 'Consulta por código de barras (lector)', perm: 'inventario.consultar', req: 'RF-LEC-001' },
  { m: 'get', p: '/products/{id}', tag: 'Catálogo', summary: 'Detalle con existencias, conversiones, ficha técnica y lotes', perm: 'inventario.consultar' },
  { m: 'post', p: '/products', tag: 'Catálogo', summary: 'Registrar producto', perm: 'producto.gestionar', body: ProductCreateSchema, req: 'RF-PRO-001' },
  { m: 'patch', p: '/products/{id}', tag: 'Catálogo', summary: 'Modificar producto', perm: 'producto.gestionar', body: ProductCreateSchema.partial() },
  { m: 'post', p: '/products/{id}/conversions', tag: 'Catálogo', summary: 'Agregar conversión de unidad', perm: 'conversion.gestionar', body: ConversionSchema, req: 'RF-PRO-002' },
  { m: 'put', p: '/products/{id}/technical-sheet', tag: 'Catálogo', summary: 'Registrar ficha técnica', perm: 'producto.gestionar', body: TechnicalSheetSchema },
  { m: 'get', p: '/brands', tag: 'Catálogo', summary: 'Marcas', perm: 'inventario.consultar', req: 'RF-CAT-001' },
  { m: 'post', p: '/brands', tag: 'Catálogo', summary: 'Crear marca', perm: 'producto.gestionar' },
  { m: 'get', p: '/categories', tag: 'Catálogo', summary: 'Categorías', perm: 'inventario.consultar' },
  { m: 'post', p: '/categories', tag: 'Catálogo', summary: 'Crear categoría', perm: 'producto.gestionar' },
  { m: 'get', p: '/units', tag: 'Catálogo', summary: 'Unidades de medida', perm: 'inventario.consultar' },
  { m: 'post', p: '/units', tag: 'Catálogo', summary: 'Crear unidad', perm: 'producto.gestionar' },

  { m: 'get', p: '/inventory', tag: 'Inventario', summary: 'Existencias por estado (misma búsqueda que productos)', perm: 'inventario.consultar' },
  { m: 'get', p: '/inventory/out-of-stock', tag: 'Inventario', summary: 'Productos activos con disponible = 0', perm: 'inventario.consultar' },
  { m: 'get', p: '/inventory/low-stock', tag: 'Inventario', summary: 'Disponible <= stock mínimo (o < umbral)', perm: 'inventario.consultar' },
  { m: 'get', p: '/inventory/lots', tag: 'Inventario', summary: 'Lotes por vencer o con garantía', perm: 'inventario.consultar', req: 'RF-LOT-001' },
  { m: 'get', p: '/inventory/movements', tag: 'Inventario', summary: 'Kardex', perm: 'kardex.consultar', req: 'RF-MOV-001' },
  { m: 'post', p: '/inventory/state-transfers', tag: 'Inventario', summary: 'Cambio de estado de existencia', perm: 'inventario.cambiar_estado', body: StateTransferSchema, req: 'RF-EST-001' },
  { m: 'get', p: '/inventory/{productId}', tag: 'Inventario', summary: 'Existencias y lotes de un producto', perm: 'inventario.consultar' },

  { m: 'get', p: '/third-parties', tag: 'Terceros', summary: 'Listar clientes y proveedores', perm: 'tercero.gestionar' },
  { m: 'post', p: '/third-parties', tag: 'Terceros', summary: 'Registrar tercero', perm: 'tercero.gestionar', body: ThirdPartySchema, req: 'RF-TER-001' },
  { m: 'get', p: '/third-parties/{id}', tag: 'Terceros', summary: 'Detalle de tercero', perm: 'tercero.gestionar' },
  { m: 'patch', p: '/third-parties/{id}', tag: 'Terceros', summary: 'Modificar tercero', perm: 'tercero.gestionar' },

  { m: 'get', p: '/purchases', tag: 'Compras', summary: 'Listar compras', perm: 'compra.registrar' },
  { m: 'post', p: '/purchases', tag: 'Compras', summary: 'Registrar compra y documento de ingreso', perm: 'compra.registrar', body: PurchaseSchema, req: 'RF-COM-001' },
  { m: 'get', p: '/purchases/{id}', tag: 'Compras', summary: 'Documento de ingreso', perm: 'compra.registrar' },
  { m: 'post', p: '/purchases/{id}/void', tag: 'Compras', summary: 'Anular compra', perm: 'documento.anular', body: VoidSchema, req: 'RF-DOC-001' },
  { m: 'get', p: '/sales', tag: 'Ventas', summary: 'Listar ventas', perm: 'venta.registrar' },
  { m: 'post', p: '/sales', tag: 'Ventas', summary: 'Registrar venta y factura (precios del servidor)', perm: 'venta.registrar', body: SaleSchema, req: 'RF-VEN-001' },
  { m: 'get', p: '/sales/{id}', tag: 'Ventas', summary: 'Factura', perm: 'venta.registrar' },
  { m: 'post', p: '/sales/{id}/void', tag: 'Ventas', summary: 'Anular venta', perm: 'documento.anular', body: VoidSchema, req: 'RF-DOC-001' },

  { m: 'get', p: '/prices/{productId}/history', tag: 'Precios', summary: 'Historial de costos y precios', perm: 'inventario.consultar', req: 'RF-PRE-001' },
  { m: 'post', p: '/prices/{productId}/manual', tag: 'Precios', summary: 'Fijar precio manual', perm: 'precio.gestionar', req: 'RF-PRE-002' },
  { m: 'post', p: '/prices/{productId}/percentage', tag: 'Precios', summary: 'Cambiar porcentaje de incremento', perm: 'precio.gestionar' },

  { m: 'get', p: '/quotations', tag: 'Cotizaciones', summary: 'Listar cotizaciones', perm: 'cotizacion.gestionar' },
  { m: 'post', p: '/quotations/calculate', tag: 'Cotizaciones', summary: 'Valorar productos y cantidades (sin guardar)', perm: 'cotizacion.gestionar', body: CalculateSchema },
  { m: 'post', p: '/quotations/paint/calculate', tag: 'Cotizaciones', summary: 'Estimar materiales de pintura y valorarlos', perm: 'cotizacion.gestionar', body: PaintParamsSchema },
  { m: 'post', p: '/quotations', tag: 'Cotizaciones', summary: 'Guardar cotización (revalida precios y existencias)', perm: 'cotizacion.gestionar', body: SaveQuotationSchema },
  { m: 'get', p: '/quotations/{id}', tag: 'Cotizaciones', summary: 'Detalle por id o número COT-', perm: 'cotizacion.gestionar' },
  { m: 'patch', p: '/quotations/{id}', tag: 'Cotizaciones', summary: 'Aceptar o anular', perm: 'cotizacion.gestionar', body: PatchQuotationSchema },

  { m: 'post', p: '/ai/chat', tag: 'Asistente IA', summary: 'Enviar mensaje al asistente', perm: 'ia.usar', body: Chat },
  { m: 'get', p: '/ai/status', tag: 'Asistente IA', summary: 'Conectividad con Ollama y modelo configurado', perm: 'ia.usar' },
  { m: 'get', p: '/ai/models', tag: 'Asistente IA', summary: 'Modelos instalados en Ollama', perm: 'ia.usar' },
  { m: 'get', p: '/ai/conversations', tag: 'Asistente IA', summary: 'Conversaciones del usuario', perm: 'ia.usar' },
  { m: 'get', p: '/ai/conversations/{id}', tag: 'Asistente IA', summary: 'Mensajes de una conversación propia', perm: 'ia.usar' },

  { m: 'get', p: '/reports/dashboard', tag: 'Reportes', summary: 'Indicadores del dashboard', perm: 'inventario.consultar' },
  { m: 'get', p: '/reports/valuation', tag: 'Reportes', summary: 'Valorización (R-01)', perm: 'reporte.consultar + costo.consultar', req: 'RF-REP-001' },
  { m: 'get', p: '/reports/low-stock', tag: 'Reportes', summary: 'Stock mínimo (R-02)', perm: 'reporte.consultar' },
  { m: 'get', p: '/reports/expiring', tag: 'Reportes', summary: 'Lotes por vencer (R-03)', perm: 'reporte.consultar' },
  { m: 'get', p: '/reports/top-selling', tag: 'Reportes', summary: 'Más vendidos (R-04)', perm: 'reporte.consultar' },
  { m: 'get', p: '/reports/warranties', tag: 'Reportes', summary: 'Productos con garantía (R-07)', perm: 'reporte.consultar' },
  { m: 'get', p: '/reports/sales', tag: 'Reportes', summary: 'Ventas del período', perm: 'reporte.consultar' },
  { m: 'get', p: '/reports/purchases', tag: 'Reportes', summary: 'Compras del período', perm: 'reporte.consultar' },

  { m: 'get', p: '/users', tag: 'Administración', summary: 'Usuarios', perm: 'usuario.gestionar', req: 'RF-SEG-002' },
  { m: 'post', p: '/users', tag: 'Administración', summary: 'Crear usuario', perm: 'usuario.gestionar' },
  { m: 'patch', p: '/users/{id}', tag: 'Administración', summary: 'Modificar o desactivar usuario', perm: 'usuario.gestionar' },
  { m: 'get', p: '/roles', tag: 'Administración', summary: 'Roles y permisos', perm: 'usuario.gestionar' },
  { m: 'put', p: '/roles/{id}/permissions', tag: 'Administración', summary: 'Reemplazar permisos de un rol', perm: 'usuario.gestionar' },
  { m: 'get', p: '/permissions', tag: 'Administración', summary: 'Catálogo de permisos', perm: 'usuario.gestionar' },
  { m: 'get', p: '/audit', tag: 'Administración', summary: 'Consultar auditoría (R-08)', perm: 'auditoria.consultar', req: 'RF-AUD-001' },
  { m: 'get', p: '/closures', tag: 'Administración', summary: 'Cierres mensuales', perm: 'cierre.ejecutar' },
  { m: 'get', p: '/closures/pending', tag: 'Administración', summary: 'Operaciones pendientes y conflictos antes del cierre', perm: 'cierre.ejecutar' },
  { m: 'post', p: '/closures', tag: 'Administración', summary: 'Ejecutar cierre de un período', perm: 'cierre.ejecutar', req: 'RF-CIE-001' },
  { m: 'get', p: '/closures/{id}', tag: 'Administración', summary: 'Fotografía del cierre', perm: 'cierre.ejecutar' },

  { m: 'get', p: '/imports', tag: 'Migración', summary: 'Importaciones', perm: 'migracion.ejecutar', req: 'RF-MIG-001' },
  { m: 'get', p: '/imports/template/{tipo}', tag: 'Migración', summary: 'Plantilla .xlsx', perm: 'migracion.ejecutar' },
  { m: 'post', p: '/imports', tag: 'Migración', summary: 'Subir Excel (multipart: archivo, tipo, fecha_corte) y validar', perm: 'migracion.ejecutar' },
  { m: 'get', p: '/imports/{id}', tag: 'Migración', summary: 'Filas validadas y errores', perm: 'migracion.ejecutar' },
  { m: 'post', p: '/imports/{id}/confirm', tag: 'Migración', summary: 'Cargar filas válidas', perm: 'migracion.ejecutar' },

  { m: 'post', p: '/integration/events', tag: 'Integración', summary: 'Recibir evento externo idempotente', perm: 'integracion.ejecutar', req: 'RF-INT-001' },
  { m: 'post', p: '/integration/offline/sales', tag: 'Integración', summary: 'Sincronizar venta offline por UUID', perm: 'integracion.ejecutar', req: 'RF-OFF-001' },
  { m: 'get', p: '/integration/events', tag: 'Integración', summary: 'Eventos y conflictos', perm: 'integracion.ejecutar' },
  { m: 'post', p: '/integration/events/{id}/retry', tag: 'Integración', summary: 'Reintentar un conflicto', perm: 'cierre.ejecutar' },
];

const ErrorSchema = {
  type: 'object',
  properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} } } },
};

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const r of routes) {
    const params = [...r.p.matchAll(/\{(\w+)\}/g)].map((m) => ({ name: m[1], in: 'path', required: true, schema: { type: 'string' } }));
    paths[r.p] ??= {};
    paths[r.p][r.m] = {
      tags: [r.tag],
      summary: r.summary,
      description: [r.perm ? `Permiso: \`${r.perm}\`.` : null, r.req ? `Requisito: ${r.req}.` : null].filter(Boolean).join(' ') || undefined,
      ...(r.publico ? { security: [] } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(r.body
        ? { requestBody: { required: true, content: { 'application/json': { schema: zodToJsonSchema(r.body, { target: 'openApi3', $refStrategy: 'none' }) } } } }
        : {}),
      responses: {
        200: { description: 'OK' },
        400: { description: 'Datos inválidos', content: { 'application/json': { schema: ErrorSchema } } },
        401: { description: 'No autenticado' },
        403: { description: 'Sin permiso' },
        404: { description: 'No encontrado' },
        409: { description: 'Conflicto (duplicado o precios cambiados)' },
        422: { description: 'Regla de negocio violada', content: { 'application/json': { schema: ErrorSchema } } },
      },
    };
  }
  return {
    openapi: '3.0.3',
    info: {
      title: 'Ferretería AI — API de inventario',
      version: '0.1.0',
      description:
        'API REST del sistema de inventario. Todas las rutas, salvo las de autenticación, exigen `Authorization: Bearer <accessToken>`. ' +
        'Errores con formato común `{ error: { code, message, details? } }`. Listas paginadas con `page` y `pageSize`.',
    },
    servers: [{ url: '/api' }],
    components: { securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    security: [{ bearerAuth: [] }],
    paths,
  };
}
