import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { AppError, mapDatabaseError } from '../../lib/errors.js';
import { searchTokens } from '../../lib/search.js';
import { can, type AuthUser } from '../../middlewares/auth.js';
import * as inventory from '../inventory/inventory.repository.js';
import * as products from '../products/products.repository.js';
import { presentProduct } from '../products/products.service.js';
import { PaintParamsSchema } from '../quotations/quotations.schemas.js';
import * as quotations from '../quotations/quotations.service.js';
import type { ToolDefinition } from './ollama.client.js';

// Herramientas que el modelo puede SOLICITAR. El backend valida los argumentos con Zod, verifica
// permisos y ejecuta consultas parametrizadas. Ninguna herramienta modifica inventario ni precios.

export type ArtifactKind = 'productos' | 'existencias' | 'alertas' | 'precio' | 'detalle' | 'pintura' | 'cotizacion' | 'borrador_cotizacion' | 'estado_cotizacion';

export interface ToolResult {
  data: unknown;
  artifact?: { tipo: ArtifactKind; datos: unknown };
}

interface Tool<S extends z.ZodTypeAny> {
  name: string;
  description: string;
  schema: S;
  permission: string;
  run(args: z.infer<S>, user: AuthUser): Promise<ToolResult>;
}

const define = <S extends z.ZodTypeAny>(t: Tool<S>) => t;

// Los textos libres de la base se recortan: son datos, y no deben inflar el contexto del modelo.
const clip = (s: string | null | undefined, n = 200) => (s == null ? s : s.length > n ? `${s.slice(0, n)}…` : s);

function brief(p: ReturnType<typeof presentProduct>) {
  return {
    producto_id: p.id,
    codigo_barras: p.codigo_barras,
    nombre: p.nombre,
    marca: p.marca,
    presentacion: p.presentacion,
    categoria: p.categoria,
    unidad_base: p.unidad_codigo,
    disponible: p.disponible,
    reservada: p.reservada,
    danada: p.danada,
    stock_minimo: p.stock_minimo,
    estado_stock: p.estado_stock,
    activo: p.activo,
    precio_vigente: p.precio_vigente,
  };
}

const ProductRef = z
  .object({
    producto_id: z.number().int().positive().optional(),
    codigo_barras: z.string().trim().min(3).max(50).optional(),
  })
  .refine((v) => v.producto_id != null || v.codigo_barras != null, { message: 'Indique producto_id o codigo_barras' });

async function findRef(ref: { producto_id?: number; codigo_barras?: string }) {
  return ref.producto_id != null ? products.findById(ref.producto_id) : products.findByBarcode(ref.codigo_barras!);
}

const ItemsSchema = z
  .array(z.object({ producto_id: z.number().int().positive(), cantidad: z.number().positive(), unidad_id: z.number().int().positive().optional() }))
  .min(1)
  .max(50);

export const TOOLS = [
  define({
    name: 'buscar_productos',
    description: 'Busca productos del catálogo por nombre, código de barras, marca, categoría o términos. Devuelve solo coincidencias reales.',
    permission: 'inventario.consultar',
    schema: z.object({
      texto: z.string().trim().min(1).max(120).describe('Términos de búsqueda o código de barras'),
      incluir_inactivos: z.boolean().optional(),
      limite: z.number().int().min(1).max(20).optional(),
    }),
    async run(a, user) {
      const tokens = searchTokens(a.texto);
      const rows = await products.search({ texto: a.texto, tokens, incluirInactivos: a.incluir_inactivos, limit: a.limite ?? 8, offset: 0 });
      const best = rows[0]?.score ?? 0;
      const items = rows.map((r) => ({ ...brief(presentProduct(r, user)), terminos_coincidentes: r.score, terminos_buscados: tokens.length }));
      return {
        data: {
          total: items.length,
          coincidencia_unica: items.length === 1 || (items.length > 1 && (rows[1]?.score ?? 0) < best),
          productos: items,
          mensaje: items.length === 0 ? 'No hay productos en el catálogo que coincidan con la búsqueda' : undefined,
        },
        artifact: items.length ? { tipo: 'productos', datos: items } : undefined,
      };
    },
  }),
  define({
    name: 'consultar_existencias',
    description: 'Consulta la existencia disponible, reservada y dañada de un producto en su unidad base. Distingue existencia cero de producto inexistente.',
    permission: 'inventario.consultar',
    schema: ProductRef,
    async run(a, user) {
      const row = await findRef(a);
      if (!row) return { data: { encontrado: false, motivo: 'El producto no existe en el catálogo' } };
      const conv = (await products.conversions(row.id)).filter((c) => c.tipo === 'venta' && c.unidad_id !== row.unidad_base_id);
      const p = presentProduct(row, user);
      const data = {
        encontrado: true,
        ...brief(p),
        unidad_base_nombre: row.unidad_nombre,
        total_fisico: (Number(row.disponible) + Number(row.reservada) + Number(row.danada)).toFixed(4),
        vendible: Number(row.disponible) > 0 && row.activo,
        conversiones_venta: conv.map((c) => ({ unidad: c.unidad_codigo, unidades_base_por_unidad: c.factor_a_base })),
        consultado_en: new Date().toISOString(),
      };
      return { data, artifact: { tipo: 'existencias', datos: data } };
    },
  }),
  define({
    name: 'consultar_productos_agotados',
    description: 'Lista productos activos con existencia DISPONIBLE igual a cero (pueden tener existencia reservada o dañada, que no se vende).',
    permission: 'inventario.consultar',
    schema: z.object({ limite: z.number().int().min(1).max(50).optional() }),
    async run(a, user) {
      const rows = await inventory.outOfStock(a.limite ?? 30, 0);
      const items = rows.map((r) => brief(presentProduct(r, user)));
      const data = { total: Number(rows[0]?.total_count ?? 0), mostrados: items.length, productos: items };
      return { data, artifact: { tipo: 'alertas', datos: { titulo: 'Productos agotados', ...data } } };
    },
  }),
  define({
    name: 'consultar_stock_minimo',
    description:
      'Productos activos que necesitan reposición: disponible menor o igual al stock mínimo, o menor que un umbral si se indica. Cada producto indica si está agotado o bajo mínimo.',
    permission: 'inventario.consultar',
    schema: z.object({
      umbral: z.number().positive().max(100000).optional().describe('Ej.: 5 para "menos de 5 unidades"'),
      incluir_agotados: z.boolean().optional(),
      limite: z.number().int().min(1).max(50).optional(),
    }),
    async run(a, user) {
      const rows = await inventory.lowStock({ umbral: a.umbral, incluirAgotados: a.incluir_agotados ?? true, limit: a.limite ?? 30, offset: 0 });
      const items = rows.map((r) => brief(presentProduct(r, user)));
      const data = {
        criterio: a.umbral != null ? `disponible < ${a.umbral}` : 'disponible <= stock mínimo',
        total: Number(rows[0]?.total_count ?? 0),
        agotados: items.filter((i) => i.estado_stock === 'agotado').length,
        bajo_minimo: items.filter((i) => i.estado_stock !== 'agotado').length,
        productos: items,
      };
      return { data, artifact: { tipo: 'alertas', datos: { titulo: 'Productos para reponer', ...data } } };
    },
  }),
  define({
    name: 'consultar_precio_vigente',
    description: 'Devuelve el precio de venta vigente por unidad base. El costo solo se incluye si el usuario tiene permiso.',
    permission: 'inventario.consultar',
    schema: ProductRef,
    async run(a, user) {
      const row = await findRef(a);
      if (!row) return { data: { encontrado: false, motivo: 'El producto no existe en el catálogo' } };
      const data = {
        encontrado: true,
        producto_id: row.id,
        nombre: row.nombre,
        marca: row.marca,
        presentacion: row.presentacion,
        unidad: row.unidad_codigo,
        precio_vigente: row.precio_vigente,
        tiene_precio: row.precio_vigente != null,
        es_precio_manual: row.tiene_precio_manual,
        activo: row.activo,
        ...(can(user, 'costo.consultar') ? { costo_promedio: row.costo_promedio } : {}),
      };
      return { data, artifact: { tipo: 'precio', datos: data } };
    },
  }),
  define({
    name: 'consultar_detalle_producto',
    description: 'Detalle de un producto: descripción, marca, presentación, unidad, conversiones y ficha técnica registrada.',
    permission: 'inventario.consultar',
    schema: ProductRef,
    async run(a, user) {
      const row = await findRef(a);
      if (!row) return { data: { encontrado: false, motivo: 'El producto no existe en el catálogo' } };
      const [conv, ficha] = await Promise.all([products.conversions(row.id), products.technicalSheet(row.id)]);
      const data = {
        encontrado: true,
        ...brief(presentProduct(row, user)),
        descripcion: clip(row.descripcion),
        controla_vencimiento: row.controla_vencimiento,
        controla_garantia: row.controla_garantia,
        conversiones: conv.map((c) => ({ unidad: c.unidad_codigo, tipo: c.tipo, factor_a_base: c.factor_a_base })),
        ficha_tecnica: ficha
          ? { ...ficha, compatibilidad: clip(ficha.compatibilidad), observaciones_fabricante: clip(ficha.observaciones_fabricante) }
          : 'Sin ficha técnica registrada',
      };
      return { data, artifact: { tipo: 'detalle', datos: data } };
    },
  }),
  define({
    name: 'consultar_materiales_pintura',
    description:
      'Calcula de forma determinista el área neta, los litros de pintura y los materiales auxiliares de un trabajo de pintura, y los valora con productos y precios reales. Si faltan datos devuelve las preguntas a hacer.',
    permission: 'cotizacion.gestionar',
    schema: PaintParamsSchema,
    async run(a) {
      const r = await quotations.calculatePaint(a);
      return { data: r, artifact: { tipo: 'pintura', datos: r } };
    },
  }),
  define({
    name: 'calcular_cotizacion',
    description: 'Valora productos y cantidades con el precio vigente y la existencia disponible del servidor. No guarda nada.',
    permission: 'cotizacion.gestionar',
    schema: z.object({ items: ItemsSchema }),
    async run(a) {
      const r = await quotations.priceLines(a.items.map((i) => ({ ...i, rol: 'manual' as const })));
      return { data: r, artifact: { tipo: 'cotizacion', datos: r } };
    },
  }),
  define({
    name: 'guardar_cotizacion',
    description:
      'Prepara una cotización revalidada con precios y existencias actuales para que el usuario la confirme y guarde en la aplicación. No genera ventas ni modifica inventario.',
    permission: 'cotizacion.gestionar',
    schema: z.object({
      descripcion_proyecto: z.string().trim().min(3).max(500),
      cliente_id: z.number().int().positive().optional(),
      tipo: z.enum(['general', 'pintura']).default('general'),
      items: z
        .array(
          z.object({
            producto_id: z.number().int().positive(),
            cantidad: z.number().positive(),
            unidad_id: z.number().int().positive().optional(),
            rol: z.enum(['pintura', 'auxiliar', 'manual']).optional(),
          }),
        )
        .min(1)
        .max(50),
    }),
    async run(a) {
      const priced = await quotations.priceLines(a.items.map((i) => ({ ...i, rol: i.rol ?? 'manual' })));
      const borrador = {
        estado: 'pendiente_confirmacion',
        mensaje: 'Borrador listo. El usuario debe confirmarlo en pantalla para guardarlo; los precios se verificarán de nuevo al guardar.',
        descripcion_proyecto: a.descripcion_proyecto,
        cliente_id: a.cliente_id ?? null,
        tipo: a.tipo,
        ...priced,
      };
      return { data: borrador, artifact: { tipo: 'borrador_cotizacion', datos: borrador } };
    },
  }),
  define({
    name: 'consultar_estado_cotizacion',
    description: 'Consulta una cotización guardada por su número (COT-000001) según los permisos del usuario.',
    permission: 'cotizacion.gestionar',
    schema: z.object({ numero: z.string().trim().regex(/^COT-\d{1,10}$/i, 'Formato COT-000001') }),
    async run(a, user) {
      try {
        const q = await quotations.detail(a.numero, user);
        const data = {
          encontrada: true,
          numero: q.numero,
          estado: q.estado_efectivo,
          creada_en: q.creada_en,
          vence_en: q.vence_en,
          total: q.total,
          total_disponible: q.total_disponible,
          lineas: q.lineas.length,
        };
        return { data, artifact: { tipo: 'estado_cotizacion', datos: { ...data, id: q.id } } };
      } catch (error) {
        if (error instanceof AppError && error.status === 404) return { data: { encontrada: false, motivo: 'No existe o no tiene acceso' } };
        throw error;
      }
    },
  }),
];

export type AnyTool = (typeof TOOLS)[number];

/** Solo se exponen al modelo las herramientas que el usuario puede ejecutar. */
export function toolsFor(user: AuthUser) {
  return TOOLS.filter((t) => can(user, t.permission));
}

export function toolDefinitions(tools: AnyTool[]): ToolDefinition[] {
  return tools.map((t) => {
    const { $schema: _s, definitions: _d, ...parameters } = zodToJsonSchema(t.schema, { target: 'openApi3', $refStrategy: 'none' }) as Record<string, unknown>;
    return { type: 'function', function: { name: t.name, description: t.description, parameters } };
  });
}

export interface ToolExecution {
  nombre: string;
  ok: boolean;
  ms: number;
  error?: string;
  result?: ToolResult;
}

/** Valida y ejecuta la llamada solicitada por el modelo. Nunca lanza: devuelve el error como dato. */
export async function executeTool(name: string, rawArgs: unknown, user: AuthUser): Promise<ToolExecution> {
  const started = Date.now();
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) return { nombre: name, ok: false, ms: 0, error: `La herramienta "${name}" no existe` };
  if (!can(user, tool.permission)) return { nombre: name, ok: false, ms: 0, error: 'El usuario no tiene permiso para esta herramienta' };
  let args: unknown = rawArgs;
  if (typeof rawArgs === 'string') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      return { nombre: name, ok: false, ms: 0, error: 'Argumentos con JSON inválido' };
    }
  }
  const parsed = tool.schema.safeParse(args ?? {});
  if (!parsed.success) {
    const detalle = parsed.error.issues.map((i) => `${i.path.join('.') || 'argumentos'}: ${i.message}`).join('; ');
    return { nombre: name, ok: false, ms: Date.now() - started, error: `Argumentos inválidos: ${detalle}` };
  }
  try {
    // El cast es seguro: `parsed.data` fue validado con el esquema de esta misma herramienta.
    const result = await (tool.run as (a: unknown, u: AuthUser) => Promise<ToolResult>)(parsed.data, user);
    return { nombre: name, ok: true, ms: Date.now() - started, result };
  } catch (error) {
    const mapped = error instanceof AppError ? error : mapDatabaseError(error);
    const detalle = (mapped?.details as { errores?: string[] } | undefined)?.errores?.join('; ');
    return {
      nombre: name,
      ok: false,
      ms: Date.now() - started,
      error: mapped ? `${mapped.message}${detalle ? `: ${detalle}` : ''}` : 'Error interno al consultar los datos',
    };
  }
}
