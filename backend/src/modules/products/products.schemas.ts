import { z } from 'zod';
import { PaginationSchema } from '../../lib/http.js';

const texto = (max: number) => z.string().trim().min(1).max(max);
const boolQuery = z
  .union([z.boolean(), z.enum(['true', 'false'])])
  .transform((v) => v === true || v === 'true')
  .optional();

export const ProductQuerySchema = PaginationSchema.extend({
  q: z.string().trim().max(120).optional(),
  marcaId: z.coerce.number().int().positive().optional(),
  categoriaId: z.coerce.number().int().positive().optional(),
  incluirInactivos: boolQuery,
});

export const ProductCreateSchema = z.object({
  codigo_barras: z.string().trim().regex(/^[0-9A-Za-z\-]{3,50}$/, 'Código de barras inválido'),
  nombre: texto(150),
  descripcion: z.string().trim().max(2000).nullish(),
  marca_id: z.number().int().positive(),
  presentacion: texto(100),
  categoria_id: z.number().int().positive().nullish(),
  unidad_base_id: z.number().int().positive(),
  decimales_permitidos: z.number().int().min(0).max(4),
  controla_vencimiento: z.boolean(),
  controla_garantia: z.boolean(),
  porcentaje_incremento: z.number().min(0, 'El porcentaje no puede ser negativo').max(999),
  stock_minimo: z.number().min(0, 'El stock mínimo no puede ser negativo'),
  activo: z.boolean().optional(),
});

export const ProductUpdateSchema = ProductCreateSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'Indique al menos un campo',
});

export const ConversionSchema = z.object({
  unidad_id: z.number().int().positive(),
  tipo: z.enum(['compra', 'venta']),
  factor_a_base: z.number().positive('El factor de conversión debe ser mayor que cero'),
});

export const TechnicalSheetSchema = z
  .object({
    tipo_producto: z.enum(['pintura', 'sellador', 'masilla', 'lija', 'rodillo', 'brocha', 'bandeja', 'cinta', 'plastico', 'otro']),
    linea: z.string().trim().max(100).nullish(),
    superficies: z.array(z.enum(['pared', 'techo', 'madera', 'metal', 'piso'])).max(5).default([]),
    acabado: z.string().trim().max(50).nullish(),
    contenido_litros: z.number().positive().nullish(),
    rendimiento: z.number().positive().nullish(),
    unidad_rendimiento: z.enum(['m2_por_litro', 'm2_por_unidad']).nullish(),
    manos_recomendadas: z.number().int().min(1).max(5).nullish(),
    compatibilidad: z.string().trim().max(500).nullish(),
    observaciones_fabricante: z.string().trim().max(1000).nullish(),
    fuente: z.string().trim().max(200).nullish(),
  })
  .refine((v) => (v.rendimiento == null) === (v.unidad_rendimiento == null), {
    message: 'El rendimiento y su unidad se registran juntos',
    path: ['unidad_rendimiento'],
  })
  .refine((v) => v.unidad_rendimiento !== 'm2_por_litro' || v.contenido_litros != null, {
    message: 'Un rendimiento por litro exige el contenido en litros de la presentación',
    path: ['contenido_litros'],
  });

export type ProductCreate = z.infer<typeof ProductCreateSchema>;
