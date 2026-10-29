import { Decimal, dec, type Num } from '../../lib/money.js';

// Cálculos deterministas y puros del cotizador. La IA nunca hace estas cuentas.

export interface Espacio {
  nombre?: string;
  largo: number;
  ancho: number;
  alto: number;
  cantidad?: number;
}

export interface Abertura {
  tipo?: 'puerta' | 'ventana' | 'otro';
  ancho: number;
  alto: number;
  cantidad?: number;
}

export interface AreaInput {
  espacios?: Espacio[];
  area_paredes_m2?: number;
  area_techo_m2?: number;
  incluir_paredes: boolean;
  incluir_techo: boolean;
  aberturas?: Abertura[];
}

export interface AreaResult {
  area_paredes_bruta: string;
  area_aberturas: string;
  area_paredes_neta: string;
  area_techo: string;
  area_neta_total: string;
}

const r2 = (v: Decimal) => v.toDecimalPlaces(2).toFixed(2);

/**
 * Área neta = paredes y techos incluidos − puertas y ventanas que no se pintan.
 * Las aberturas solo se descuentan de las paredes. Paredes de un espacio: 2 × (largo + ancho) × alto.
 */
export function calcularAreas(input: AreaInput): AreaResult {
  let paredes = dec(0);
  let techo = dec(0);
  for (const e of input.espacios ?? []) {
    const n = dec(e.cantidad ?? 1);
    paredes = paredes.add(dec(e.largo).add(e.ancho).mul(2).mul(e.alto).mul(n));
    techo = techo.add(dec(e.largo).mul(e.ancho).mul(n));
  }
  if (input.area_paredes_m2 != null) paredes = paredes.add(input.area_paredes_m2);
  if (input.area_techo_m2 != null) techo = techo.add(input.area_techo_m2);

  const aberturas = (input.aberturas ?? []).reduce(
    (acc, a) => acc.add(dec(a.ancho).mul(a.alto).mul(a.cantidad ?? 1)),
    dec(0),
  );
  const paredesIncluidas = input.incluir_paredes ? paredes : dec(0);
  const aberturasDescontadas = input.incluir_paredes ? aberturas : dec(0);
  if (aberturasDescontadas.gt(paredesIncluidas)) {
    throw new RangeError('El área de puertas y ventanas supera el área de las paredes');
  }
  const paredesNeta = paredesIncluidas.sub(aberturasDescontadas);
  const techoIncluido = input.incluir_techo ? techo : dec(0);
  return {
    area_paredes_bruta: r2(paredesIncluidas),
    area_aberturas: r2(aberturasDescontadas),
    area_paredes_neta: r2(paredesNeta),
    area_techo: r2(techoIncluido),
    area_neta_total: r2(paredesNeta.add(techoIncluido)),
  };
}

/** Litros = área neta × manos × (1 + desperdicio / 100) ÷ rendimiento por litro. */
export function litrosNecesarios(area: Num, manos: number, desperdicioPct: Num, rendimientoM2PorLitro: Num): Decimal {
  const rend = dec(rendimientoM2PorLitro);
  if (rend.lte(0)) throw new RangeError('El rendimiento debe ser mayor que cero');
  return dec(area).mul(manos).mul(dec(1).add(dec(desperdicioPct).div(100))).div(rend).toDecimalPlaces(4, Decimal.ROUND_UP);
}

/** Unidades de un material auxiliar cuyo rendimiento está en m² por unidad (siempre hacia arriba). */
export function unidadesPorArea(area: Num, rendimientoM2PorUnidad: Num): number {
  const a = dec(area);
  if (a.lte(0)) return 0;
  return a.div(rendimientoM2PorUnidad).ceil().toNumber();
}

export interface Presentacion {
  producto_id: number;
  litros: Num; // contenido de una unidad comercial
  precio: Num; // precio vigente de una unidad comercial
}

export interface Cobertura {
  items: { producto_id: number; unidades: number; litros: string }[];
  litros_cubiertos: string;
  costo: string;
}

/**
 * Combinación de presentaciones comerciales de menor costo que cubre al menos `litros`.
 * Desempate: menos litros sobrantes y luego menos unidades. Búsqueda exhaustiva acotada
 * (las líneas de pintura tienen pocas presentaciones).
 */
export function cubrirConPresentaciones(litros: Num, presentaciones: Presentacion[]): Cobertura {
  const need = dec(litros);
  const pres = [...presentaciones].filter((p) => dec(p.litros).gt(0)).sort((a, b) => dec(b.litros).cmp(a.litros));
  if (pres.length === 0) throw new RangeError('No hay presentaciones con contenido en litros');
  if (need.lte(0)) return { items: [], litros_cubiertos: '0', costo: '0.00' };

  let best: { counts: number[]; costo: Decimal; litros: Decimal; unidades: number } | null = null;
  const counts = new Array(pres.length).fill(0);

  const better = (costo: Decimal, cubiertos: Decimal, unidades: number) =>
    !best ||
    costo.lt(best.costo) ||
    (costo.eq(best.costo) && (cubiertos.lt(best.litros) || (cubiertos.eq(best.litros) && unidades < best.unidades)));

  const visit = (i: number, restante: Decimal, costo: Decimal, cubiertos: Decimal, unidades: number) => {
    if (best && costo.gt(best.costo)) return;
    const p = pres[i];
    const max = restante.lte(0) ? 0 : restante.div(p.litros).ceil().toNumber();
    if (i === pres.length - 1) {
      const c = costo.add(dec(p.precio).mul(max));
      const l = cubiertos.add(dec(p.litros).mul(max));
      if (better(c, l, unidades + max)) {
        counts[i] = max;
        best = { counts: [...counts], costo: c, litros: l, unidades: unidades + max };
      }
      return;
    }
    for (let k = max; k >= 0; k--) {
      counts[i] = k;
      visit(i + 1, restante.sub(dec(p.litros).mul(k)), costo.add(dec(p.precio).mul(k)), cubiertos.add(dec(p.litros).mul(k)), unidades + k);
    }
    counts[i] = 0;
  };
  visit(0, need, dec(0), dec(0), 0);

  const b = best!;
  return {
    items: pres
      .map((p, i) => ({ producto_id: p.producto_id, unidades: b.counts[i], litros: dec(p.litros).mul(b.counts[i]).toString() }))
      .filter((x) => x.unidades > 0),
    litros_cubiertos: b.litros.toString(),
    costo: b.costo.toDecimalPlaces(2).toFixed(2),
  };
}
