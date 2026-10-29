import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil } from 'lucide-react';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { DataState, PageHeader, StockBadge } from '@/components/common';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { apiFetch, errorMessage } from '@/lib/api';
import { date, money, qty } from '@/lib/format';
import type { ProductDetail } from '@/types';
import { useCatalogs } from './ProductsPage';

export function ProductDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const { units } = useCatalogs();
  const q = useQuery({ queryKey: ['product', id], queryFn: () => apiFetch<ProductDetail>(`/products/${id}`) });
  const [conv, setConv] = useState({ unidad_id: '', tipo: 'venta', factor_a_base: '' });
  const addConv = useMutation({
    mutationFn: () => apiFetch(`/products/${id}/conversions`, { body: { unidad_id: Number(conv.unidad_id), tipo: conv.tipo, factor_a_base: Number(conv.factor_a_base) } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['product', id] }); setConv({ unidad_id: '', tipo: 'venta', factor_a_base: '' }); },
  });
  const p = q.data;

  return (
    <DataState loading={q.isLoading} error={q.error}>
      {p && (
        <>
          <PageHeader
            title={p.nombre}
            description={`${p.marca} · ${p.presentacion} · código ${p.codigo_barras}`}
            actions={can('producto.gestionar') && <Link to={`/productos/${p.id}/editar`}><Button variant="outline"><Pencil className="h-4 w-4" aria-hidden /> Editar</Button></Link>}
          />
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Existencias</CardTitle></CardHeader>
              <CardContent className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[['Disponible', p.disponible], ['Reservada', p.reservada], ['Dañada', p.danada], ['Stock mínimo', p.stock_minimo]].map(([k, v]) => (
                  <div key={k}><p className="text-xs text-slate-500">{k}</p><p className="text-xl font-bold">{qty(v)} <span className="text-sm font-normal">{p.unidad_codigo}</span></p></div>
                ))}
                <div className="col-span-full flex items-center gap-2 text-sm"><StockBadge estado={p.estado_stock} /> Solo la existencia disponible se puede vender.</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Precio</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p className="text-2xl font-bold">{money(p.precio_vigente)} <span className="text-sm font-normal">/ {p.unidad_codigo}</span></p>
                {p.tiene_precio_manual && <Badge tone="info">Precio manual</Badge>}
                <p>Incremento: {qty(p.porcentaje_incremento)} %</p>
                {p.costo_promedio !== undefined && <p>Costo promedio: {money(p.costo_promedio)}</p>}
                <Link className="text-brand-700 hover:underline" to={`/precios?producto=${p.id}`}>Ver historial de precios</Link>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Lotes con saldo</CardTitle></CardHeader>
              <DataState loading={false} error={null} empty={p.lotes.length === 0} emptyText="Sin lotes con saldo">
                <Table>
                  <thead><tr><Th>Lote</Th><Th>Ingreso</Th><Th className="text-right">Recibido</Th><Th className="text-right">Saldo</Th><Th>Vencimiento</Th><Th>Garantía</Th>{p.costo_promedio !== undefined && <Th className="text-right">Costo</Th>}</tr></thead>
                  <tbody>
                    {p.lotes.map((l) => (
                      <tr key={l.id}><Td>#{l.id}</Td><Td>{date(l.fecha_ingreso)}</Td><Td className="text-right">{qty(l.cantidad_recibida)}</Td><Td className="text-right">{qty(l.cantidad_disponible)}</Td><Td>{date(l.fecha_vencimiento)}</Td><Td>{l.referencia_garantia ?? '—'}</Td>{l.costo_unitario !== undefined && <Td className="text-right">{money(l.costo_unitario)}</Td>}</tr>
                    ))}
                  </tbody>
                </Table>
              </DataState>
            </Card>
            <Card>
              <CardHeader><CardTitle>Datos del producto</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                <p>{p.descripcion ?? 'Sin descripción'}</p>
                <p>Categoría: {p.categoria ?? '—'}</p>
                <p>Unidad base: {p.unidad_nombre} ({p.unidad_codigo}), {p.decimales_permitidos} decimales</p>
                <p>Controla vencimiento: {p.controla_vencimiento ? 'Sí' : 'No'} · garantía: {p.controla_garantia ? 'Sí' : 'No'}</p>
                <p>Estado: {p.activo ? 'Activo' : 'Inactivo'}</p>
              </CardContent>
            </Card>
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Conversiones de unidad</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <Table>
                  <thead><tr><Th>Unidad</Th><Th>Tipo</Th><Th className="text-right">Equivale a (unidad base)</Th></tr></thead>
                  <tbody>
                    {p.conversiones.map((c) => <tr key={c.id}><Td>{c.unidad_nombre} ({c.unidad_codigo})</Td><Td>{c.tipo}</Td><Td className="text-right">{qty(c.factor_a_base)} {p.unidad_codigo}</Td></tr>)}
                    {p.conversiones.length === 0 && <tr><Td colSpan={3} className="text-center text-slate-500">Solo se usa la unidad base</Td></tr>}
                  </tbody>
                </Table>
                {can('conversion.gestionar') && (
                  <form className="grid items-end gap-2 sm:grid-cols-4" onSubmit={(e) => { e.preventDefault(); addConv.mutate(); }}>
                    <Field label="Unidad">{(fid) => <Select id={fid} required value={conv.unidad_id} onChange={(e) => setConv({ ...conv, unidad_id: e.target.value })}><option value="">Seleccione</option>{units.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}</Select>}</Field>
                    <Field label="Tipo">{(fid) => <Select id={fid} value={conv.tipo} onChange={(e) => setConv({ ...conv, tipo: e.target.value })}><option value="venta">Venta</option><option value="compra">Compra</option></Select>}</Field>
                    <Field label="Factor a base">{(fid) => <Input id={fid} type="number" step="any" min="0.000001" required value={conv.factor_a_base} onChange={(e) => setConv({ ...conv, factor_a_base: e.target.value })} />}</Field>
                    <Button type="submit" loading={addConv.isPending}>Agregar</Button>
                    {addConv.error && <Alert tone="danger" className="sm:col-span-4">{errorMessage(addConv.error)}</Alert>}
                  </form>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Ficha técnica</CardTitle></CardHeader>
              <CardContent className="space-y-1 text-sm">
                {p.ficha_tecnica ? (
                  Object.entries(p.ficha_tecnica)
                    .filter(([k, v]) => v != null && !['producto_id', 'actualizado_en'].includes(k))
                    .map(([k, v]) => <p key={k}><span className="text-slate-500">{k.replace(/_/g, ' ')}:</span> {Array.isArray(v) ? v.join(', ') : String(v)}</p>)
                ) : (
                  <p className="text-slate-500">Sin ficha técnica. El cotizador no estimará rendimientos para este producto.</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}
    </DataState>
  );
}
