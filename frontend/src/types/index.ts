export interface User {
  id: number;
  nombre: string;
  correo: string;
  roles: string[];
  permisos: string[];
}

export interface Product {
  id: number;
  codigo_barras: string;
  nombre: string;
  descripcion: string | null;
  marca_id: number;
  marca: string;
  categoria_id: number | null;
  categoria: string | null;
  presentacion: string;
  unidad_base_id: number;
  unidad_codigo: string;
  unidad_nombre: string;
  decimales_permitidos: number;
  controla_vencimiento: boolean;
  controla_garantia: boolean;
  porcentaje_incremento: string;
  stock_minimo: string;
  activo: boolean;
  disponible: string;
  reservada: string;
  danada: string;
  precio_vigente: string | null;
  costo_promedio?: string | null;
  tiene_precio_manual: boolean;
  estado_stock: 'normal' | 'bajo_minimo' | 'agotado' | 'inactivo';
}

export interface ProductDetail extends Product {
  conversiones: { id: number; unidad_id: number; unidad_codigo: string; unidad_nombre: string; tipo: string; factor_a_base: string }[];
  ficha_tecnica: Record<string, unknown> | null;
  lotes: { id: number; cantidad_recibida: string; cantidad_disponible: string; fecha_vencimiento: string | null; referencia_garantia: string | null; fecha_ingreso: string; costo_unitario?: string }[];
}

export interface QuoteLine {
  producto_id: number;
  codigo_barras: string;
  nombre: string;
  marca: string;
  presentacion: string;
  unidad_id: number;
  unidad_codigo: string;
  rol: 'pintura' | 'auxiliar' | 'manual';
  cantidad_necesaria: string | null;
  unidad_necesaria: string | null;
  cantidad: string;
  cantidad_base: string;
  precio_unitario: string;
  subtotal: string;
  disponible: string;
  reservada: string;
  danada: string;
  disponibilidad: 'disponible' | 'insuficiente' | 'agotado';
  cantidad_disponible_inmediata: string;
  subtotal_disponible: string;
}

export interface PricedQuote {
  lineas: QuoteLine[];
  total: string;
  total_disponible: string;
  total_faltante: string;
}

export interface PaintResult extends PricedQuote {
  estado: 'calculado' | 'faltan_datos';
  faltantes?: string[];
  descripcion_proyecto?: string | null;
  parametros: Record<string, unknown>;
  areas?: { area_paredes_bruta: string; area_aberturas: string; area_paredes_neta: string; area_techo: string; area_neta_total: string };
  manos?: number | null;
  desperdicio_pct?: number;
  pintura?: { superficie: string; area_neta_m2: string; manos: number; rendimiento_m2_por_litro: string; fuente_rendimiento: string | null; linea: string; litros_necesarios: string }[];
  pendientes?: { tipo: string; motivo: string; producto_id?: number }[];
  alternativas?: { para: string; opciones: Record<string, unknown>[] }[];
  supuestos?: string[];
  advertencias?: string[];
  calculado_en?: string;
  vigencia_dias?: number;
}

export interface ChatArtifact {
  tipo: 'productos' | 'existencias' | 'alertas' | 'precio' | 'detalle' | 'pintura' | 'cotizacion' | 'borrador_cotizacion' | 'estado_cotizacion';
  datos: any; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export interface ChatResponse {
  conversacion_id: string;
  respuesta: string;
  artefactos: ChatArtifact[];
  herramientas: { nombre: string; ok: boolean; ms: number; error?: string }[];
  verificacion: { estado: 'verificada' | 'sin_herramientas' | 'con_advertencias' | 'fallo_herramienta'; cifras_sin_respaldo: string[] };
  limite_alcanzado: boolean;
  modelo: string;
}
