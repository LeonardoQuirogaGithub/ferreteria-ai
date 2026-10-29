// Normalización de términos de búsqueda en español para el catálogo.

const STOPWORDS = new Set(
  (
    'de del la las el los un una unos unas y o u a al para por con sin en que cual cuales cuanto cuanta cuantos ' +
    'cuantas hay tenemos tiene queda quedan disponible disponibles producto productos me mi lo es son quiero ' +
    'necesito busco buscar dime muestrame mostrar precio precios cuesta valor existencia existencias stock inventario ' +
    'unidades unidad metros cantidad'
  ).split(' '),
);

export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

/** Convierte una frase libre en términos útiles: sin tildes, sin palabras vacías y en singular simple. */
export function searchTokens(text: string): string[] {
  const tokens = normalize(text)
    .split(/[^a-z0-9ñ]+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t))
    .filter((t) => /^[0-9]+$/.test(t) || t.length >= 3)
    .map((t) => (t.length > 4 && t.endsWith('s') && !/^[0-9]+$/.test(t) ? t.slice(0, -1) : t));
  return [...new Set(tokens)].slice(0, 8);
}
