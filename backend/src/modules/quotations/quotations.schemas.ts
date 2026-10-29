import { z } from 'zod';

const medida = z.number().positive().max(1000);

export const QuoteItemSchema = z.object({
  producto_id: z.number().int().positive(),
  cantidad: z.number().positive('La cantidad debe ser mayor que cero').max(1_000_000),
  unidad_id: z.number().int().positive().optional(),
  rol: z.enum(['pintura', 'auxiliar', 'manual']).default('manual'),
  cantidad_necesaria: z.number().min(0).nullish(),
  unidad_necesaria: z.string().max(20).nullish(),
  precio_unitario_esperado: z.number().min(0).optional(),
});

export const CalculateSchema = z.object({
  items: z.array(QuoteItemSchema).min(1).max(100),
});

export const PaintParamsSchema = z
  .object({
    descripcion_proyecto: z.string().trim().max(500).optional(),
    espacios: z
      .array(z.object({ nombre: z.string().max(60).optional(), largo: medida, ancho: medida, alto: medida, cantidad: z.number().int().min(1).max(100).optional() }))
      .max(50)
      .optional(),
    area_paredes_m2: z.number().positive().max(100000).optional(),
    area_techo_m2: z.number().positive().max(100000).optional(),
    area_construccion_m2: z.number().positive().max(100000).optional(),
    permitir_estimacion: z.boolean().default(false),
    incluir_paredes: z.boolean().default(true),
    incluir_techo: z.boolean().default(false),
    aberturas: z
      .array(z.object({ tipo: z.enum(['puerta', 'ventana', 'otro']).optional(), ancho: medida, alto: medida, cantidad: z.number().int().min(1).max(200).optional() }))
      .max(100)
      .optional(),
    manos: z.number().int().min(1).max(5).optional(),
    desperdicio_pct: z.number().min(0).max(50).optional(),
    estado_superficie: z.enum(['nueva', 'buena', 'regular', 'deteriorada']).default('buena'),
    requiere_sellador: z.boolean().optional(),
    producto_pintura_id: z.number().int().positive().optional(),
    producto_pintura_techo_id: z.number().int().positive().optional(),
    rendimiento_m2_por_litro: z.number().positive().max(100).optional(),
    acabado: z.string().max(50).optional(),
    incluir_auxiliares: z.boolean().default(true),
    auxiliares: z
      .array(
        z.object({
          tipo: z.enum(['rodillo', 'brocha', 'bandeja', 'cinta', 'plastico', 'lija', 'masilla']),
          cantidad: z.number().int().min(0).max(1000).optional(),
          producto_id: z.number().int().positive().optional(),
        }),
      )
      .max(20)
      .optional(),
  })
  .refine((v) => v.incluir_paredes || v.incluir_techo, { message: 'Incluya paredes, techo o ambos', path: ['incluir_paredes'] });

export const SaveQuotationSchema = z.object({
  cliente_id: z.number().int().positive().nullish(),
  descripcion_proyecto: z.string().trim().max(500).nullish(),
  tipo: z.enum(['general', 'pintura']).default('general'),
  origen: z.enum(['manual', 'asistente']).default('manual'),
  parametros: PaintParamsSchema.innerType().partial().passthrough().optional(),
  area_m2: z.number().min(0).max(1_000_000).nullish(),
  manos: z.number().int().min(1).max(5).nullish(),
  supuestos: z.array(z.string().max(300)).max(40).default([]),
  advertencias: z.array(z.string().max(300)).max(40).default([]),
  observaciones: z.string().trim().max(1000).nullish(),
  lineas: z.array(QuoteItemSchema).min(1).max(100),
  aceptar_cambios_precio: z.boolean().default(false),
});

export const PatchQuotationSchema = z
  .object({
    estado: z.enum(['aceptada', 'anulada']).optional(),
    motivo_estado: z.string().trim().max(200).optional(),
    observaciones: z.string().trim().max(1000).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Indique al menos un campo' })
  .refine((v) => v.estado !== 'anulada' || !!v.motivo_estado, { message: 'Indique el motivo de la anulación', path: ['motivo_estado'] });

export type QuoteItem = z.infer<typeof QuoteItemSchema>;
export type PaintParams = z.infer<typeof PaintParamsSchema>;
export type SaveQuotation = z.infer<typeof SaveQuotationSchema>;
