import { zodResolver } from '@hookform/resolvers/zod';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { DataState, PageHeader, Pagination } from '@/components/common';
import { ProductPicker } from '@/components/ProductPicker';
import { Alert, Badge, Button, Card, Dialog, Field, Input, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { apiFetch, errorMessage, type Paginated } from '@/lib/api';
import { dateTime, money, qty } from '@/lib/format';
import type { Product, ProductDetail } from '@/types';

interface DocRow { id: number; numero: string; fecha: string; estado: string; total: string; proveedor?: string; cliente?: string; usuario: string; canal?: string }
interface DocDetail extends DocRow {
  motivo_anulacion: string | null;
  medio_pago?: string | null;
  lineas: { id: number; producto: string; marca: string; presentacion: string; cantidad: string; unidad: string; costo_unitario?: string; precio_unitario?: string; subtotal?: string; fecha_vencimiento?: string | null; referencia_garantia?: string | null }[];
}

interface Line { producto: Product; unidades: { id: number; codigo: string }[]; cantidad: string; unidad_id: number; costo_unitario: string; fecha_vencimiento: string; referencia_garantia: string }

function useParties(rol: 'cliente' | 'proveedor') {
  return useQuery({
    queryKey: ['parties', rol],
    queryFn: () => apiFetch<Paginated<{ id: number; nombre_completo: string; numero_documento: string; activo: boolean }>>('/third-parties', { query: { rol, pageSize: 200 } }),
  });
}

async function unitsFor(p: Product, tipo: 'compra' | 'venta') {
  const d = await apiFetch<ProductDetail>(`/products/${p.id}`);
  return [{ id: p.unidad_base_id, codigo: p.unidad_codigo }, ...d.conversiones.filter((c) => c.tipo === tipo).map((c) => ({ id: c.unidad_id, codigo: c.unidad_codigo }))];
}

/** Formulario de compra o venta. En ventas el precio lo pone el servidor; el cliente solo indica cantidades. */
function DocumentForm({ kind, onDone }: { kind: 'compra' | 'venta'; onDone: (id: number) => void }) {
  const parties = useParties(kind === 'compra' ? 'proveedor' : 'cliente');
  const [tercero, setTercero] = useState('');
  const [medioPago, setMedioPago] = useState('');
  const [lineas, setLineas] = useState<Line[]>([]);
  const add = async (p: Product) => {
    const unidades = await unitsFor(p, kind);
    setLineas((l) => [...l, { producto: p, unidades, cantidad: '1', unidad_id: p.unidad_base_id, costo_unitario: '', fecha_vencimiento: '', referencia_garantia: '' }]);
  };
  const set = (i: number, patch: Partial<Line>) => setLineas((l) => l.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const save = useMutation({
    mutationFn: () =>
      kind === 'compra'
        ? apiFetch<{ id: number }>('/purchases', { body: { proveedor_id: Number(tercero), lineas: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: Number(l.cantidad), unidad_id: l.unidad_id, costo_unitario: Number(l.costo_unitario), fecha_vencimiento: l.fecha_vencimiento || null, referencia_garantia: l.referencia_garantia || null })) } })
        : apiFetch<{ id: number }>('/sales', { body: { cliente_id: Number(tercero), medio_pago: medioPago || null, lineas: lineas.map((l) => ({ producto_id: l.producto.id, cantidad: Number(l.cantidad), unidad_id: l.unidad_id })) } }),
    onSuccess: (d) => onDone(d.id),
  });
  return (
    <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <div className="grid gap-3 md:grid-cols-2">
        <Field label={kind === 'compra' ? 'Proveedor' : 'Cliente'}>
          {(i) => (
            <Select id={i} required value={tercero} onChange={(e) => setTercero(e.target.value)}>
              <option value="">Seleccione</option>
              {parties.data?.data.filter((t) => t.activo).map((t) => <option key={t.id} value={t.id}>{t.nombre_completo} · {t.numero_documento}</option>)}
            </Select>
          )}
        </Field>
        {kind === 'venta' && <Field label="Medio de pago (opcional)">{(i) => <Input id={i} value={medioPago} onChange={(e) => setMedioPago(e.target.value)} />}</Field>}
      </div>
      <ProductPicker autoFocus onPick={add} placeholder="Escanee o busque productos para agregar…" />
      <Table>
        <thead><tr><Th>Producto</Th><Th>Cantidad</Th><Th>Unidad</Th>{kind === 'compra' ? <><Th>Costo por unidad</Th><Th>Vencimiento / garantía</Th></> : <Th className="text-right">Precio vigente (base)</Th>}<Th><span className="sr-only">Quitar</span></Th></tr></thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i}>
              <Td>{l.producto.nombre}<p className="text-xs text-slate-500">{l.producto.marca} · disp. {qty(l.producto.disponible)} {l.producto.unidad_codigo}</p></Td>
              <Td><Input aria-label="Cantidad" type="number" step="any" min="0" required className="h-8 w-24" value={l.cantidad} onChange={(e) => set(i, { cantidad: e.target.value })} /></Td>
              <Td><Select aria-label="Unidad" className="h-8 w-28" value={l.unidad_id} onChange={(e) => set(i, { unidad_id: Number(e.target.value) })}>{l.unidades.map((u) => <option key={u.id} value={u.id}>{u.codigo}</option>)}</Select></Td>
              {kind === 'compra' ? (
                <>
                  <Td><Input aria-label="Costo unitario" type="number" step="any" min="0" required className="h-8 w-28" value={l.costo_unitario} onChange={(e) => set(i, { costo_unitario: e.target.value })} /></Td>
                  <Td className="space-y-1">
                    {l.producto.controla_vencimiento && <Input aria-label="Fecha de vencimiento" type="date" required className="h-8" value={l.fecha_vencimiento} onChange={(e) => set(i, { fecha_vencimiento: e.target.value })} />}
                    {l.producto.controla_garantia && <Input aria-label="Referencia de garantía" required placeholder="Garantía" className="h-8" value={l.referencia_garantia} onChange={(e) => set(i, { referencia_garantia: e.target.value })} />}
                    {!l.producto.controla_vencimiento && !l.producto.controla_garantia && <span className="text-xs text-slate-400">No aplica</span>}
                  </Td>
                </>
              ) : <Td className="text-right">{money(l.producto.precio_vigente)}</Td>}
              <Td><Button type="button" variant="ghost" size="icon" aria-label="Quitar línea" onClick={() => setLineas(lineas.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button></Td>
            </tr>
          ))}
        </tbody>
      </Table>
      {kind === 'venta' && <p className="text-xs text-slate-500">El servidor calcula precios con el precio vigente y verifica la existencia disponible al confirmar. No se calculan impuestos (por definir).</p>}
      {save.error && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
      <div className="flex justify-end"><Button type="submit" disabled={lineas.length === 0} loading={save.isPending}>Confirmar {kind}</Button></div>
    </form>
  );
}

function DocumentDetail({ kind, id }: { kind: 'compra' | 'venta'; id: number }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const path = kind === 'compra' ? 'purchases' : 'sales';
  const [motivo, setMotivo] = useState('');
  const q = useQuery({ queryKey: [path, id], queryFn: () => apiFetch<DocDetail>(`/${path}/${id}`) });
  const anular = useMutation({ mutationFn: () => apiFetch(`/${path}/${id}/void`, { body: { motivo } }), onSuccess: () => qc.invalidateQueries({ queryKey: [path] }) });
  const d = q.data;
  return (
    <DataState loading={q.isLoading} error={q.error}>
      {d && (
        <div className="space-y-3 text-sm">
          <p><strong>{d.numero}</strong> · {dateTime(d.fecha)} · {d.proveedor ?? d.cliente} · registrado por {d.usuario} <Badge tone={d.estado === 'anulado' ? 'danger' : 'success'}>{d.estado}</Badge></p>
          {d.motivo_anulacion && <Alert tone="warning">Anulado: {d.motivo_anulacion}</Alert>}
          <Table>
            <thead><tr><Th>Producto</Th><Th className="text-right">Cantidad</Th><Th className="text-right">{kind === 'compra' ? 'Costo' : 'Precio'}</Th><Th className="text-right">Subtotal</Th></tr></thead>
            <tbody>{d.lineas.map((l) => <tr key={l.id}><Td>{l.producto}<p className="text-xs text-slate-500">{l.marca} · {l.presentacion}</p></Td><Td className="text-right">{qty(l.cantidad)} {l.unidad}</Td><Td className="text-right">{money(l.costo_unitario ?? l.precio_unitario)}</Td><Td className="text-right">{money(l.subtotal)}</Td></tr>)}</tbody>
          </Table>
          <p className="text-right">Total: <strong>{money(d.total)}</strong></p>
          {d.estado === 'confirmado' && can('documento.anular') && (
            <form className="flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); anular.mutate(); }}>
              <Field label="Motivo de anulación" className="flex-1">{(i) => <Input id={i} required minLength={3} value={motivo} onChange={(e) => setMotivo(e.target.value)} />}</Field>
              <Button variant="destructive" type="submit" loading={anular.isPending}>Anular</Button>
            </form>
          )}
          {anular.error && <Alert tone="danger">{errorMessage(anular.error)}</Alert>}
          <p className="text-xs text-slate-500">Los documentos confirmados no se editan ni se eliminan. La anulación no revierte existencias (política por definir).</p>
        </div>
      )}
    </DataState>
  );
}

function DocumentsPage({ kind }: { kind: 'compra' | 'venta' }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const path = kind === 'compra' ? 'purchases' : 'sales';
  const [page, setPage] = useState(1);
  const [nuevo, setNuevo] = useState(false);
  const [ver, setVer] = useState<number>();
  const list = useQuery({ queryKey: [path, page], queryFn: () => apiFetch<Paginated<DocRow>>(`/${path}`, { query: { page } }), placeholderData: keepPreviousData });
  const canCreate = can(kind === 'compra' ? 'compra.registrar' : 'venta.registrar');
  return (
    <>
      <PageHeader
        title={kind === 'compra' ? 'Compras y documentos de ingreso' : 'Ventas y facturas'}
        description={kind === 'compra' ? 'Cada compra genera un documento de ingreso, lotes, existencia, costo promedio y precio en una sola transacción.' : 'Cada venta genera una factura y descuenta solo existencia disponible.'}
        actions={canCreate && <Button onClick={() => setNuevo(true)}><Plus className="h-4 w-4" aria-hidden /> Nueva {kind}</Button>}
      />
      <Card>
        <DataState loading={list.isLoading} error={list.error} empty={list.data?.data.length === 0}>
          <Table>
            <thead><tr><Th>Número</Th><Th>Fecha</Th><Th>{kind === 'compra' ? 'Proveedor' : 'Cliente'}</Th><Th>Estado</Th><Th className="text-right">Total</Th><Th>Usuario</Th></tr></thead>
            <tbody>
              {list.data?.data.map((d) => (
                <tr key={d.id}>
                  <Td><button className="font-medium text-brand-700 hover:underline" onClick={() => setVer(d.id)}>{d.numero}</button>{d.canal === 'offline' && <Badge className="ml-1">offline</Badge>}</Td>
                  <Td>{dateTime(d.fecha)}</Td><Td>{d.proveedor ?? d.cliente}</Td>
                  <Td><Badge tone={d.estado === 'anulado' ? 'danger' : 'success'}>{d.estado}</Badge></Td>
                  <Td className="text-right">{money(d.total)}</Td><Td>{d.usuario}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
        </DataState>
      </Card>
      <Dialog open={nuevo} onClose={() => setNuevo(false)} title={`Nueva ${kind}`} wide>
        <DocumentForm kind={kind} onDone={(id) => { setNuevo(false); qc.invalidateQueries({ queryKey: [path] }); setVer(id); }} />
      </Dialog>
      <Dialog open={ver != null} onClose={() => setVer(undefined)} title={kind === 'compra' ? 'Documento de ingreso' : 'Factura'} wide>
        {ver != null && <DocumentDetail kind={kind} id={ver} />}
      </Dialog>
    </>
  );
}

export const PurchasesPage = () => <DocumentsPage kind="compra" />;
export const SalesPage = () => <DocumentsPage kind="venta" />;

// ---------------------------------------------------------------------------
// Clientes y proveedores (RF-TER-001)
// ---------------------------------------------------------------------------
export const ThirdPartyFormSchema = z
  .object({
    tipo_persona: z.enum(['natural', 'juridica']),
    tipo_documento: z.enum(['cedula', 'nit']),
    numero_documento: z.string().trim().regex(/^[0-9A-Za-z-]{3,30}$/, 'Número de documento inválido'),
    nombre: z.string().trim().max(100).optional(),
    apellido: z.string().trim().max(100).optional(),
    razon_social: z.string().trim().max(200).optional(),
    direccion: z.string().trim().max(200).optional(),
    telefono: z.string().trim().max(30).optional(),
    correo: z.union([z.literal(''), z.string().trim().email('Correo inválido')]).optional(),
    es_cliente: z.boolean(),
    es_proveedor: z.boolean(),
  })
  .refine((v) => v.tipo_persona !== 'natural' || (v.nombre && v.apellido), { message: 'Persona natural: nombre y apellido obligatorios', path: ['nombre'] })
  .refine((v) => v.tipo_persona !== 'juridica' || v.razon_social, { message: 'Persona jurídica: razón social obligatoria', path: ['razon_social'] })
  .refine((v) => v.es_cliente || v.es_proveedor, { message: 'Marque cliente, proveedor o ambos', path: ['es_cliente'] });
type TPForm = z.infer<typeof ThirdPartyFormSchema>;

export function ThirdPartiesPage() {
  const qc = useQueryClient();
  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  const [nuevo, setNuevo] = useState(false);
  const list = useQuery({
    queryKey: ['third-parties', q, rol],
    queryFn: () => apiFetch<Paginated<{ id: number; tipo_persona: string; tipo_documento: string; numero_documento: string; nombre_completo: string; telefono: string | null; correo: string | null; es_cliente: boolean; es_proveedor: boolean; activo: boolean }>>('/third-parties', { query: { q, rol, pageSize: 100 } }),
  });
  const { register, handleSubmit, watch, reset, formState: { errors } } = useForm<TPForm>({ resolver: zodResolver(ThirdPartyFormSchema), defaultValues: { tipo_persona: 'natural', tipo_documento: 'cedula', es_cliente: true, es_proveedor: false } });
  const save = useMutation({
    mutationFn: (v: TPForm) => apiFetch('/third-parties', { body: v }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['third-parties'] }); qc.invalidateQueries({ queryKey: ['parties'] }); setNuevo(false); reset(); },
  });
  const natural = watch('tipo_persona') === 'natural';
  return (
    <>
      <PageHeader title="Clientes y proveedores" description="Un tercero puede ser cliente, proveedor o ambos. Tipo y número de documento son únicos." actions={<Button onClick={() => setNuevo(true)}><Plus className="h-4 w-4" aria-hidden /> Nuevo tercero</Button>} />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Input aria-label="Buscar" placeholder="Nombre, razón social o documento…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-sm" />
          <Select aria-label="Rol" value={rol} onChange={(e) => setRol(e.target.value)} className="w-48"><option value="">Todos</option><option value="cliente">Clientes</option><option value="proveedor">Proveedores</option></Select>
        </div>
        <DataState loading={list.isLoading} error={list.error} empty={list.data?.data.length === 0}>
          <Table>
            <thead><tr><Th>Documento</Th><Th>Nombre / razón social</Th><Th>Tipo</Th><Th>Roles</Th><Th>Contacto</Th><Th>Estado</Th></tr></thead>
            <tbody>
              {list.data?.data.map((t) => (
                <tr key={t.id}>
                  <Td>{t.tipo_documento.toUpperCase()} {t.numero_documento}</Td><Td>{t.nombre_completo}</Td><Td>{t.tipo_persona}</Td>
                  <Td className="space-x-1">{t.es_cliente && <Badge tone="info">Cliente</Badge>}{t.es_proveedor && <Badge>Proveedor</Badge>}</Td>
                  <Td className="text-xs">{t.telefono}<br />{t.correo}</Td><Td>{t.activo ? 'Activo' : 'Inactivo'}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </DataState>
      </Card>
      <Dialog open={nuevo} onClose={() => setNuevo(false)} title="Nuevo cliente o proveedor">
        <form className="grid gap-3 sm:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
          <Field label="Tipo de persona">{(i) => <Select id={i} {...register('tipo_persona')}><option value="natural">Natural</option><option value="juridica">Jurídica</option></Select>}</Field>
          <Field label="Tipo de documento">{(i) => <Select id={i} {...register('tipo_documento')}><option value="cedula">Cédula</option><option value="nit">NIT</option></Select>}</Field>
          <Field label="Número de documento" error={errors.numero_documento?.message} className="sm:col-span-2">{(i, d) => <Input id={i} aria-describedby={d} aria-invalid={!!errors.numero_documento} {...register('numero_documento')} />}</Field>
          {natural ? (
            <>
              <Field label="Nombre" error={errors.nombre?.message}>{(i, d) => <Input id={i} aria-describedby={d} aria-invalid={!!errors.nombre} {...register('nombre')} />}</Field>
              <Field label="Apellido">{(i) => <Input id={i} {...register('apellido')} />}</Field>
            </>
          ) : (
            <Field label="Razón social" error={errors.razon_social?.message} className="sm:col-span-2">{(i, d) => <Input id={i} aria-describedby={d} aria-invalid={!!errors.razon_social} {...register('razon_social')} />}</Field>
          )}
          <Field label="Dirección" className="sm:col-span-2">{(i) => <Input id={i} {...register('direccion')} />}</Field>
          <Field label="Teléfono">{(i) => <Input id={i} {...register('telefono')} />}</Field>
          <Field label="Correo" error={errors.correo?.message}>{(i, d) => <Input id={i} type="email" aria-describedby={d} {...register('correo')} />}</Field>
          <div className="space-y-1 sm:col-span-2">
            <div className="flex gap-4 text-sm"><label className="flex items-center gap-2"><input type="checkbox" {...register('es_cliente')} /> Cliente</label><label className="flex items-center gap-2"><input type="checkbox" {...register('es_proveedor')} /> Proveedor</label></div>
            {errors.es_cliente && <p role="alert" className="text-xs text-red-600">{errors.es_cliente.message}</p>}
          </div>
          {save.error && <Alert tone="danger" className="sm:col-span-2">{errorMessage(save.error)}</Alert>}
          <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" variant="outline" onClick={() => setNuevo(false)}>Cancelar</Button><Button type="submit" loading={save.isPending}>Guardar</Button></div>
        </form>
      </Dialog>
    </>
  );
}
