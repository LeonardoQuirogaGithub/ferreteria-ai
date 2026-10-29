import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';
import { apiFetch, type Paginated } from '@/lib/api';
import { money, qty } from '@/lib/format';
import type { Product } from '@/types';
import { StockBadge } from './common';
import { Input } from './ui';

/** Búsqueda de productos por texto o lector de código de barras (el lector escribe y envía Enter). */
export function ProductPicker({ onPick, placeholder = 'Buscar producto o escanear código…', autoFocus }: {
  onPick: (p: Product) => void; placeholder?: string; autoFocus?: boolean;
}) {
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const listId = useId();
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 250);
    return () => clearTimeout(t);
  }, [text]);
  const { data, isFetching } = useQuery({
    queryKey: ['product-picker', debounced],
    queryFn: ({ signal }) => apiFetch<Paginated<Product>>('/products', { query: { q: debounced, pageSize: 8 }, signal }),
    enabled: debounced.length >= 2,
  });

  const pick = (p: Product) => {
    onPick(p);
    setText('');
    setDebounced('');
  };

  const onKeyDown = async (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    const code = text.trim();
    if (/^[0-9A-Za-z-]{6,}$/.test(code)) {
      try {
        pick(await apiFetch<Product>(`/products/barcode/${encodeURIComponent(code)}`));
        return;
      } catch {
        /* no es un código exacto: se usa la primera coincidencia */
      }
    }
    if (data?.data[0]) pick(data.data[0]);
  };

  const results = debounced.length >= 2 ? data?.data ?? [] : [];
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-slate-400" aria-hidden />
      <Input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        className="pl-9"
        autoFocus={autoFocus}
        role="combobox"
        aria-expanded={results.length > 0}
        aria-controls={listId}
        aria-label="Buscar producto"
      />
      {results.length > 0 && (
        <ul id={listId} role="listbox" className="absolute z-20 mt-1 max-h-72 w-full overflow-y-auto rounded-md border bg-white shadow-lg">
          {results.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button type="button" onClick={() => pick(p)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-slate-50">
                <span>
                  <span className="font-medium">{p.nombre}</span>{' '}
                  <span className="text-slate-500">· {p.marca} · {p.presentacion}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  {qty(p.disponible)} {p.unidad_codigo} · {money(p.precio_vigente)} <StockBadge estado={p.estado_stock} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {isFetching && <span className="sr-only">Buscando…</span>}
    </div>
  );
}
