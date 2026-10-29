import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Boxes, PackageX, ShoppingCart, Truck, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { DataState, PageHeader } from '@/components/common';
import { Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from '@/components/ui';
import { apiFetch } from '@/lib/api';
import { date, dateTime, money, qty } from '@/lib/format';

interface Dashboard {
  periodo: { desde: string; hasta: string };
  productos_activos: number;
  productos_agotados: number;
  productos_bajo_minimo: number;
  valor_inventario: string | null;
  compras_periodo: { documentos: number; total: string } | null;
  ventas_periodo: { documentos: number; total: string } | null;
  mas_vendidos: { producto_id: number; nombre: string; marca: string; cantidad_base: string; unidad_base: string; total_facturado: string }[] | null;
  alertas_vencimiento: { lote_id: number; producto: string; cantidad_disponible: string; fecha_vencimiento: string; dias_para_vencer: number }[];
  actividad_reciente: { id: number; fecha_hora: string; tipo: string; cantidad: string; producto: string; unidad: string; usuario: string; documento_numero: string | null }[] | null;
}

const TIPO: Record<string, string> = { entrada_compra: 'Entrada', salida_venta: 'Salida', cambio_estado: 'Cambio de estado' };

function Kpi({ icon, label, value, to, tone = 'text-slate-900' }: { icon: ReactNode; label: string; value: ReactNode; to?: string; tone?: string }) {
  const body = (
    <Card className="h-full transition-shadow hover:shadow-md">
      <CardContent className="flex items-center gap-3">
        <div className="rounded-md bg-slate-100 p-2 text-slate-600">{icon}</div>
        <div>
          <p className="text-xs text-slate-500">{label}</p>
          <p className={`text-xl font-bold ${tone}`}>{value}</p>
        </div>
      </CardContent>
    </Card>
  );
  return to ? <Link to={to}>{body}</Link> : body;
}

export function DashboardPage() {
  const q = useQuery({ queryKey: ['dashboard'], queryFn: () => apiFetch<Dashboard>('/reports/dashboard') });
  const d = q.data;
  return (
    <>
      <PageHeader title="Dashboard de inventario" description={d ? `Período ${date(d.periodo.desde)} – ${date(d.periodo.hasta)} · datos calculados por el servidor` : undefined} />
      <DataState loading={q.isLoading} error={q.error}>
        {d && (
          <div className="space-y-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Kpi icon={<Boxes className="h-5 w-5" />} label="Productos activos" value={d.productos_activos} to="/productos" />
              <Kpi icon={<PackageX className="h-5 w-5" />} label="Agotados" value={d.productos_agotados} tone="text-red-700" to="/existencias?vista=agotados" />
              <Kpi icon={<AlertTriangle className="h-5 w-5" />} label="Bajo mínimo" value={d.productos_bajo_minimo} tone="text-amber-700" to="/existencias?vista=minimo" />
              <Kpi icon={<Wallet className="h-5 w-5" />} label="Valor del inventario" value={d.valor_inventario != null ? money(d.valor_inventario) : 'Sin permiso'} />
              <Kpi icon={<Truck className="h-5 w-5" />} label="Compras del período" value={d.compras_periodo ? money(d.compras_periodo.total) : 'Sin permiso'} />
              <Kpi icon={<ShoppingCart className="h-5 w-5" />} label="Ventas del período" value={d.ventas_periodo ? money(d.ventas_periodo.total) : 'Sin permiso'} />
            </div>
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader><CardTitle>Productos más vendidos</CardTitle></CardHeader>
                <DataState loading={false} error={null} empty={!d.mas_vendidos?.length} emptyText={d.mas_vendidos ? 'Sin ventas en el período' : 'Requiere permiso de reportes'}>
                  <Table>
                    <thead><tr><Th>Producto</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Facturado</Th></tr></thead>
                    <tbody>
                      {d.mas_vendidos?.map((p) => (
                        <tr key={p.producto_id}><Td>{p.nombre} <span className="text-slate-500">· {p.marca}</span></Td><Td className="text-right">{qty(p.cantidad_base)} {p.unidad_base}</Td><Td className="text-right">{money(p.total_facturado)}</Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </DataState>
              </Card>
              <Card>
                <CardHeader><CardTitle>Alertas de vencimiento (60 días)</CardTitle></CardHeader>
                <DataState loading={false} error={null} empty={!d.alertas_vencimiento.length} emptyText="No hay lotes por vencer">
                  <Table>
                    <thead><tr><Th>Producto</Th><Th>Lote</Th><Th className="text-right">Saldo</Th><Th>Vence</Th></tr></thead>
                    <tbody>
                      {d.alertas_vencimiento.map((l) => (
                        <tr key={l.lote_id}><Td>{l.producto}</Td><Td>#{l.lote_id}</Td><Td className="text-right">{qty(l.cantidad_disponible)}</Td><Td>{date(l.fecha_vencimiento)} <span className="text-xs text-amber-700">({l.dias_para_vencer} días)</span></Td></tr>
                      ))}
                    </tbody>
                  </Table>
                </DataState>
              </Card>
            </div>
            <Card>
              <CardHeader><CardTitle>Actividad reciente</CardTitle></CardHeader>
              <DataState loading={false} error={null} empty={!d.actividad_reciente?.length} emptyText={d.actividad_reciente ? 'Sin movimientos' : 'Requiere permiso de kardex'}>
                <Table>
                  <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Producto</Th><Th className="text-right">Cantidad</Th><Th>Documento</Th><Th>Usuario</Th></tr></thead>
                  <tbody>
                    {d.actividad_reciente?.map((m) => (
                      <tr key={m.id}><Td>{dateTime(m.fecha_hora)}</Td><Td>{TIPO[m.tipo]}</Td><Td>{m.producto}</Td><Td className="text-right">{qty(m.cantidad)} {m.unidad}</Td><Td>{m.documento_numero ?? '—'}</Td><Td>{m.usuario}</Td></tr>
                    ))}
                  </tbody>
                </Table>
              </DataState>
            </Card>
          </div>
        )}
      </DataState>
    </>
  );
}
