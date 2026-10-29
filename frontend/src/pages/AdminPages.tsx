import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Plus, Upload } from 'lucide-react';
import { useState } from 'react';
import { DataState, PageHeader, Pagination, StockBadge } from '@/components/common';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Dialog, Field, Input, Select, Table, Td, Th, Textarea } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { apiFetch, errorMessage, type Paginated } from '@/lib/api';
import { date, dateTime, money, qty } from '@/lib/format';
import type { Product } from '@/types';

// ---------------------------------------------------------------------------
// Reportes (RF-REP-001)
// ---------------------------------------------------------------------------
const REPORTES = {
  valuation: 'Valorización del inventario',
  'low-stock': 'Stock mínimo',
  expiring: 'Lotes por vencer',
  'top-selling': 'Productos más vendidos',
  warranties: 'Productos con garantía',
  sales: 'Ventas del período',
  purchases: 'Compras del período',
} as const;
type ReportKey = keyof typeof REPORTES;

export function ReportsPage() {
  const { can } = useAuth();
  const [tipo, setTipo] = useState<ReportKey>('low-stock');
  const [range, setRange] = useState({ desde: '', hasta: '' });
  const q = useQuery({
    queryKey: ['report', tipo, range],
    queryFn: () => apiFetch<Record<string, any>>(`/reports/${tipo}`, { query: range }), // eslint-disable-line @typescript-eslint/no-explicit-any
  });
  const opciones = (Object.keys(REPORTES) as ReportKey[]).filter((k) => k !== 'valuation' || can('costo.consultar'));
  const r = q.data;
  return (
    <>
      <PageHeader title="Reportes" description="Consultas de solo lectura. Los documentos anulados se excluyen de las ventas." />
      <Card>
        <div className="flex flex-wrap items-end gap-2 border-b p-3">
          <Field label="Reporte">{(i) => <Select id={i} value={tipo} onChange={(e) => setTipo(e.target.value as ReportKey)}>{opciones.map((k) => <option key={k} value={k}>{REPORTES[k]}</option>)}</Select>}</Field>
          {['top-selling', 'sales', 'purchases'].includes(tipo) && (
            <>
              <Field label="Desde">{(i) => <Input id={i} type="date" value={range.desde} onChange={(e) => setRange({ ...range, desde: e.target.value })} />}</Field>
              <Field label="Hasta">{(i) => <Input id={i} type="date" value={range.hasta} onChange={(e) => setRange({ ...range, hasta: e.target.value })} />}</Field>
            </>
          )}
        </div>
        <DataState loading={q.isLoading} error={q.error}>
          {r && tipo === 'valuation' && (
            <>
              <Table>
                <thead><tr><Th>Código</Th><Th>Producto</Th><Th>Estado</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Costo promedio</Th><Th className="text-right">Valor</Th></tr></thead>
                <tbody>{r.data.map((x: any, i: number) => <tr key={i}><Td className="font-mono text-xs">{x.codigo_barras}</Td><Td>{x.nombre} · {x.marca}</Td><Td>{x.estado}</Td><Td className="text-right">{qty(x.cantidad)}</Td><Td className="text-right">{money(x.costo_promedio)}</Td><Td className="text-right">{money(x.valor_total)}</Td></tr>)}</tbody>
              </Table>
              <p className="p-3 text-right font-bold">Total: {money(r.total)}</p>
            </>
          )}
          {r && tipo === 'low-stock' && (
            <Table>
              <thead><tr><Th>Producto</Th><Th className="text-right">Disponible</Th><Th className="text-right">Mínimo</Th><Th>Estado</Th></tr></thead>
              <tbody>{r.data.map((p: Product) => <tr key={p.id}><Td>{p.nombre} · {p.marca} · {p.presentacion}</Td><Td className="text-right">{qty(p.disponible)} {p.unidad_codigo}</Td><Td className="text-right">{qty(p.stock_minimo)}</Td><Td><StockBadge estado={p.estado_stock} /></Td></tr>)}</tbody>
            </Table>
          )}
          {r && (tipo === 'expiring' || tipo === 'warranties') && (
            <Table>
              <thead><tr><Th>Lote</Th><Th>Producto</Th><Th className="text-right">Saldo</Th><Th>{tipo === 'expiring' ? 'Vence' : 'Garantía'}</Th></tr></thead>
              <tbody>{r.data.map((l: any) => <tr key={l.lote_id}><Td>#{l.lote_id}</Td><Td>{l.producto}</Td><Td className="text-right">{qty(l.cantidad_disponible)}</Td><Td>{tipo === 'expiring' ? `${date(l.fecha_vencimiento)} (${l.dias_para_vencer} días)` : l.referencia_garantia}</Td></tr>)}</tbody>
            </Table>
          )}
          {r && tipo === 'top-selling' && (
            <Table>
              <thead><tr><Th>Producto</Th><Th className="text-right">Cantidad (unidad base)</Th><Th className="text-right">Facturado</Th></tr></thead>
              <tbody>{r.data.map((x: any) => <tr key={x.producto_id}><Td>{x.nombre} · {x.marca}</Td><Td className="text-right">{qty(x.cantidad_base)} {x.unidad_base}</Td><Td className="text-right">{money(x.total_facturado)}</Td></tr>)}</tbody>
            </Table>
          )}
          {r && (tipo === 'sales' || tipo === 'purchases') && (
            <CardContent className="space-y-3">
              <p>Período {date(r.periodo.desde)} – {date(r.periodo.hasta)}: <strong>{r.resumen.documentos}</strong> documentos por <strong>{money(r.resumen.total)}</strong></p>
              <Table>
                <thead><tr><Th>Día</Th><Th className="text-right">Documentos</Th><Th className="text-right">Total</Th></tr></thead>
                <tbody>{r.por_dia.map((d: any) => <tr key={d.dia}><Td>{date(d.dia)}</Td><Td className="text-right">{d.documentos}</Td><Td className="text-right">{money(d.total)}</Td></tr>)}</tbody>
              </Table>
            </CardContent>
          )}
        </DataState>
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Usuarios, roles y permisos (RF-SEG-002)
// ---------------------------------------------------------------------------
interface UserRow { id: number; nombre: string; correo: string; activo: boolean; roles: { id: number; nombre: string }[] }
interface Role { id: number; nombre: string; descripcion: string; permisos: string[] }

export function UsersPage() {
  const qc = useQueryClient();
  const { user: me } = useAuth();
  const users = useQuery({ queryKey: ['users'], queryFn: () => apiFetch<{ data: UserRow[] }>('/users') });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => apiFetch<{ data: Role[] }>('/roles') });
  const perms = useQuery({ queryKey: ['permissions'], queryFn: () => apiFetch<{ data: { codigo: string; descripcion: string }[] }>('/permissions') });
  const [form, setForm] = useState<{ open: boolean; nombre: string; correo: string; contrasena: string; roles: number[] }>({ open: false, nombre: '', correo: '', contrasena: '', roles: [] });
  const create = useMutation({
    mutationFn: () => apiFetch('/users', { body: { nombre: form.nombre, correo: form.correo, contrasena: form.contrasena, roles: form.roles } }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['users'] }); setForm({ open: false, nombre: '', correo: '', contrasena: '', roles: [] }); },
  });
  const toggle = useMutation({ mutationFn: (u: UserRow) => apiFetch(`/users/${u.id}`, { method: 'PATCH', body: { activo: !u.activo } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }) });
  const setRolePerms = useMutation({ mutationFn: (r: Role) => apiFetch(`/roles/${r.id}/permissions`, { method: 'PUT', body: { permisos: r.permisos } }), onSuccess: () => qc.invalidateQueries({ queryKey: ['roles'] }) });

  return (
    <>
      <PageHeader title="Usuarios, roles y permisos" description="Los usuarios se desactivan, no se eliminan. La matriz definitiva de permisos está por definir." actions={<Button onClick={() => setForm({ ...form, open: true })}><Plus className="h-4 w-4" aria-hidden /> Nuevo usuario</Button>} />
      {(toggle.error || setRolePerms.error) && <Alert tone="danger" className="mb-4">{errorMessage(toggle.error ?? setRolePerms.error)}</Alert>}
      <div className="space-y-6">
        <Card>
          <DataState loading={users.isLoading} error={users.error}>
            <Table>
              <thead><tr><Th>Nombre</Th><Th>Correo</Th><Th>Roles</Th><Th>Estado</Th><Th><span className="sr-only">Acciones</span></Th></tr></thead>
              <tbody>
                {users.data?.data.map((u) => (
                  <tr key={u.id}>
                    <Td>{u.nombre}</Td><Td>{u.correo}</Td><Td className="space-x-1">{u.roles.map((r) => <Badge key={r.id}>{r.nombre}</Badge>)}</Td>
                    <Td><Badge tone={u.activo ? 'success' : 'neutral'}>{u.activo ? 'Activo' : 'Inactivo'}</Badge></Td>
                    <Td>{u.id !== me?.id && <Button variant="outline" size="sm" onClick={() => toggle.mutate(u)}>{u.activo ? 'Desactivar' : 'Activar'}</Button>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </DataState>
        </Card>
        <Card>
          <CardHeader><CardTitle>Matriz de permisos por rol</CardTitle></CardHeader>
          <DataState loading={roles.isLoading || perms.isLoading} error={roles.error ?? perms.error}>
            <Table>
              <thead><tr><Th>Permiso</Th>{roles.data?.data.map((r) => <Th key={r.id} className="text-center">{r.nombre}</Th>)}</tr></thead>
              <tbody>
                {perms.data?.data.map((p) => (
                  <tr key={p.codigo}>
                    <Td><code className="text-xs">{p.codigo}</code><p className="text-xs text-slate-500">{p.descripcion}</p></Td>
                    {roles.data?.data.map((r) => (
                      <Td key={r.id} className="text-center">
                        <input
                          type="checkbox"
                          aria-label={`${p.codigo} para ${r.nombre}`}
                          checked={r.permisos.includes(p.codigo)}
                          onChange={(e) => setRolePerms.mutate({ ...r, permisos: e.target.checked ? [...r.permisos, p.codigo] : r.permisos.filter((x) => x !== p.codigo) })}
                        />
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </Table>
          </DataState>
        </Card>
      </div>
      <Dialog open={form.open} onClose={() => setForm({ ...form, open: false })} title="Nuevo usuario">
        <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
          <Field label="Nombre">{(i) => <Input id={i} required value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} />}</Field>
          <Field label="Correo">{(i) => <Input id={i} type="email" required value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} />}</Field>
          <Field label="Contraseña inicial" hint="Mínimo 10 caracteres con letras y números">{(i, d) => <Input id={i} aria-describedby={d} type="password" autoComplete="new-password" required minLength={10} value={form.contrasena} onChange={(e) => setForm({ ...form, contrasena: e.target.value })} />}</Field>
          <fieldset><legend className="text-sm font-medium">Roles</legend>
            {roles.data?.data.map((r) => (
              <label key={r.id} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.roles.includes(r.id)} onChange={(e) => setForm({ ...form, roles: e.target.checked ? [...form.roles, r.id] : form.roles.filter((x) => x !== r.id) })} /> {r.nombre}</label>
            ))}
          </fieldset>
          {create.error && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
          <div className="flex justify-end"><Button type="submit" disabled={form.roles.length === 0} loading={create.isPending}>Crear usuario</Button></div>
        </form>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Auditoría (RF-AUD-001)
// ---------------------------------------------------------------------------
export function AuditPage() {
  const [f, setF] = useState({ tabla: '', accion: '', desde: '', hasta: '' });
  const [page, setPage] = useState(1);
  const [ver, setVer] = useState<{ antes: unknown; despues: unknown } | null>(null);
  const tablas = useQuery({ queryKey: ['audit-tables'], queryFn: () => apiFetch<{ data: string[] }>('/audit/tables') });
  const q = useQuery({
    queryKey: ['audit', f, page],
    queryFn: () => apiFetch<Paginated<{ id: number; fecha_hora: string; tabla_afectada: string; registro_id: string; accion: string; origen: string; usuario: string | null; valores_antes: unknown; valores_despues: unknown }>>('/audit', { query: { ...f, page, pageSize: 50 } }),
    placeholderData: keepPreviousData,
  });
  return (
    <>
      <PageHeader title="Auditoría" description="Registro inmutable de cambios con usuario, fecha, origen y valores antes y después." />
      <Card>
        <div className="flex flex-wrap gap-2 border-b p-3">
          <Select aria-label="Tabla" value={f.tabla} onChange={(e) => setF({ ...f, tabla: e.target.value })} className="w-56"><option value="">Todas las tablas</option>{tablas.data?.data.map((t) => <option key={t}>{t}</option>)}</Select>
          <Select aria-label="Acción" value={f.accion} onChange={(e) => setF({ ...f, accion: e.target.value })} className="w-40"><option value="">Todas</option><option value="insert">insert</option><option value="update">update</option><option value="delete">delete</option></Select>
          <Input aria-label="Desde" type="date" value={f.desde} onChange={(e) => setF({ ...f, desde: e.target.value })} className="w-44" />
          <Input aria-label="Hasta" type="date" value={f.hasta} onChange={(e) => setF({ ...f, hasta: e.target.value })} className="w-44" />
        </div>
        <DataState loading={q.isLoading} error={q.error} empty={q.data?.data.length === 0}>
          <Table>
            <thead><tr><Th>Fecha</Th><Th>Tabla</Th><Th>Registro</Th><Th>Acción</Th><Th>Usuario</Th><Th>Origen</Th><Th><span className="sr-only">Detalle</span></Th></tr></thead>
            <tbody>
              {q.data?.data.map((a) => (
                <tr key={a.id}>
                  <Td className="whitespace-nowrap">{dateTime(a.fecha_hora)}</Td><Td>{a.tabla_afectada}</Td><Td className="font-mono text-xs">{a.registro_id}</Td>
                  <Td><Badge tone={a.accion === 'insert' ? 'success' : a.accion === 'update' ? 'info' : 'danger'}>{a.accion}</Badge></Td>
                  <Td>{a.usuario ?? '—'}</Td><Td>{a.origen}</Td>
                  <Td><Button variant="ghost" size="sm" onClick={() => setVer({ antes: a.valores_antes, despues: a.valores_despues })}>Ver valores</Button></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {q.data && <Pagination page={page} totalPages={q.data.meta.totalPages} onChange={setPage} />}
        </DataState>
      </Card>
      <Dialog open={!!ver} onClose={() => setVer(null)} title="Valores antes y después" wide>
        <div className="grid gap-3 md:grid-cols-2">
          {(['antes', 'despues'] as const).map((k) => (
            <div key={k}><p className="mb-1 text-sm font-medium">{k === 'antes' ? 'Antes' : 'Después'}</p><pre className="max-h-96 overflow-auto rounded bg-slate-900 p-3 text-xs text-slate-100">{JSON.stringify(ver?.[k], null, 2) ?? 'null'}</pre></div>
          ))}
        </div>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Cierres mensuales (RF-CIE-001)
// ---------------------------------------------------------------------------
export function ClosuresPage() {
  const qc = useQueryClient();
  const [periodo, setPeriodo] = useState(new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7));
  const [obs, setObs] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [ver, setVer] = useState<number>();
  const list = useQuery({ queryKey: ['closures'], queryFn: () => apiFetch<{ data: { id: number; periodo: string; fecha_ejecucion: string; estado: string; valor_total_inventario: string; observaciones: string | null; usuario: string }[] }>('/closures') });
  const pending = useQuery({ queryKey: ['closures-pending'], queryFn: () => apiFetch<{ conflictos: { id: number; sistema_origen: string; tipo_evento: string; identificador_externo: string; mensaje_error: string | null }[] }>('/closures/pending') });
  const detail = useQuery({ queryKey: ['closure', ver], queryFn: () => apiFetch<{ detalle: { producto_id: number; nombre: string; estado: string; cantidad: string; costo_promedio: string; valor_total: string }[] }>(`/closures/${ver}`), enabled: ver != null });
  const run = useMutation({ mutationFn: () => apiFetch('/closures', { body: { periodo, observaciones: obs || null } }), onSuccess: () => { qc.invalidateQueries({ queryKey: ['closures'] }); setConfirm(false); } });
  return (
    <>
      <PageHeader title="Cierres mensuales" description="El cierre guarda una fotografía no editable y bloquea movimientos con fecha dentro del período." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
        <Card>
          <DataState loading={list.isLoading} error={list.error} empty={list.data?.data.length === 0} emptyText="Aún no hay cierres">
            <Table>
              <thead><tr><Th>Período</Th><Th>Ejecutado</Th><Th>Responsable</Th><Th className="text-right">Valor del inventario</Th><Th><span className="sr-only">Detalle</span></Th></tr></thead>
              <tbody>{list.data?.data.map((c) => <tr key={c.id}><Td className="font-medium">{c.periodo}</Td><Td>{dateTime(c.fecha_ejecucion)}</Td><Td>{c.usuario}</Td><Td className="text-right">{money(c.valor_total_inventario)}</Td><Td><Button variant="ghost" size="sm" onClick={() => setVer(c.id)}>Ver fotografía</Button></Td></tr>)}</tbody>
            </Table>
          </DataState>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ejecutar cierre</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {!!pending.data?.conflictos.length && (
              <Alert tone="warning" title="Operaciones pendientes o en conflicto">
                <ul className="list-disc pl-4 text-xs">{pending.data.conflictos.map((c) => <li key={c.id}>{c.sistema_origen} · {c.identificador_externo}: {c.mensaje_error}</li>)}</ul>
                <p>Los conflictos del período impiden el cierre hasta resolverlos.</p>
              </Alert>
            )}
            <Field label="Período (AAAA-MM)">{(i) => <Input id={i} type="month" value={periodo} onChange={(e) => setPeriodo(e.target.value)} />}</Field>
            <Field label="Observaciones">{(i) => <Textarea id={i} value={obs} onChange={(e) => setObs(e.target.value)} />}</Field>
            <Button className="w-full" onClick={() => setConfirm(true)}>Cerrar período</Button>
          </CardContent>
        </Card>
      </div>
      <Dialog open={confirm} onClose={() => setConfirm(false)} title={`Confirmar cierre de ${periodo}`}>
        <p className="text-sm">Después del cierre no se podrán registrar compras, ventas ni movimientos con fecha de {periodo}. Esta acción no se puede deshacer (la reapertura está por definir).</p>
        {run.error && <Alert tone="danger" className="mt-3">{errorMessage(run.error)}</Alert>}
        <div className="mt-4 flex justify-end gap-2"><Button variant="outline" onClick={() => setConfirm(false)}>Cancelar</Button><Button variant="destructive" loading={run.isPending} onClick={() => run.mutate()}>Ejecutar cierre</Button></div>
      </Dialog>
      <Dialog open={ver != null} onClose={() => setVer(undefined)} title="Fotografía del cierre" wide>
        <DataState loading={detail.isLoading} error={detail.error}>
          <Table>
            <thead><tr><Th>Producto</Th><Th>Estado</Th><Th className="text-right">Cantidad</Th><Th className="text-right">Costo</Th><Th className="text-right">Valor</Th></tr></thead>
            <tbody>{detail.data?.detalle.map((d, i) => <tr key={i}><Td>{d.nombre}</Td><Td>{d.estado}</Td><Td className="text-right">{qty(d.cantidad)}</Td><Td className="text-right">{money(d.costo_promedio)}</Td><Td className="text-right">{money(d.valor_total)}</Td></tr>)}</tbody>
          </Table>
        </DataState>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Importación desde Excel (RF-MIG-001)
// ---------------------------------------------------------------------------
interface ImportResult { id: string; tipo: string; estado: string; filas_validas: number; filas_invalidas: number; filas_cargadas: number; filas: Record<string, unknown>[] }

export function ImportsPage() {
  const qc = useQueryClient();
  const [tipo, setTipo] = useState<'productos' | 'terceros' | 'saldos'>('productos');
  const [fecha, setFecha] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const history = useQuery({ queryKey: ['imports'], queryFn: () => apiFetch<{ data: { id: string; tipo: string; nombre_archivo: string; estado: string; filas_validas: number; filas_invalidas: number; filas_cargadas: number; creada_en: string; usuario: string }[] }>('/imports') });
  const upload = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('tipo', tipo);
      if (fecha) fd.append('fecha_corte', fecha);
      fd.append('archivo', file!);
      return apiFetch<ImportResult>('/imports', { body: fd });
    },
    onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['imports'] }); },
  });
  const confirm = useMutation({ mutationFn: () => apiFetch<ImportResult>(`/imports/${result!.id}/confirm`, { method: 'POST' }), onSuccess: (r) => { setResult(r); qc.invalidateQueries({ queryKey: ['imports'] }); } });
  const template = async () => {
    const blob = await apiFetch<Blob>(`/imports/template/${tipo}`, { raw: true });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `plantilla_${tipo}.xlsx`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  return (
    <>
      <PageHeader title="Importación desde Excel" description="Las filas se validan con las mismas reglas del registro manual antes de cargarlas. Solo se cargan las válidas." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[340px_minmax(0,1fr)]">
        <Card>
          <CardContent className="space-y-3">
            <Field label="Tipo de datos">{(i) => <Select id={i} value={tipo} onChange={(e) => { setTipo(e.target.value as typeof tipo); setResult(null); }}><option value="productos">Productos</option><option value="terceros">Clientes y proveedores</option><option value="saldos">Saldos iniciales</option></Select>}</Field>
            {tipo === 'saldos' && <Field label="Fecha de corte">{(i) => <Input id={i} type="date" required value={fecha} onChange={(e) => setFecha(e.target.value)} />}</Field>}
            <Field label="Archivo .xlsx">{(i) => <Input id={i} type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />}</Field>
            <div className="flex gap-2">
              <Button variant="outline" onClick={template}><Download className="h-4 w-4" aria-hidden /> Plantilla</Button>
              <Button disabled={!file || (tipo === 'saldos' && !fecha)} loading={upload.isPending} onClick={() => upload.mutate()}><Upload className="h-4 w-4" aria-hidden /> Validar</Button>
            </div>
            {upload.error && <Alert tone="danger">{errorMessage(upload.error)}</Alert>}
          </CardContent>
        </Card>
        <div className="space-y-4">
          {result && (
            <Card>
              <CardHeader className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle>Resultado de la validación</CardTitle>
                <div className="flex items-center gap-2 text-sm">
                  <Badge tone="success">{result.filas_validas} válidas</Badge><Badge tone="danger">{result.filas_invalidas} con error</Badge>
                  {result.estado === 'cargada' ? <Badge tone="info">{result.filas_cargadas} cargadas</Badge> : <Button size="sm" disabled={result.filas_validas === 0} loading={confirm.isPending} onClick={() => confirm.mutate()}>Cargar filas válidas</Button>}
                </div>
              </CardHeader>
              {confirm.error && <Alert tone="danger" className="m-3">{errorMessage(confirm.error)}</Alert>}
              <Table>
                <thead><tr><Th>Fila</Th><Th>Datos</Th><Th>Error</Th></tr></thead>
                <tbody>
                  {result.filas.map((f, i) => (
                    <tr key={i} className={f.error_validacion ? 'bg-red-50' : ''}>
                      <Td>{String(f.fila_origen)}</Td>
                      <Td className="text-xs">{Object.entries(f).filter(([k, v]) => v != null && !['fila_origen', 'error_validacion', 'importacion_id'].includes(k)).map(([k, v]) => `${k}: ${v}`).join(' · ')}</Td>
                      <Td className="text-xs text-red-700">{String(f.error_validacion ?? '')}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Historial</CardTitle></CardHeader>
            <DataState loading={history.isLoading} error={history.error} empty={history.data?.data.length === 0}>
              <Table>
                <thead><tr><Th>Fecha</Th><Th>Tipo</Th><Th>Archivo</Th><Th>Estado</Th><Th className="text-right">Válidas / errores / cargadas</Th><Th>Usuario</Th></tr></thead>
                <tbody>{history.data?.data.map((h) => <tr key={h.id}><Td>{dateTime(h.creada_en)}</Td><Td>{h.tipo}</Td><Td>{h.nombre_archivo}</Td><Td>{h.estado}</Td><Td className="text-right">{h.filas_validas} / {h.filas_invalidas} / {h.filas_cargadas}</Td><Td>{h.usuario}</Td></tr>)}</tbody>
              </Table>
            </DataState>
          </Card>
        </div>
      </div>
    </>
  );
}
