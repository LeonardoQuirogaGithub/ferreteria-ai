import { describe, expect, it } from 'vitest';
import { evidenceNumbers, numericValues, ungroundedNumbers } from '../../src/modules/ai/grounding.js';

describe('Verificación de cifras del asistente', () => {
  it('interpreta formatos colombianos y anglosajones', () => {
    expect(numericValues('33.750')).toContain(33750);
    expect(numericValues('33,750.50')).toContain(33750.5);
    expect(numericValues('12,5')).toContain(12.5);
  });

  it('acepta cifras presentes en los datos de las herramientas', () => {
    const ev = evidenceNumbers([{ disponible: '92.0000', precio_vigente: '2520.00', productos: [1, 2, 3] }]);
    expect(ungroundedNumbers('Quedan 92 metros a $2.520 por metro. Hay 3 coincidencias.', ev)).toEqual([]);
  });

  it('detecta cantidades inventadas', () => {
    const ev = evidenceNumbers([{ disponible: '92.0000' }]);
    expect(ungroundedNumbers('Quedan 150 metros.', ev)).toEqual(['150']);
  });
});
