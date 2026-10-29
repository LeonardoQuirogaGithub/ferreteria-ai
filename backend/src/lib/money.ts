import { Decimal } from 'decimal.js';

// Aritmética decimal para precios, subtotales y cantidades (RNF-ADE-001). Nunca se usa float.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Num = Decimal.Value;

export const dec = (v: Num | null | undefined) => new Decimal(v ?? 0);

/** Redondeo monetario a 2 decimales, devuelto como string para JSON. */
export const money = (v: Num) => new Decimal(v).toDecimalPlaces(2).toFixed(2);

/** Cantidad con hasta 4 decimales (precisión de las columnas NUMERIC(14,4)). */
export const qty = (v: Num) => new Decimal(v).toDecimalPlaces(4).toString();
