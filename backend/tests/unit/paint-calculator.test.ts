import { describe, expect, it } from 'vitest';
import { calcularAreas, cubrirConPresentaciones, litrosNecesarios, unidadesPorArea } from '../../src/modules/quotations/paint-calculator.js';

describe('Cotizador de pintura — cálculos deterministas', () => {
  it('calcula el área de paredes de una habitación de 4 × 3 m con altura 2,5 m', () => {
    const a = calcularAreas({ espacios: [{ largo: 4, ancho: 3, alto: 2.5 }], incluir_paredes: true, incluir_techo: false });
    expect(a.area_paredes_bruta).toBe('35.00'); // 2 × (4 + 3) × 2,5
    expect(a.area_neta_total).toBe('35.00');
    expect(a.area_techo).toBe('0.00');
  });

  it('descuenta puertas y ventanas solo de las paredes', () => {
    const a = calcularAreas({
      espacios: [{ largo: 4, ancho: 3, alto: 2.5 }],
      incluir_paredes: true,
      incluir_techo: true,
      aberturas: [
        { tipo: 'puerta', ancho: 0.9, alto: 2, cantidad: 1 },
        { tipo: 'ventana', ancho: 1.2, alto: 1, cantidad: 2 },
      ],
    });
    expect(a.area_aberturas).toBe('4.20');
    expect(a.area_paredes_neta).toBe('30.80');
    expect(a.area_techo).toBe('12.00');
    expect(a.area_neta_total).toBe('42.80');
  });

  it('multiplica espacios repetidos (tres habitaciones iguales)', () => {
    const a = calcularAreas({ espacios: [{ largo: 3, ancho: 3, alto: 2.4, cantidad: 3 }], incluir_paredes: true, incluir_techo: false });
    expect(a.area_neta_total).toBe('86.40');
  });

  it('rechaza aberturas mayores que las paredes', () => {
    expect(() =>
      calcularAreas({ area_paredes_m2: 2, incluir_paredes: true, incluir_techo: false, aberturas: [{ ancho: 2, alto: 2 }] }),
    ).toThrow(/supera/);
  });

  it('aplica manos y desperdicio: 35 m² × 2 manos × 1,10 ÷ 10 m²/L = 7,7 L', () => {
    expect(litrosNecesarios(35, 2, 10, 10).toString()).toBe('7.7');
    expect(litrosNecesarios(35, 1, 0, 10).toString()).toBe('3.5');
  });

  it('redondea a presentaciones comerciales completas con la combinación de menor costo', () => {
    // galón 3,785 L a 83.700 y cuñete 18,927 L a 364.000
    const pres = [
      { producto_id: 9, litros: 3.785, precio: 83700 },
      { producto_id: 10, litros: 18.927, precio: 364000 },
    ];
    const pocos = cubrirConPresentaciones(7.7, pres);
    expect(pocos.items).toEqual([{ producto_id: 9, unidades: 3, litros: '11.355' }]);
    expect(pocos.costo).toBe('251100.00');

    // 22 L: 6 galones = 502.200; 1 cuñete + 1 galón = 447.700 → gana la combinación
    const muchos = cubrirConPresentaciones(22, pres);
    expect(muchos.costo).toBe('447700.00');
    expect(muchos.items).toEqual(
      expect.arrayContaining([
        { producto_id: 10, unidades: 1, litros: '18.927' },
        { producto_id: 9, unidades: 1, litros: '3.785' },
      ]),
    );
  });

  it('calcula unidades auxiliares por rendimiento y siempre hacia arriba', () => {
    expect(unidadesPorArea(42.8, 25)).toBe(2);
    expect(unidadesPorArea(50, 25)).toBe(2);
    expect(unidadesPorArea(0, 25)).toBe(0);
  });
});
