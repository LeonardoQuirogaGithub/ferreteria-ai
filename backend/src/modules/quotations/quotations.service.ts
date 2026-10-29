import { env } from '../../config/env.js';
import { queryOne, withTransaction, type Db } from '../../db/pool.js';
import { businessRule, conflict, mapDatabaseError, notFound } from '../../lib/errors.js';
import { offset, paginated, type Pagination } from '../../lib/http.js';
import { Decimal, dec, money, qty } from '../../lib/money.js';
import { can, type AuthUser } from '../../middlewares/auth.js';
import { calcularAreas, cubrirConPresentaciones, litrosNecesarios, unidadesPorArea, type AreaResult } from './paint-calculator.js';
import * as rules from './paint-rules.js';
import * as repo from './quotations.repository.js';
import type { PaintParams, QuoteItem, SaveQuotation } from './quotations.schemas.js';

export interface PricedLine {
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
  lineas: PricedLine[];
  total: string;
  total_disponible: string;
  total_faltante: string;
}

/**
 * Valora líneas con el precio vigente y la existencia disponible del servidor.
 * Nunca usa importes enviados por el cliente o por el modelo. Rechaza productos inexistentes,
 * inactivos o sin precio vigente, y cantidades que violen los decimales permitidos.
 */
export async function priceLines(items: QuoteItem[], db?: Db): Promise<PricedQuote> {
  const catalog = new Map((await repo.itemsByIds([...new Set(items.map((i) => i.producto_id))], db)).map((p) => [p.id, p]));
  const errores: string[] = [];
  const usado = new Map<number, Decimal>();
  const lineas: PricedLine[] = [];

  for (const item of items) {
    const p = catalog.get(item.producto_id);
    if (!p) { errores.push(`El producto ${item.producto_id} no existe en el catálogo`); continue; }
    if (!p.activo) { errores.push(`${p.nombre} (${p.presentacion}) está inactivo`); continue; }
    if (p.precio_vigente == null) { errores.push(`${p.nombre} (${p.presentacion}) no tiene precio vigente`); continue; }
    const unidadId = item.unidad_id ?? p.unidad_base_id;
    let factor = '1';
    let cantidadBase: string;
    let unidadCodigo = p.unidad_codigo;
    try {
      if (unidadId !== p.unidad_base_id) {
        factor = await repo.conversionFactor(p.id, unidadId, db);
        unidadCodigo = (await repo.unitCode(unidadId, db)) ?? '?';
      }
      cantidadBase = await repo.toBase(p.id, unidadId, item.cantidad, db);
    } catch (error) {
      const mapped = mapDatabaseError(error);
      if (!mapped) throw error;
      errores.push(`${p.nombre}: ${mapped.message}`);
      continue;
    }
    const precioUnitario = money(dec(p.precio_vigente).mul(factor));
    const subtotal = money(dec(precioUnitario).mul(item.cantidad));
    // La existencia ya asignada a líneas anteriores del mismo producto no se cuenta dos veces.
    const libre = Decimal.max(dec(p.disponible).sub(usado.get(p.id) ?? 0), 0);
    usado.set(p.id, (usado.get(p.id) ?? dec(0)).add(cantidadBase));
    const inmediataBase = Decimal.min(libre, cantidadBase);
    const inmediata = inmediataBase.div(factor).toDecimalPlaces(p.decimales_permitidos, Decimal.ROUND_DOWN);
    const disponibilidad = libre.gte(cantidadBase) ? 'disponible' : libre.lte(0) ? 'agotado' : 'insuficiente';
    lineas.push({
      producto_id: p.id,
      codigo_barras: p.codigo_barras,
      nombre: p.nombre,
      marca: p.marca,
      presentacion: p.presentacion,
      unidad_id: unidadId,
      unidad_codigo: unidadCodigo,
      rol: item.rol ?? 'manual',
      cantidad_necesaria: item.cantidad_necesaria != null ? qty(item.cantidad_necesaria) : null,
      unidad_necesaria: item.unidad_necesaria ?? null,
      cantidad: qty(item.cantidad),
      cantidad_base: cantidadBase,
      precio_unitario: precioUnitario,
      subtotal,
      disponible: p.disponible,
      reservada: p.reservada,
      danada: p.danada,
      disponibilidad,
      cantidad_disponible_inmediata: inmediata.toString(),
      subtotal_disponible: money(inmediata.mul(precioUnitario)),
    });
  }
  if (errores.length) throw businessRule('No es posible cotizar algunos productos', { errores });

  const total = lineas.reduce((a, l) => a.add(l.subtotal), dec(0));
  const totalDisp = lineas.reduce((a, l) => a.add(l.subtotal_disponible), dec(0));
  return { lineas, total: money(total), total_disponible: money(totalDisp), total_faltante: money(total.sub(totalDisp)) };
}

// ---------------------------------------------------------------------------
// Cotizador de pintura
// ---------------------------------------------------------------------------

interface LineaPintura {
  clave: string;
  linea: string;
  productos: repo.CatalogItem[];
  rendimiento: Decimal;
  fuente: string | null;
  manos: number;
}

function agruparLineas(pool: repo.CatalogItem[], rendimientoUsuario: number | undefined, manosUsuario: number | undefined) {
  const map = new Map<string, repo.CatalogItem[]>();
  for (const p of pool) {
    const k = p.linea ?? `producto-${p.id}`;
    map.set(k, [...(map.get(k) ?? []), p]);
  }
  const lineas: LineaPintura[] = [];
  const descartadas: string[] = [];
  for (const [clave, productos] of map) {
    const usables = productos.filter(
      (p) => p.precio_vigente != null && p.contenido_litros != null && (rendimientoUsuario != null || (p.unidad_rendimiento === 'm2_por_litro' && p.rendimiento != null)),
    );
    if (usables.length === 0) {
      descartadas.push(`${productos[0].nombre}: sin precio vigente o sin ficha técnica de rendimiento por litro`);
      continue;
    }
    // Si las presentaciones declaran rendimientos distintos se usa el menor (estimación conservadora).
    const rendimiento = rendimientoUsuario != null ? dec(rendimientoUsuario) : Decimal.min(...usables.map((p) => dec(p.rendimiento!)));
    lineas.push({
      clave,
      linea: usables[0].linea ?? `${usables[0].nombre} ${usables[0].marca}`,
      productos: usables,
      rendimiento,
      fuente: rendimientoUsuario != null ? 'Indicado por el usuario' : usables[0].fuente,
      manos: manosUsuario ?? usables[0].manos_recomendadas ?? rules.MANOS_POR_DEFECTO,
    });
  }
  return { lineas, descartadas };
}

function evaluarLinea(l: LineaPintura, area: string, desperdicio: number) {
  const litros = litrosNecesarios(area, l.manos, desperdicio, l.rendimiento);
  const cobertura = cubrirConPresentaciones(
    litros,
    l.productos.map((p) => ({ producto_id: p.id, litros: p.contenido_litros!, precio: p.precio_vigente! })),
  );
  const disponible = cobertura.items.every((i) => dec(l.productos.find((p) => p.id === i.producto_id)!.disponible).gte(i.unidades));
  return { litros, cobertura, disponible };
}

/** Elige la línea: la indicada por el usuario o, si no, la más económica con existencia suficiente. */
function elegirLinea(lineas: LineaPintura[], area: string, desperdicio: number, productoId?: number) {
  const evaluadas = lineas.map((l) => ({ l, ...evaluarLinea(l, area, desperdicio) }));
  const ordenadas = [...evaluadas].sort(
    (a, b) => Number(b.disponible) - Number(a.disponible) || dec(a.cobertura.costo).cmp(b.cobertura.costo),
  );
  const elegida = productoId != null ? evaluadas.find((e) => e.l.productos.some((p) => p.id === productoId)) : ordenadas[0];
  return { elegida, alternativas: ordenadas.filter((e) => e !== elegida) };
}

const resumenAlternativa = (e: ReturnType<typeof evaluarLinea> & { l: LineaPintura }) => ({
  linea: e.l.linea,
  productos: e.l.productos.map((p) => ({ producto_id: p.id, nombre: p.nombre, marca: p.marca, presentacion: p.presentacion, disponible: p.disponible })),
  litros_necesarios: e.litros.toString(),
  costo_estimado: e.cobertura.costo,
  existencia_suficiente: e.disponible,
});

export async function calculatePaint(params: PaintParams) {
  const supuestos: string[] = [];
  const advertencias: string[] = [];
  const pendientes: { tipo: string; motivo: string; producto_id?: number }[] = [];
  const alternativas: unknown[] = [];

  // 1. Superficie a pintar (no confundir área construida con área de muros).
  const tieneMedidas = (params.espacios?.length ?? 0) > 0 || params.area_paredes_m2 != null || params.area_techo_m2 != null;
  let areaPared = params.area_paredes_m2;
  let areaTecho = params.area_techo_m2;
  if (!tieneMedidas) {
    if (params.area_construccion_m2 != null && params.permitir_estimacion) {
      areaPared = params.area_construccion_m2 * rules.FACTOR_MUROS_POR_AREA_CONSTRUIDA;
      supuestos.push(
        `ESTIMACIÓN: superficie de muros ≈ ${rules.FACTOR_MUROS_POR_AREA_CONSTRUIDA} × área construida (${params.area_construccion_m2} m²) = ${areaPared} m². Valor orientativo; confirme con medidas reales.`,
      );
      if (params.incluir_techo) {
        areaTecho = params.area_construccion_m2;
        supuestos.push(`ESTIMACIÓN: área de techos ≈ área construida (${params.area_construccion_m2} m²).`);
      }
    } else {
      const faltantes = [
        'Dimensiones de cada espacio a pintar (largo, ancho y alto de las paredes) o el área total de muros en m².',
        '¿Se pintan paredes, techos o ambos?',
        'Número y medidas de puertas y ventanas que no se pintarán.',
        'Número de manos y estado de la superficie (nueva, buena, regular o deteriorada).',
      ];
      if (params.area_construccion_m2 != null) {
        faltantes.unshift(
          `El área construida (${params.area_construccion_m2} m²) no equivale a la superficie de paredes a pintar. Indique las medidas o autorice una estimación con supuestos explícitos.`,
        );
      }
      return { estado: 'faltan_datos' as const, tipo: 'pintura' as const, faltantes, parametros: params };
    }
  }

  let areas: AreaResult;
  try {
    areas = calcularAreas({
      espacios: params.espacios,
      area_paredes_m2: areaPared,
      area_techo_m2: areaTecho,
      incluir_paredes: params.incluir_paredes,
      incluir_techo: params.incluir_techo,
      aberturas: params.aberturas,
    });
  } catch (error) {
    throw businessRule((error as Error).message);
  }
  if (dec(areas.area_neta_total).lte(0)) {
    return {
      estado: 'faltan_datos' as const,
      tipo: 'pintura' as const,
      faltantes: ['El área neta a pintar es cero: revise si incluyó paredes o techo y sus medidas.'],
      parametros: params,
    };
  }
  if (params.incluir_techo && dec(areas.area_techo).eq(0)) {
    advertencias.push('Se pidió pintar techo, pero no hay medidas de techo (indique espacios con largo y ancho o el área de techo).');
  }
  if ((params.aberturas?.length ?? 0) > 0) supuestos.push(`Se descontaron ${areas.area_aberturas} m² de puertas y ventanas del área de paredes.`);
  else if (params.incluir_paredes) supuestos.push('No se descontaron puertas ni ventanas (no se indicaron).');

  const desperdicio = params.desperdicio_pct ?? rules.DESPERDICIO_POR_DEFECTO;
  supuestos.push(
    params.desperdicio_pct != null ? `Desperdicio indicado: ${desperdicio} %.` : `Desperdicio por defecto: ${desperdicio} % (configurable).`,
  );

  // 2. Pintura por superficie.
  const catalogo = await repo.itemsByType(['pintura', 'sellador', ...new Set(Object.values(rules.AUXILIARES_POR_ESTADO).flat())]);
  const pinturas = catalogo.filter((p) => p.tipo_producto === 'pintura');
  const grupos = [
    { superficie: 'pared', etiqueta: 'paredes', area: areas.area_paredes_neta, productoId: params.producto_pintura_id },
    { superficie: 'techo', etiqueta: 'techos', area: areas.area_techo, productoId: params.producto_pintura_techo_id ?? params.producto_pintura_id },
  ].filter((g) => dec(g.area).gt(0));

  const litrosPorLinea = new Map<string, { linea: LineaPintura; litros: Decimal }>();
  const detallePintura: Record<string, unknown>[] = [];
  let manosPrincipales: number | null = null;

  for (const g of grupos) {
    let pool = pinturas.filter((p) => (p.superficies ?? []).includes(g.superficie));
    if (params.acabado) {
      const conAcabado = pool.filter((p) => p.acabado?.toLowerCase() === params.acabado!.toLowerCase());
      if (conAcabado.length) pool = conAcabado;
      else advertencias.push(`No hay pintura para ${g.etiqueta} con acabado "${params.acabado}"; se consideraron otros acabados.`);
    }
    if (g.productoId != null && !pool.some((p) => p.id === g.productoId)) {
      const elegido = (await repo.itemsByIds([g.productoId]))[0];
      if (!elegido || !elegido.activo) throw businessRule(`El producto ${g.productoId} no existe o está inactivo`);
      if (elegido.tipo_producto !== 'pintura') {
        advertencias.push(`${elegido.nombre} no tiene ficha técnica de pintura compatible con ${g.etiqueta}; se usa solo si indica el rendimiento.`);
      }
      pool = [...pool, elegido];
    }
    const { lineas, descartadas } = agruparLineas(pool, params.rendimiento_m2_por_litro, params.manos);
    descartadas.forEach((d) => advertencias.push(`Pintura no considerada: ${d}.`));
    if (lineas.length === 0) {
      pendientes.push({
        tipo: 'pintura',
        motivo: `No hay pintura para ${g.etiqueta} con ficha técnica (rendimiento por litro y contenido) y precio vigente. Indique el rendimiento o elija otro producto.`,
      });
      continue;
    }
    const { elegida, alternativas: otras } = elegirLinea(lineas, g.area, desperdicio, g.productoId);
    if (!elegida) {
      pendientes.push({ tipo: 'pintura', motivo: `El producto elegido para ${g.etiqueta} no se puede cotizar (sin precio, contenido o rendimiento).` });
      continue;
    }
    manosPrincipales ??= elegida.l.manos;
    const acumulado = litrosPorLinea.get(elegida.l.clave);
    litrosPorLinea.set(elegida.l.clave, { linea: elegida.l, litros: (acumulado?.litros ?? dec(0)).add(elegida.litros) });
    detallePintura.push({
      superficie: g.etiqueta,
      area_neta_m2: g.area,
      manos: elegida.l.manos,
      rendimiento_m2_por_litro: elegida.l.rendimiento.toString(),
      fuente_rendimiento: elegida.l.fuente,
      linea: elegida.l.linea,
      litros_necesarios: elegida.litros.toString(),
    });
    supuestos.push(
      `Pintura ${g.etiqueta}: ${g.area} m² × ${elegida.l.manos} manos × (1 + ${desperdicio}/100) ÷ ${elegida.l.rendimiento} m²/L = ${elegida.litros.toDecimalPlaces(2)} L (${elegida.l.linea}).`,
    );
    if (params.manos == null) supuestos.push(`Manos para ${g.etiqueta}: ${elegida.l.manos} (recomendación de la ficha técnica o valor por defecto).`);
    if (otras.length) alternativas.push({ para: `pintura de ${g.etiqueta}`, opciones: otras.map(resumenAlternativa) });
  }

  const items: QuoteItem[] = [];
  for (const { linea, litros } of litrosPorLinea.values()) {
    const cobertura = cubrirConPresentaciones(
      litros,
      linea.productos.map((p) => ({ producto_id: p.id, litros: p.contenido_litros!, precio: p.precio_vigente! })),
    );
    cobertura.items.forEach((c, i) =>
      items.push({ producto_id: c.producto_id, cantidad: c.unidades, rol: 'pintura', cantidad_necesaria: i === 0 ? litros.toNumber() : null, unidad_necesaria: 'L' }),
    );
    supuestos.push(`${linea.linea}: se necesitan ${litros.toDecimalPlaces(2)} L; las presentaciones elegidas suman ${dec(cobertura.litros_cubiertos).toDecimalPlaces(2)} L (combinación de menor costo).`);
  }

  // 3. Sellador / imprimante.
  const requiereSellador = params.requiere_sellador ?? rules.REQUIERE_SELLADOR[params.estado_superficie];
  if (requiereSellador) {
    const superficies = grupos.map((g) => g.superficie);
    const pool = catalogo.filter((p) => p.tipo_producto === 'sellador' && (p.superficies ?? []).some((s) => superficies.includes(s)));
    const { lineas } = agruparLineas(pool, undefined, undefined);
    if (lineas.length === 0) {
      pendientes.push({ tipo: 'sellador', motivo: 'La superficie requiere sellador, pero no hay uno con ficha técnica y precio vigente.' });
    } else {
      const { elegida, alternativas: otras } = elegirLinea(lineas, areas.area_neta_total, desperdicio);
      elegida!.cobertura.items.forEach((c, i) =>
        items.push({ producto_id: c.producto_id, cantidad: c.unidades, rol: 'auxiliar', cantidad_necesaria: i === 0 ? elegida!.litros.toNumber() : null, unidad_necesaria: 'L' }),
      );
      supuestos.push(
        `Sellador: ${areas.area_neta_total} m² × ${elegida!.l.manos} mano(s) ÷ ${elegida!.l.rendimiento} m²/L = ${elegida!.litros.toDecimalPlaces(2)} L (superficie ${params.estado_superficie}).`,
      );
      if (otras.length) alternativas.push({ para: 'sellador', opciones: otras.map(resumenAlternativa) });
    }
  }

  // 4. Materiales auxiliares según reglas documentadas.
  if (params.incluir_auxiliares) {
    const overrides = new Map((params.auxiliares ?? []).map((a) => [a.tipo, a]));
    const tipos = [...new Set([...rules.AUXILIARES_POR_ESTADO[params.estado_superficie], ...overrides.keys()])];
    const superficies = grupos.map((g) => g.superficie);
    for (const tipo of tipos) {
      const o = overrides.get(tipo);
      if (o?.cantidad === 0) { supuestos.push(`${tipo}: excluido por el usuario.`); continue; }
      let cands = o?.producto_id
        ? await repo.itemsByIds([o.producto_id])
        : catalogo.filter((p) => p.tipo_producto === tipo && ((p.superficies ?? []).length === 0 || (p.superficies ?? []).some((s) => superficies.includes(s))));
      cands = cands.filter((p) => p.activo && p.precio_vigente != null);
      if (cands.length === 0) { pendientes.push({ tipo, motivo: 'No hay un producto activo con precio vigente en el catálogo.' }); continue; }
      cands.sort((a, b) => Number(dec(b.disponible).gt(0)) - Number(dec(a.disponible).gt(0)) || dec(a.precio_vigente!).cmp(b.precio_vigente!));
      const elegido = cands[0];
      let cantidad = o?.cantidad;
      if (cantidad == null && elegido.unidad_rendimiento === 'm2_por_unidad' && elegido.rendimiento != null) {
        cantidad = unidadesPorArea(areas.area_neta_total, elegido.rendimiento);
        supuestos.push(`${tipo}: 1 unidad por cada ${dec(elegido.rendimiento)} m² según ficha técnica (${elegido.fuente ?? 'sin fuente'}) → ${cantidad}.`);
      } else if (cantidad != null) {
        supuestos.push(`${tipo}: ${cantidad} unidad(es) indicadas por el usuario.`);
      }
      if (cantidad == null) {
        pendientes.push({ tipo, producto_id: elegido.id, motivo: `${elegido.nombre} no tiene rendimiento registrado; indique la cantidad.` });
        continue;
      }
      items.push({ producto_id: elegido.id, cantidad, rol: 'auxiliar', cantidad_necesaria: Number(areas.area_neta_total), unidad_necesaria: 'm2' });
      if (cands.length > 1) {
        alternativas.push({
          para: tipo,
          opciones: cands.slice(1).map((p) => ({ producto_id: p.id, nombre: p.nombre, marca: p.marca, presentacion: p.presentacion, precio_vigente: p.precio_vigente, disponible: p.disponible })),
        });
      }
    }
  }

  // 5. Precios y disponibilidad reales.
  const priced = items.length ? await priceLines(items) : { lineas: [], total: '0.00', total_disponible: '0.00', total_faltante: '0.00' };
  for (const l of priced.lineas) {
    if (l.disponibilidad === 'agotado') advertencias.push(`${l.nombre} (${l.presentacion}) está agotado: disponible 0${dec(l.reservada).gt(0) ? `, reservada ${dec(l.reservada)}` : ''}${dec(l.danada).gt(0) ? `, dañada ${dec(l.danada)}` : ''}.`);
    if (l.disponibilidad === 'insuficiente') advertencias.push(`${l.nombre} (${l.presentacion}): se necesitan ${dec(l.cantidad)} y hay ${dec(l.disponible)} disponibles.`);
  }
  const fuentes = new Set(
    catalogo.filter((p) => priced.lineas.some((l) => l.producto_id === p.id) && p.fuente?.toLowerCase().includes('demostración')).map((p) => p.nombre),
  );
  if (fuentes.size) advertencias.push(`Rendimientos de demostración pendientes de validar con el fabricante: ${[...fuentes].join(', ')}.`);
  if (pendientes.length) advertencias.push('Hay materiales pendientes que no suman al total.');
  supuestos.push(`Precios vigentes del catálogo al ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`);
  supuestos.push('No incluye impuestos, descuentos ni transporte (reglas comerciales por definir, DP-09).');
  supuestos.push('Esto es una estimación de materiales; la cotización con precios se confirma al guardarla.');

  return {
    estado: 'calculado' as const,
    tipo: 'pintura' as const,
    descripcion_proyecto: params.descripcion_proyecto ?? null,
    parametros: params,
    areas,
    manos: params.manos ?? manosPrincipales,
    desperdicio_pct: desperdicio,
    pintura: detallePintura,
    ...priced,
    pendientes,
    alternativas,
    supuestos,
    advertencias,
    calculado_en: new Date().toISOString(),
    vigencia_dias: env.COTIZACION_VIGENCIA_DIAS,
  };
}

// ---------------------------------------------------------------------------
// Persistencia
// ---------------------------------------------------------------------------

const puedeVerTodas = (u: AuthUser) => can(u, 'reporte.consultar') || can(u, 'usuario.gestionar');

/** Guarda la cotización tras revalidar precios y existencias en la misma transacción. */
export async function save(input: SaveQuotation, user: AuthUser) {
  const id = await withTransaction({ usuarioId: user.id }, async (db) => {
    if (input.cliente_id) {
      const c = await queryOne('SELECT 1 FROM tercero WHERE id = $1 AND es_cliente AND activo', [input.cliente_id], db);
      if (!c) throw businessRule('El cliente no existe o no está registrado como cliente activo');
    }
    const priced = await priceLines(input.lineas, db);
    const cambios = input.lineas
      .map((l, i) => ({ l, p: priced.lineas[i] }))
      .filter(({ l, p }) => l.precio_unitario_esperado != null && !dec(l.precio_unitario_esperado).eq(p.precio_unitario))
      .map(({ l, p }) => ({ producto_id: p.producto_id, nombre: p.nombre, precio_esperado: money(l.precio_unitario_esperado!), precio_actual: p.precio_unitario }));
    if (cambios.length && !input.aceptar_cambios_precio) {
      throw conflict('Los precios cambiaron desde el cálculo; revise y confirme de nuevo', { cambios, recalculo: priced });
    }
    const advertencias = [...input.advertencias];
    for (const l of priced.lineas) {
      if (l.disponibilidad !== 'disponible') advertencias.push(`Al guardar: ${l.nombre} (${l.presentacion}) ${l.disponibilidad}.`);
    }
    const qid = await repo.insertQuotation(
      {
        cliente_id: input.cliente_id ?? null,
        usuario_id: user.id,
        tipo: input.tipo,
        origen: input.origen,
        descripcion: input.descripcion_proyecto ?? null,
        area_m2: input.area_m2 ?? null,
        manos: input.manos ?? null,
        parametros: input.parametros ?? {},
        supuestos: [...input.supuestos, 'Precios y existencias verificados por el servidor al guardar.'],
        advertencias: [...new Set(advertencias)].slice(0, 60),
        observaciones: input.observaciones ?? null,
        total: priced.total,
        total_disponible: priced.total_disponible,
      },
      db,
    );
    let n = 1;
    for (const l of priced.lineas) await repo.insertLine(qid, n++, l as unknown as Record<string, unknown>, db);
    return qid;
  });
  return detail(id, user);
}

export async function detail(ref: number | string, user: AuthUser) {
  const header = typeof ref === 'number' ? await repo.findHeader('id', ref) : await repo.findHeader('numero', ref.toUpperCase());
  // Una cotización ajena se informa como inexistente para no revelar datos de otros usuarios.
  if (!header || (header.usuario_id !== user.id && !puedeVerTodas(user))) throw notFound('La cotización no existe');
  return { ...header, lineas: await repo.lines(header.id) };
}

export async function list(p: Pagination & { q?: string }, user: AuthUser) {
  const rows = await repo.list({ usuarioId: puedeVerTodas(user) ? null : user.id, limit: p.pageSize, offset: offset(p), q: p.q });
  return paginated(rows.map(({ total_count: _t, ...r }) => r), Number(rows[0]?.total_count ?? 0), p);
}

export async function patch(id: number, data: { estado?: string; motivo_estado?: string; observaciones?: string }, user: AuthUser) {
  const actual = await detail(id, user);
  if (data.estado && actual.estado_efectivo === 'vencida' && data.estado === 'aceptada') {
    throw businessRule('La cotización está vencida; genere una nueva con precios actuales');
  }
  // El trigger fn_proteger_cotizacion impide cambiar una cotización ya aceptada o anulada.
  await withTransaction({ usuarioId: user.id }, (db) =>
    repo.updateState(id, data.estado ?? null, data.motivo_estado ?? null, data.observaciones ?? null, db),
  );
  return detail(id, user);
}
