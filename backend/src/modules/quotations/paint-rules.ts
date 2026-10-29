// Reglas documentadas del cotizador de pintura (DP-23, docs/cotizaciones.md).
// Son configuración explícita: cambiarlas aquí cambia el cálculo y queda registrado en los supuestos.

export type EstadoSuperficie = 'nueva' | 'buena' | 'regular' | 'deteriorada';
export type TipoAuxiliar = 'rodillo' | 'brocha' | 'bandeja' | 'cinta' | 'plastico' | 'lija' | 'masilla';

/** Desperdicio por defecto cuando el usuario no indica uno. */
export const DESPERDICIO_POR_DEFECTO = 10;

/** Manos por defecto si ni el usuario ni la ficha técnica las indican. */
export const MANOS_POR_DEFECTO = 2;

/**
 * Factor orientativo para estimar la superficie de muros a partir del área construida.
 * Solo se usa si el usuario autoriza explícitamente la estimación (`permitir_estimacion`).
 */
export const FACTOR_MUROS_POR_AREA_CONSTRUIDA = 2.5;

/** Materiales auxiliares que aplican según el estado de la superficie. */
export const AUXILIARES_POR_ESTADO: Record<EstadoSuperficie, TipoAuxiliar[]> = {
  nueva: ['rodillo', 'brocha', 'bandeja', 'cinta', 'plastico'],
  buena: ['rodillo', 'brocha', 'bandeja', 'cinta', 'plastico'],
  regular: ['rodillo', 'brocha', 'bandeja', 'cinta', 'plastico', 'lija'],
  deteriorada: ['rodillo', 'brocha', 'bandeja', 'cinta', 'plastico', 'lija', 'masilla'],
};

/** Superficies nuevas o porosas requieren sellador/imprimante antes de pintar. */
export const REQUIERE_SELLADOR: Record<EstadoSuperficie, boolean> = {
  nueva: true,
  buena: false,
  regular: false,
  deteriorada: true,
};
