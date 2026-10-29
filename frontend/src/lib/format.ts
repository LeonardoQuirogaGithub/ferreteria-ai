import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const cop = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 2, minimumFractionDigits: 0 });
const num = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 4 });

export const money = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : cop.format(Number(v)));
export const qty = (v: string | number | null | undefined) => (v == null || v === '' ? '—' : num.format(Number(v)));
// Una fecha sin hora (AAAA-MM-DD) se interpreta en hora local; new Date() la tomaría como UTC y mostraría el día anterior.
const parseDate = (v: string) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T00:00:00`) : new Date(v));
export const date = (v: string | null | undefined) => (v ? parseDate(v).toLocaleDateString('es-CO') : '—');
export const dateTime = (v: string | null | undefined) =>
  v ? new Date(v).toLocaleString('es-CO', { dateStyle: 'short', timeStyle: 'short' }) : '—';
