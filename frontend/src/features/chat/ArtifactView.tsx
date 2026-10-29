import { ExternalLink, FileText, PackageSearch } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { AvailabilityBadge, StockBadge } from '@/components/common';
import { Alert, Badge, Button, Card, CardContent, Table, Td, Th } from '@/components/ui';
import { money, qty } from '@/lib/format';
import type { ChatArtifact, QuoteLine } from '@/types';

interface BriefProduct {
  producto_id: number;
  nombre: string;
  marca: string;
  presentacion: string;
  unidad_base: string;
  disponible: string;
  reservada: string;
  danada: string;
  estado_stock: string;
  precio_vigente: string | null;
}

function ProductCards({ items }: { items: BriefProduct[] }) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {items.slice(0, 8).map((p) => (
        <Card key={p.producto_id} className="text-sm">
          <CardContent className="space-y-1 p-3">
            <div className="flex items-start justify-between gap-2">
              <p className="font-medium">{p.nombre}</p>
              <StockBadge estado={p.estado_stock} />
            </div>
            <p className="text-xs text-slate-500">{p.marca} · {p.presentacion}</p>
            <p>
              Disponible <strong>{qty(p.disponible)} {p.unidad_base}</strong>
              {Number(p.reservada) > 0 && <> · reservada {qty(p.reservada)}</>}
              {Number(p.danada) > 0 && <> · dañada {qty(p.danada)}</>}
            </p>
            <div className="flex items-center justify-between">
              <span>{money(p.precio_vigente)}</span>
              <Link to={`/productos/${p.producto_id}`} className="inline-flex items-center gap-1 text-xs text-brand-700 hover:underline">
                Ver detalle <ExternalLink className="h-3 w-3" aria-hidden />
              </Link>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

function LinesTable({ lineas }: { lineas: QuoteLine[] }) {
  return (
    <Table>
      <thead><tr><Th>Producto</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Precio</Th><Th className="text-right">Subtotal</Th><Th>Estado</Th></tr></thead>
      <tbody>
        {lineas.map((l, i) => (
          <tr key={i}>
            <Td>{l.nombre}<p className="text-xs text-slate-500">{l.marca} · {l.presentacion}</p></Td>
            <Td className="text-right">{qty(l.cantidad)} {l.unidad_codigo}</Td>
            <Td className="text-right">{money(l.precio_unitario)}</Td>
            <Td className="text-right">{money(l.subtotal)}</Td>
            <Td><AvailabilityBadge estado={l.disponibilidad} /></Td>
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

/** Representa los resultados verificados de las herramientas (no el texto del modelo). */
export function ArtifactView({ artifact }: { artifact: ChatArtifact }) {
  const navigate = useNavigate();
  const d = artifact.datos;
  switch (artifact.tipo) {
    case 'productos':
      return <ProductCards items={d} />;
    case 'existencias':
    case 'precio':
    case 'detalle':
      return d.encontrado === false ? null : <ProductCards items={[{ ...d, unidad_base: d.unidad_base ?? d.unidad, estado_stock: d.estado_stock ?? (d.activo ? 'normal' : 'inactivo'), disponible: d.disponible ?? '0', reservada: d.reservada ?? '0', danada: d.danada ?? '0' }]} />;
    case 'alertas':
      return (
        <div className="space-y-2">
          <p className="flex items-center gap-2 text-sm font-medium"><PackageSearch className="h-4 w-4" aria-hidden /> {d.titulo}: {d.total}{d.criterio ? ` (${d.criterio})` : ''}</p>
          <ProductCards items={d.productos} />
        </div>
      );
    case 'pintura':
      if (d.estado === 'faltan_datos') {
        return <Alert tone="info" title="Faltan datos para calcular"><ul className="list-disc pl-4">{d.faltantes.map((f: string) => <li key={f}>{f}</li>)}</ul></Alert>;
      }
      return (
        <Card>
          <CardContent className="space-y-2 p-3 text-sm">
            <p className="font-medium">Estimación de materiales · área neta {d.areas.area_neta_total} m² · {d.manos} manos · desperdicio {d.desperdicio_pct} %</p>
            <LinesTable lineas={d.lineas} />
            <p>Total {money(d.total)} · disponible para compra inmediata {money(d.total_disponible)}</p>
            {d.pendientes?.length > 0 && <Alert tone="warning">Pendientes: {d.pendientes.map((p: { tipo: string }) => p.tipo).join(', ')}</Alert>}
            <Button size="sm" onClick={() => navigate('/cotizador', { state: { parametros: d.parametros } })}>Abrir en el cotizador</Button>
          </CardContent>
        </Card>
      );
    case 'cotizacion':
      return <Card><CardContent className="space-y-2 p-3 text-sm"><LinesTable lineas={d.lineas} /><p className="font-medium">Total {money(d.total)}</p></CardContent></Card>;
    case 'borrador_cotizacion':
      return (
        <Card className="border-brand-100">
          <CardContent className="space-y-2 p-3 text-sm">
            <p className="flex items-center gap-2 font-medium"><FileText className="h-4 w-4" aria-hidden /> Borrador: {d.descripcion_proyecto} <Badge tone="warning">Pendiente de confirmación</Badge></p>
            <LinesTable lineas={d.lineas} />
            <p>Total {money(d.total)}</p>
            <Button size="sm" onClick={() => navigate('/cotizador', { state: { borrador: d } })}>Revisar y guardar</Button>
          </CardContent>
        </Card>
      );
    case 'estado_cotizacion':
      return d.encontrada ? (
        <Link to={`/cotizaciones/${d.id}`} className="text-sm text-brand-700 hover:underline">{d.numero}: {d.estado} · {money(d.total)}</Link>
      ) : null;
    default:
      return null;
  }
}
