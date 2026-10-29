import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Printer } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AvailabilityBadge, DataState, PageHeader, Pagination } from '@/components/common';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Input, Table, Td, Th } from '@/components/ui';
import { apiFetch, errorMessage, type Paginated } from '@/lib/api';
import { dateTime, money, qty } from '@/lib/format';

interface QuotationRow {
  id: number; numero: string; creada_en: string; vence_en: string; estado_efectivo: string; tipo: string; origen: string;
  descripcion_proyecto: string | null; total: string; total_disponible: string; usuario: string; cliente: string | null;
}

const ESTADO_TONE: Record<string, 'info' | 'success' | 'danger' | 'neutral'> = { emitida: 'info', aceptada: 'success', anulada: 'danger', vencida: 'neutral' };
export const EstadoCotizacion = ({ estado }: { estado: string }) => <Badge tone={ESTADO_TONE[estado] ?? 'neutral'}>{estado}</Badge>;

export function QuotationsPage() {
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['quotations', q, page],
    queryFn: () => apiFetch<Paginated<QuotationRow>>('/quotations', { query: { q, page } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Cotizaciones" description="Historial de cotizaciones. Estados: emitida, aceptada, anulada; «vencida» se calcula por la fecha de vigencia." actions={<Link to="/cotizador"><Button>Nueva cotización</Button></Link>} />
      <Card>
        <div className="border-b p-3"><Input aria-label="Buscar cotización" placeholder="Número o descripción…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} className="max-w-sm" /></div>
        <DataState loading={list.isLoading} error={list.error} empty={list.data?.data.length === 0} emptyText="Todavía no hay cotizaciones">
          <Table>
            <thead><tr><Th>Número</Th><Th>Fecha</Th><Th>Proyecto</Th><Th>Cliente</Th><Th>Estado</Th><Th className="text-right">Total</Th><Th>Vence</Th><Th>Usuario</Th></tr></thead>
            <tbody>
              {list.data?.data.map((c) => (
                <tr key={c.id}>
                  <Td><Link className="font-medium text-brand-700 hover:underline" to={`/cotizaciones/${c.id}`}>{c.numero}</Link>{c.origen === 'asistente' && <Badge className="ml-1">IA</Badge>}</Td>
                  <Td>{dateTime(c.creada_en)}</Td><Td>{c.descripcion_proyecto ?? '—'}</Td><Td>{c.cliente ?? '—'}</Td>
                  <Td><EstadoCotizacion estado={c.estado_efectivo} /></Td><Td className="text-right">{money(c.total)}</Td><Td>{dateTime(c.vence_en)}</Td><Td>{c.usuario}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
        </DataState>
      </Card>
    </>
  );
}

interface QuotationDetail extends QuotationRow {
  estado: string; area_m2: string | null; manos: number | null; supuestos: string[]; advertencias: string[]; observaciones: string | null; motivo_estado: string | null;
  lineas: { linea: number; producto_id: number; rol: string; codigo_barras: string; nombre: string; marca: string; presentacion: string; unidad_codigo: string; cantidad_necesaria: string | null; unidad_necesaria: string | null; cantidad: string; precio_unitario: string; subtotal: string; disponible_al_cotizar: string; disponibilidad: string }[];
}

export function QuotationDetailPage() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [motivo, setMotivo] = useState('');
  const q = useQuery({ queryKey: ['quotation', id], queryFn: () => apiFetch<QuotationDetail>(`/quotations/${id}`) });
  const patch = useMutation({
    mutationFn: (body: Record<string, string>) => apiFetch(`/quotations/${id}`, { method: 'PATCH', body }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['quotation', id] }),
  });
  const c = q.data;
  return (
    <DataState loading={q.isLoading} error={q.error}>
      {c && (
        <>
          <PageHeader
            title={`Cotización ${c.numero}`}
            description={`${c.descripcion_proyecto ?? 'Sin descripción'} · creada ${dateTime(c.creada_en)} por ${c.usuario} · vence ${dateTime(c.vence_en)}`}
            actions={<Button variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" aria-hidden /> Imprimir</Button>}
          />
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <EstadoCotizacion estado={c.estado_efectivo} />
              <span>Cliente: {c.cliente ?? 'sin identificar'}</span>
              {c.area_m2 && <span>Área: {c.area_m2} m²</span>}
              {c.manos && <span>Manos: {c.manos}</span>}
              {c.motivo_estado && <span>Motivo: {c.motivo_estado}</span>}
            </div>
            <Card>
              <CardHeader><CardTitle>Detalle (instantánea al momento de cotizar)</CardTitle></CardHeader>
              <Table>
                <thead><tr><Th>#</Th><Th>Producto</Th><Th>Necesario</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Precio unitario</Th><Th className="text-right">Subtotal</Th><Th>Disponibilidad al cotizar</Th></tr></thead>
                <tbody>
                  {c.lineas.map((l) => (
                    <tr key={l.linea}>
                      <Td>{l.linea}</Td>
                      <Td>{l.nombre}<p className="text-xs text-slate-500">{l.marca} · {l.presentacion} · {l.codigo_barras}</p></Td>
                      <Td>{l.cantidad_necesaria ? `${qty(l.cantidad_necesaria)} ${l.unidad_necesaria ?? ''}` : '—'}</Td>
                      <Td className="text-right">{qty(l.cantidad)} {l.unidad_codigo}</Td>
                      <Td className="text-right">{money(l.precio_unitario)}</Td>
                      <Td className="text-right">{money(l.subtotal)}</Td>
                      <Td><AvailabilityBadge estado={l.disponibilidad} /> <span className="text-xs text-slate-500">({qty(l.disponible_al_cotizar)})</span></Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <CardContent className="text-right text-sm">
                <p>Total: <strong className="text-lg">{money(c.total)}</strong></p>
                <p className="text-emerald-700">Disponible para compra inmediata: {money(c.total_disponible)}</p>
                <p className="text-xs text-slate-500">No incluye impuestos, descuentos ni transporte.</p>
              </CardContent>
            </Card>
            {c.advertencias.length > 0 && <Alert tone="warning" title="Advertencias"><ul className="list-disc pl-4">{c.advertencias.map((a) => <li key={a}>{a}</li>)}</ul></Alert>}
            {c.supuestos.length > 0 && <Card><CardHeader><CardTitle>Supuestos</CardTitle></CardHeader><CardContent><ul className="list-disc pl-5 text-sm">{c.supuestos.map((s) => <li key={s}>{s}</li>)}</ul></CardContent></Card>}
            {c.estado_efectivo === 'emitida' && (
              <Card className="print:hidden">
                <CardContent className="flex flex-wrap items-end gap-2">
                  <Button onClick={() => patch.mutate({ estado: 'aceptada' })} loading={patch.isPending}>Marcar como aceptada</Button>
                  <div className="flex items-end gap-2">
                    <Input aria-label="Motivo de anulación" placeholder="Motivo de anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="w-64" />
                    <Button variant="destructive" disabled={motivo.trim().length < 3} onClick={() => patch.mutate({ estado: 'anulada', motivo_estado: motivo })}>Anular</Button>
                  </div>
                  {patch.error && <Alert tone="danger">{errorMessage(patch.error)}</Alert>}
                </CardContent>
              </Card>
            )}
          </div>
        </>
      )}
    </DataState>
  );
}
