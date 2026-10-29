import { useMutation, useQuery } from '@tanstack/react-query';
import { RefreshCw, Save, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AvailabilityBadge } from '@/components/common';
import { ProductPicker } from '@/components/ProductPicker';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, Td, Textarea, Th } from '@/components/ui';
import { apiFetch, ApiError, errorMessage, type Paginated } from '@/lib/api';
import { money, qty } from '@/lib/format';
import type { PricedQuote, QuoteLine } from '@/types';

export interface EditorItem {
  producto_id: number;
  cantidad: number;
  unidad_id?: number;
  rol: QuoteLine['rol'];
  cantidad_necesaria?: string | null;
  unidad_necesaria?: string | null;
}

const toItems = (lineas: QuoteLine[]): EditorItem[] =>
  lineas.map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad), unidad_id: l.unidad_id, rol: l.rol, cantidad_necesaria: l.cantidad_necesaria, unidad_necesaria: l.unidad_necesaria }));

/**
 * Editor de cotización: permite cambiar cantidades, quitar y agregar productos y recalcular.
 * Los importes SIEMPRE vienen del backend; al guardar el servidor vuelve a verificar precios y existencias.
 */
export function QuoteEditor({ initial, tipo, descripcion, parametros, supuestos = [], advertencias = [], area, manos }: {
  initial: PricedQuote;
  tipo: 'general' | 'pintura';
  descripcion?: string | null;
  parametros?: Record<string, unknown>;
  supuestos?: string[];
  advertencias?: string[];
  area?: string | null;
  manos?: number | null;
}) {
  const navigate = useNavigate();
  const [quote, setQuote] = useState<PricedQuote>(initial);
  const [items, setItems] = useState<EditorItem[]>(toItems(initial.lineas));
  const [dirty, setDirty] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [desc, setDesc] = useState(descripcion ?? '');
  const [clienteId, setClienteId] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [priceChanges, setPriceChanges] = useState<{ nombre: string; precio_esperado: string; precio_actual: string }[] | null>(null);

  useEffect(() => {
    setQuote(initial);
    setItems(toItems(initial.lineas));
    setDirty(false);
  }, [initial]);

  const clientes = useQuery({
    queryKey: ['clientes'],
    queryFn: () => apiFetch<Paginated<{ id: number; nombre_completo: string; numero_documento: string }>>('/third-parties', { query: { rol: 'cliente', pageSize: 200 } }),
    enabled: confirm,
  });

  const recalc = useMutation({
    mutationFn: (its: EditorItem[]) => apiFetch<PricedQuote>('/quotations/calculate', { body: { items: its } }),
    onSuccess: (q) => {
      setQuote(q);
      setDirty(false);
    },
  });

  const save = useMutation({
    mutationFn: (aceptar: boolean) =>
      apiFetch<{ id: number; numero: string }>('/quotations', {
        body: {
          tipo,
          origen: 'manual',
          descripcion_proyecto: desc || null,
          cliente_id: clienteId ? Number(clienteId) : null,
          parametros,
          area_m2: area ? Number(area) : null,
          manos: manos ?? null,
          supuestos,
          advertencias,
          observaciones: observaciones || null,
          aceptar_cambios_precio: aceptar,
          lineas: quote.lineas.map((l) => ({
            producto_id: l.producto_id, cantidad: Number(l.cantidad), unidad_id: l.unidad_id, rol: l.rol,
            cantidad_necesaria: l.cantidad_necesaria != null ? Number(l.cantidad_necesaria) : null, unidad_necesaria: l.unidad_necesaria,
            precio_unitario_esperado: Number(l.precio_unitario),
          })),
        },
      }),
    onSuccess: (q) => navigate(`/cotizaciones/${q.id}`),
    onError: (e) => {
      if (e instanceof ApiError && e.status === 409) {
        const d = e.body.details as { cambios: { nombre: string; precio_esperado: string; precio_actual: string }[]; recalculo: PricedQuote };
        setPriceChanges(d.cambios);
        setQuote(d.recalculo);
      }
    },
  });

  const update = (next: EditorItem[]) => {
    setItems(next);
    setDirty(true);
  };

  const hasLines = items.length > 0;
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>Materiales y precios</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={() => recalc.mutate(items)} loading={recalc.isPending} disabled={!hasLines}>
            <RefreshCw className="h-4 w-4" aria-hidden /> Recalcular
          </Button>
          <Button size="sm" onClick={() => setConfirm(true)} disabled={dirty || !hasLines || quote.lineas.length === 0}>
            <Save className="h-4 w-4" aria-hidden /> Guardar cotización
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {dirty && <Alert tone="warning">Hay cambios sin valorar. Pulse «Recalcular» para obtener precios y existencias del servidor.</Alert>}
        {recalc.error && <Alert tone="danger">{errorMessage(recalc.error)}</Alert>}
        <Table>
          <thead>
            <tr>
              <Th>Producto</Th><Th>Necesario</Th><Th>Cantidad comercial</Th><Th className="text-right">Precio unitario</Th>
              <Th className="text-right">Subtotal</Th><Th>Disponibilidad</Th><Th><span className="sr-only">Acciones</span></Th>
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              // Sin cambios pendientes las líneas valoradas siguen el mismo orden que los ítems.
              const l = dirty ? quote.lineas.find((x) => x.producto_id === it.producto_id) : quote.lineas[i];
              return (
                <tr key={`${it.producto_id}-${i}`}>
                  <Td>
                    <p className="font-medium">{l?.nombre ?? `Producto ${it.producto_id}`}</p>
                    <p className="text-xs text-slate-500">{l?.marca} · {l?.presentacion} {it.rol !== 'manual' && <Badge className="ml-1">{it.rol}</Badge>}</p>
                  </Td>
                  <Td className="text-xs text-slate-600">{it.cantidad_necesaria ? `${qty(it.cantidad_necesaria)} ${it.unidad_necesaria ?? ''}` : '—'}</Td>
                  <Td>
                    <label className="sr-only" htmlFor={`cant-${i}`}>Cantidad de {l?.nombre}</label>
                    <div className="flex items-center gap-1">
                      <Input id={`cant-${i}`} type="number" min={0} step="any" className="h-8 w-24" value={it.cantidad}
                        onChange={(e) => update(items.map((x, j) => (j === i ? { ...x, cantidad: Number(e.target.value) } : x)))} />
                      <span className="text-xs text-slate-500">{l?.unidad_codigo}</span>
                    </div>
                  </Td>
                  <Td className="text-right">{l ? money(l.precio_unitario) : '—'}</Td>
                  <Td className="text-right font-medium">{l && !dirty ? money(l.subtotal) : '—'}</Td>
                  <Td>
                    {l && <AvailabilityBadge estado={l.disponibilidad} />}
                    {l && l.disponibilidad !== 'disponible' && (
                      <p className="mt-1 text-xs text-slate-500">Disponible: {qty(l.disponible)}{Number(l.reservada) > 0 && ` · reservada ${qty(l.reservada)}`}{Number(l.danada) > 0 && ` · dañada ${qty(l.danada)}`}</p>
                    )}
                  </Td>
                  <Td>
                    <Button variant="ghost" size="icon" aria-label={`Quitar ${l?.nombre ?? 'producto'}`} onClick={() => update(items.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
        <div className="max-w-xl">
          <ProductPicker placeholder="Agregar o sustituir por otro producto del catálogo…" onPick={(p) => update([...items, { producto_id: p.id, cantidad: 1, rol: 'manual' }])} />
        </div>
        <dl className="ml-auto grid max-w-sm grid-cols-2 gap-x-6 gap-y-1 text-sm">
          <dt className="text-slate-600">Total cotizado</dt><dd className="text-right text-lg font-bold">{dirty ? '—' : money(quote.total)}</dd>
          <dt className="text-slate-600">Disponible para compra inmediata</dt><dd className="text-right font-medium text-emerald-700">{dirty ? '—' : money(quote.total_disponible)}</dd>
          <dt className="text-slate-600">Sin existencia suficiente</dt><dd className="text-right font-medium text-red-700">{dirty ? '—' : money(quote.total_faltante)}</dd>
        </dl>
        <p className="text-xs text-slate-500">Valores en pesos colombianos. No incluye impuestos, descuentos ni transporte (reglas comerciales por definir).</p>
      </CardContent>

      <Dialog open={confirm} onClose={() => { setConfirm(false); setPriceChanges(null); }} title="Confirmar y guardar cotización">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(priceChanges != null); }}>
          <p className="text-sm text-slate-600">El servidor verificará otra vez precios y existencias antes de guardar. La cotización no reserva ni descuenta inventario.</p>
          <Field label="Descripción del proyecto">{(id) => <Input id={id} value={desc} onChange={(e) => setDesc(e.target.value)} maxLength={500} />}</Field>
          <Field label="Cliente (opcional)">
            {(id) => (
              <Select id={id} value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
                <option value="">Sin cliente identificado</option>
                {clientes.data?.data.map((c) => <option key={c.id} value={c.id}>{c.nombre_completo} · {c.numero_documento}</option>)}
              </Select>
            )}
          </Field>
          <Field label="Observaciones">{(id) => <Textarea id={id} value={observaciones} onChange={(e) => setObservaciones(e.target.value)} maxLength={1000} />}</Field>
          {priceChanges && (
            <Alert tone="warning" title="Los precios cambiaron desde el cálculo">
              <ul className="list-disc pl-4">
                {priceChanges.map((c) => <li key={c.nombre}>{c.nombre}: {money(c.precio_esperado)} → {money(c.precio_actual)}</li>)}
              </ul>
              <p>La tabla ya muestra los precios actuales. Confirme para guardar con ellos.</p>
            </Alert>
          )}
          {save.error && !(save.error instanceof ApiError && save.error.status === 409) && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
          <p className="text-sm">Total a guardar: <strong>{money(quote.total)}</strong></p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirm(false)}>Cancelar</Button>
            <Button type="submit" loading={save.isPending}>{priceChanges ? 'Guardar con precios actuales' : 'Confirmar y guardar'}</Button>
          </div>
        </form>
      </Dialog>
    </Card>
  );
}
