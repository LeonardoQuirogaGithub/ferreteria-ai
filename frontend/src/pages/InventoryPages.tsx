import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { DataState, PageHeader, Pagination, StockBadge } from '@/components/common';
import { ProductPicker } from '@/components/ProductPicker';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { apiFetch, errorMessage, type Paginated } from '@/lib/api';
import { date, dateTime, money, qty } from '@/lib/format';
import type { Product } from '@/types';
import { useCatalogs } from './ProductsPage';

// ---------------------------------------------------------------------------
// Marcas, categorías y unidades (RF-CAT-001)
// ---------------------------------------------------------------------------
export function CatalogsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { brands, categories, units } = useCatalogs();
  const [marca, setMarca] = useState('');
  const [cat, setCat] = useState({ nombre: '', padre: '' });
  const [unit, setUnit] = useState({ codigo: '', nombre: '', permite_decimal: false });
  const create = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) => apiFetch(path, { body }),
    onSuccess: (_d, v) => qc.invalidateQueries({ queryKey: [v.path.slice(1)] }),
  });
  const editable = can('producto.gestionar');
  return (
    <>
      <PageHeader title="Marcas, categorías y unidades" />
      {create.error && <Alert tone="danger" className="mb-4">{errorMessage(create.error)}</Alert>}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Marcas</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {editable && (
              <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ path: '/brands', body: { nombre: marca } }); setMarca(''); }}>
                <Input aria-label="Nueva marca" placeholder="Nueva marca" value={marca} onChange={(e) => setMarca(e.target.value)} required />
                <Button type="submit">Agregar</Button>
              </form>
            )}
            <ul className="divide-y text-sm">{brands.map((b) => <li key={b.id} className="py-1.5">{b.nombre}</li>)}</ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Categorías</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {editable && (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ path: '/categories', body: { nombre: cat.nombre, categoria_padre_id: cat.padre ? Number(cat.padre) : null } }); setCat({ nombre: '', padre: '' }); }}>
                <Input aria-label="Nueva categoría" placeholder="Nueva categoría" value={cat.nombre} onChange={(e) => setCat({ ...cat, nombre: e.target.value })} required />
                <div className="flex gap-2">
                  <Select aria-label="Categoría padre" value={cat.padre} onChange={(e) => setCat({ ...cat, padre: e.target.value })}>
                    <option value="">Sin categoría padre</option>
                    {categories.filter((c) => !c.categoria_padre).map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                  </Select>
                  <Button type="submit">Agregar</Button>
                </div>
              </form>
            )}
            <ul className="divide-y text-sm">{categories.map((c) => <li key={c.id} className="py-1.5">{c.categoria_padre ? <span className="text-slate-400">{c.categoria_padre} › </span> : null}{c.nombre}</li>)}</ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Unidades de medida</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {editable && (
              <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); create.mutate({ path: '/units', body: unit }); setUnit({ codigo: '', nombre: '', permite_decimal: false }); }}>
                <div className="flex gap-2">
                  <Input aria-label="Código" placeholder="Código (UND)" value={unit.codigo} onChange={(e) => setUnit({ ...unit, codigo: e.target.value })} required className="w-28" />
                  <Input aria-label="Nombre" placeholder="Nombre" value={unit.nombre} onChange={(e) => setUnit({ ...unit, nombre: e.target.value })} required />
                </div>
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={unit.permite_decimal} onChange={(e) => setUnit({ ...unit, permite_decimal: e.target.checked })} /> Permite decimales</label>
                  <Button type="submit">Agregar</Button>
                </div>
              </form>
            )}
            <ul className="divide-y text-sm">{units.map((u) => <li key={u.id} className="flex justify-between py-1.5"><span><strong>{u.codigo}</strong> · {u.nombre}</span>{u.permite_decimal && <Badge>decimales</Badge>}</li>)}</ul>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Existencias, lotes y cambio de estado (RF-PRO-003, RF-EST-001, RF-LOT-001)
// ---------------------------------------------------------------------------
const VISTAS = { todos: 'Todos', agotados: 'Agotados', minimo: 'Bajo mínimo', vencimientos: 'Por vencer', garantias: 'Con garantía' } as const;

export function InventoryPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const vista = (params.get('vista') as keyof typeof VISTAS) ?? 'todos';
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [transfer, setTransfer] = useState<{ producto?: Product; origen: string; destino: string; cantidad: string; motivo: string }>({ origen: 'disponible', destino: 'reservada', cantidad: '', motivo: '' });

  const productos = useQuery({
    queryKey: ['inventory', vista, q, page],
    queryFn: () => {
      const path = vista === 'agotados' ? '/inventory/out-of-stock' : vista === 'minimo' ? '/inventory/low-stock' : '/inventory';
      return apiFetch<Paginated<Product>>(path, { query: { q, page } });
    },
    enabled: ['todos', 'agotados', 'minimo'].includes(vista),
    placeholderData: keepPreviousData,
  });
  const lotes = useQuery({
    queryKey: ['lots', vista],
    queryFn: () => apiFetch<{ data: { lote_id: number; producto: string; marca: string; presentacion: string; cantidad_disponible: string; fecha_vencimiento: string | null; referencia_garantia: string | null; dias_para_vencer: number | null; fecha_ingreso: string }[] }>('/inventory/lots', { query: { tipo: vista === 'garantias' ? 'garantia' : 'vencimiento', dias: 90 } }),
    enabled: vista === 'vencimientos' || vista === 'garantias',
  });
  const move = useMutation({
    mutationFn: () => apiFetch('/inventory/state-transfers', { body: { producto_id: transfer.producto!.id, estado_origen: transfer.origen, estado_destino: transfer.destino, cantidad: Number(transfer.cantidad), motivo: transfer.motivo } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['inventory'] }); setTransfer({ origen: 'disponible', destino: 'reservada', cantidad: '', motivo: '' }); },
  });

  return (
    <>
      <PageHeader title="Existencias y lotes" description="Una sola bodega. Solo la existencia disponible se vende; reservada y dañada se muestran aparte." />
      <div role="tablist" aria-label="Vistas de inventario" className="mb-4 flex flex-wrap gap-2">
        {Object.entries(VISTAS).map(([k, label]) => (
          <Button key={k} role="tab" aria-selected={vista === k} variant={vista === k ? 'default' : 'outline'} size="sm" onClick={() => { setParams({ vista: k }); setPage(1); }}>{label}</Button>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          {vista === 'todos' && <div className="border-b p-3"><Input aria-label="Buscar" placeholder="Buscar…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-sm" /></div>}
          {['todos', 'agotados', 'minimo'].includes(vista) ? (
            <DataState loading={productos.isLoading} error={productos.error} empty={productos.data?.data.length === 0}>
              <Table>
                <thead><tr><Th>Producto</Th><Th className="text-right">Disponible</Th><Th className="text-right">Reservada</Th><Th className="text-right">Dañada</Th><Th className="text-right">Mínimo</Th><Th>Estado</Th></tr></thead>
                <tbody>
                  {productos.data?.data.map((p) => (
                    <tr key={p.id}>
                      <Td><Link to={`/productos/${p.id}`} className="font-medium text-brand-700 hover:underline">{p.nombre}</Link><p className="text-xs text-slate-500">{p.marca} · {p.presentacion}</p></Td>
                      <Td className="text-right font-medium">{qty(p.disponible)} {p.unidad_codigo}</Td><Td className="text-right">{qty(p.reservada)}</Td><Td className="text-right">{qty(p.danada)}</Td><Td className="text-right">{qty(p.stock_minimo)}</Td>
                      <Td><StockBadge estado={p.estado_stock} /></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              {productos.data && <Pagination page={page} totalPages={productos.data.meta.totalPages} onChange={setPage} />}
            </DataState>
          ) : (
            <DataState loading={lotes.isLoading} error={lotes.error} empty={lotes.data?.data.length === 0}>
              <Table>
                <thead><tr><Th>Lote</Th><Th>Producto</Th><Th className="text-right">Saldo</Th><Th>{vista === 'garantias' ? 'Garantía' : 'Vencimiento'}</Th><Th>Ingreso</Th></tr></thead>
                <tbody>
                  {lotes.data?.data.map((l) => (
                    <tr key={l.lote_id}><Td>#{l.lote_id}</Td><Td>{l.producto}<p className="text-xs text-slate-500">{l.marca} · {l.presentacion}</p></Td><Td className="text-right">{qty(l.cantidad_disponible)}</Td>
                      <Td>{vista === 'garantias' ? l.referencia_garantia : <>{date(l.fecha_vencimiento)} {l.dias_para_vencer != null && <Badge tone={l.dias_para_vencer < 30 ? 'danger' : 'warning'}>{l.dias_para_vencer} días</Badge>}</>}</Td><Td>{date(l.fecha_ingreso)}</Td></tr>
                  ))}
                </tbody>
              </Table>
            </DataState>
          )}
        </Card>
        {can('inventario.cambiar_estado') && (
          <Card>
            <CardHeader><CardTitle>Cambiar estado de existencia</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
                {transfer.producto ? (
                  <div className="rounded-md bg-slate-50 p-2 text-sm">
                    <p className="font-medium">{transfer.producto.nombre}</p>
                    <p className="text-xs">Disp. {qty(transfer.producto.disponible)} · Res. {qty(transfer.producto.reservada)} · Dañ. {qty(transfer.producto.danada)}</p>
                    <button type="button" className="text-xs text-brand-700 underline" onClick={() => setTransfer({ ...transfer, producto: undefined })}>Cambiar producto</button>
                  </div>
                ) : <ProductPicker onPick={(p) => setTransfer({ ...transfer, producto: p })} />}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Origen">{(i) => <Select id={i} value={transfer.origen} onChange={(e) => setTransfer({ ...transfer, origen: e.target.value })}><option value="disponible">Disponible</option><option value="reservada">Reservada</option><option value="danada">Dañada</option></Select>}</Field>
                  <Field label="Destino">{(i) => <Select id={i} value={transfer.destino} onChange={(e) => setTransfer({ ...transfer, destino: e.target.value })}><option value="disponible">Disponible</option><option value="reservada">Reservada</option><option value="danada">Dañada</option></Select>}</Field>
                </div>
                <Field label="Cantidad">{(i) => <Input id={i} type="number" step="any" min="0" required value={transfer.cantidad} onChange={(e) => setTransfer({ ...transfer, cantidad: e.target.value })} />}</Field>
                <Field label="Motivo">{(i) => <Input id={i} required minLength={3} value={transfer.motivo} onChange={(e) => setTransfer({ ...transfer, motivo: e.target.value })} />}</Field>
                {transfer.origen === transfer.destino && <p role="alert" className="text-xs text-red-600">Origen y destino deben ser distintos.</p>}
                {move.error && <Alert tone="danger">{errorMessage(move.error)}</Alert>}
                {move.isSuccess && <Alert tone="success">Cambio registrado en el kardex. El total del producto no cambió.</Alert>}
                <Button type="submit" className="w-full" disabled={!transfer.producto || transfer.origen === transfer.destino} loading={move.isPending}>Registrar cambio</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Kardex (RF-MOV-001)
// ---------------------------------------------------------------------------
const TIPOS: Record<string, string> = { entrada_compra: 'Entrada por compra', salida_venta: 'Salida por venta', cambio_estado: 'Cambio de estado' };

export function KardexPage() {
  const [producto, setProducto] = useState<Product>();
  const [f, setF] = useState({ tipo: '', desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const q = useQuery({
    queryKey: ['movements', producto?.id, f, page],
    queryFn: () => apiFetch<Paginated<{ id: number; fecha_hora: string; tipo: string; cantidad: string; estado_origen: string | null; estado_destino: string | null; documento_tipo: string | null; documento_numero: string | null; producto: string; unidad_codigo: string; usuario: string; canal: string; motivo: string | null }>>('/inventory/movements', { query: { productoId: producto?.id, ...f, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Movimientos y kardex" description="Entradas por compra, salidas por venta y cambios de estado en orden cronológico." />
      <Card>
        <div className="grid gap-2 border-b p-3 md:grid-cols-4">
          <div className="md:col-span-2">
            {producto ? (
              <div className="flex items-center gap-2 text-sm"><Badge tone="info">{producto.nombre} · {producto.marca}</Badge><button className="text-xs underline" onClick={() => setProducto(undefined)}>Quitar filtro</button></div>
            ) : <ProductPicker placeholder="Filtrar por producto…" onPick={(p) => { setProducto(p); setPage(1); }} />}
          </div>
          <Select aria-label="Tipo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })}><option value="">Todos los tipos</option>{Object.entries(TIPOS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select>
          <div className="flex gap-2">
            <Input aria-label="Desde" type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} />
            <Input aria-label="Hasta" type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} />
          </div>
        </div>
        <DataState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <Table>
            <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Producto</Th><Th className="text-right">Cantidad</Th><Th>Estados</Th><Th>Documento</Th><Th>Usuario</Th><Th>Canal</Th><Th>Motivo</Th></tr></thead>
            <tbody>
              {q.data?.data.map((m) => (
                <tr key={m.id}>
                  <Td className="whitespace-nowrap">{dateTime(m.fecha_hora)}</Td><Td>{TIPOS[m.tipo]}</Td><Td>{m.producto}</Td>
                  <Td className={`text-right ${m.tipo === 'salida_venta' ? 'text-red-700' : m.tipo === 'entrada_compra' ? 'text-emerald-700' : ''}`}>{m.tipo === 'salida_venta' ? '−' : m.tipo === 'entrada_compra' ? '+' : ''}{qty(m.cantidad)} {m.unidad_codigo}</Td>
                  <Td className="text-xs">{m.estado_origen ?? '—'} → {m.estado_destino ?? '—'}</Td>
                  <Td>{m.documento_numero ?? m.documento_tipo ?? '—'}</Td><Td>{m.usuario}</Td><Td>{m.canal}</Td><Td className="text-xs">{m.motivo ?? ''}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />}
        </DataState>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Precios e historial (RF-PRE-001, RF-PRE-002)
// ---------------------------------------------------------------------------
export function PricesPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [params] = useSearchParams();
  const [productoId, setProductoId] = useState<number | undefined>(params.get('producto') ? Number(params.get('producto')) : undefined);
  const [manual, setManual] = useState({ precio: '', motivo: '' });
  const [pct, setPct] = useState('');
  const producto = useQuery({ queryKey: ['product', String(productoId)], queryFn: () => apiFetch<Product>(`/products/${productoId}`), enabled: !!productoId });
  const hist = useQuery({
    queryKey: ['prices', productoId],
    queryFn: () => apiFetch<{ data: { id: number; costo_promedio?: string; porcentaje_incremento: string; precio_calculado: string; precio_manual: string | null; precio_aplicado: string; motivo: string | null; vigente_desde: string; vigente_hasta: string | null; vigente: boolean; usuario: string | null }[] }>(`/prices/${productoId}/history`),
    enabled: !!productoId,
  });
  const done = () => { qc.invalidateQueries({ queryKey: ['prices', productoId] }); qc.invalidateQueries({ queryKey: ['product', String(productoId)] }); };
  const setManualM = useMutation({ mutationFn: () => apiFetch(`/prices/${productoId}/manual`, { body: { precio_manual: Number(manual.precio), motivo: manual.motivo || null } }), onSuccess: () => { done(); setManual({ precio: '', motivo: '' }); } });
  const setPctM = useMutation({ mutationFn: () => apiFetch(`/prices/${productoId}/percentage`, { body: { porcentaje: Number(pct) } }), onSuccess: () => { done(); setPct(''); } });
  const verCosto = hist.data?.data[0]?.costo_promedio !== undefined;

  return (
    <>
      <PageHeader title="Precios e historial" description="Precio sugerido = costo × (1 + porcentaje / 100). Si hay precio manual, prevalece en las ventas." />
      <div className="mb-4 max-w-xl"><ProductPicker onPick={(p) => setProductoId(p.id)} /></div>
      {!productoId && <Alert tone="info">Seleccione un producto para ver su historial de costos y precios.</Alert>}
      {productoId && (
        <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
          <Card>
            <CardHeader><CardTitle>{producto.data ? `${producto.data.nombre} · ${producto.data.marca} · ${producto.data.presentacion}` : 'Historial'}</CardTitle></CardHeader>
            <DataState loading={hist.isLoading} error={hist.error} empty={hist.data?.data.length === 0} emptyText="Sin precios: se calcularán con la primera compra">
              <Table>
                <thead><tr><Th>Vigencia</Th>{verCosto && <Th className="text-right">Costo</Th>}<Th className="text-right">%</Th><Th className="text-right">Calculado</Th><Th className="text-right">Manual</Th><Th className="text-right">Aplicado</Th><Th>Usuario</Th></tr></thead>
                <tbody>
                  {hist.data?.data.map((h) => (
                    <tr key={h.id} className={h.vigente ? 'bg-emerald-50' : ''}>
                      <Td className="text-xs">{dateTime(h.vigente_desde)} → {h.vigente ? <Badge tone="success">vigente</Badge> : dateTime(h.vigente_hasta)}</Td>
                      {verCosto && <Td className="text-right">{money(h.costo_promedio)}</Td>}
                      <Td className="text-right">{qty(h.porcentaje_incremento)}</Td><Td className="text-right">{money(h.precio_calculado)}</Td>
                      <Td className="text-right">{h.precio_manual ? money(h.precio_manual) : '—'}{h.motivo && <p className="text-xs text-slate-500">{h.motivo}</p>}</Td>
                      <Td className="text-right font-medium">{money(h.precio_aplicado)}</Td><Td>{h.usuario ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </DataState>
          </Card>
          {can('precio.gestionar') && (
            <div className="space-y-4">
              <Card>
                <CardHeader><CardTitle>Precio manual</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); setManualM.mutate(); }}>
                    <Field label="Precio por unidad base">{(i) => <Input id={i} type="number" step="any" min="0" required value={manual.precio} onChange={(e) => setManual({ ...manual, precio: e.target.value })} />}</Field>
                    <Field label="Motivo (opcional)">{(i) => <Input id={i} value={manual.motivo} onChange={(e) => setManual({ ...manual, motivo: e.target.value })} />}</Field>
                    {setManualM.error && <Alert tone="danger">{errorMessage(setManualM.error)}</Alert>}
                    <Button type="submit" className="w-full" loading={setManualM.isPending}>Fijar precio manual</Button>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader><CardTitle>Porcentaje de incremento</CardTitle></CardHeader>
                <CardContent>
                  <form className="space-y-2" onSubmit={(e) => { e.preventDefault(); setPctM.mutate(); }}>
                    <Field label="Nuevo porcentaje (%)" hint="Recalcula el precio sugerido y quita el precio manual">{(i, d) => <Input id={i} aria-describedby={d} type="number" step="any" min="0" required value={pct} onChange={(e) => setPct(e.target.value)} />}</Field>
                    {setPctM.error && <Alert tone="danger">{errorMessage(setPctM.error)}</Alert>}
                    <Button type="submit" className="w-full" loading={setPctM.isPending}>Actualizar porcentaje</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          )}
        </div>
      )}
    </>
  );
}
