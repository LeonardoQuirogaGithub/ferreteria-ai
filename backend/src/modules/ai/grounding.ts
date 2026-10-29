// Verificación determinista de la respuesta del modelo: cada cifra relevante debe aparecer en
// los datos devueltos por las herramientas o en el mensaje del usuario.

const NUMBER_RE = /\d[\d.,]*/g;

/** Interpretaciones posibles de un número escrito en formato colombiano o anglosajón. */
export function numericValues(token: string): number[] {
  const t = token.replace(/[.,]+$/, '');
  const values = new Set<number>();
  const push = (s: string) => {
    const n = Number(s);
    if (Number.isFinite(n)) values.add(n);
  };
  push(t.replace(/\./g, '').replace(',', '.')); // 33.750,50 → 33750.50
  push(t.replace(/,/g, '')); // 33,750.50 → 33750.50
  if (/^\d+[.,]\d+$/.test(t)) push(t.replace(',', '.')); // 12,5 o 12.5 → 12.5
  return [...values];
}

export function extractNumbers(text: string): { token: string; values: number[] }[] {
  return (text.match(NUMBER_RE) ?? []).map((token) => ({ token, values: numericValues(token) }));
}

function collectEvidence(value: unknown, out: Set<number>) {
  if (value == null) return;
  if (typeof value === 'number') out.add(value);
  else if (typeof value === 'string') extractNumbers(value).forEach((n) => n.values.forEach((v) => out.add(v)));
  else if (Array.isArray(value)) {
    out.add(value.length);
    value.forEach((v) => collectEvidence(v, out));
  } else if (typeof value === 'object') Object.values(value as Record<string, unknown>).forEach((v) => collectEvidence(v, out));
}

export function evidenceNumbers(sources: unknown[]): Set<number> {
  const out = new Set<number>();
  sources.forEach((s) => collectEvidence(s, out));
  return out;
}

/** Devuelve las cifras de la respuesta que no tienen respaldo en la evidencia. */
export function ungroundedNumbers(answer: string, evidence: Set<number>): string[] {
  const list = [...evidence];
  return extractNumbers(answer)
    .filter(({ values }) => !values.some((v) => list.some((e) => Math.abs(e - v) < 0.005)))
    .map(({ token }) => token.replace(/[.,]+$/, ''));
}
