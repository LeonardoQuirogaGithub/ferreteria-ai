import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { DataState, PageHeader } from '@/components/common';
import { Alert, Badge, Button, Card, CardContent, CardHeader, CardTitle, Table, Td, Th } from '@/components/ui';
import { apiFetch } from '@/lib/api';

interface Status {
  ollama: 'conectado' | 'no_disponible';
  modelo_configurado: string;
  modelo_disponible: boolean;
  mensaje: string;
  timeout_ms: number;
  max_iteraciones: number;
  herramientas_disponibles: string[];
  ollama_url?: string;
}

export function AiStatusPage() {
  const st = useQuery({ queryKey: ['ai-status'], queryFn: () => apiFetch<Status>('/ai/status') });
  const models = useQuery({
    queryKey: ['ai-models'],
    queryFn: () => apiFetch<{ data: { name: string; size?: number; modified_at?: string }[] }>('/ai/models'),
    enabled: st.data?.ollama === 'conectado',
  });
  const s = st.data;
  return (
    <>
      <PageHeader
        title="Configuración y estado de Ollama"
        description="El modelo corre localmente y solo el backend se comunica con él. La configuración se cambia en el archivo .env del backend."
        actions={<Button variant="outline" onClick={() => { st.refetch(); models.refetch(); }} loading={st.isFetching}><RefreshCw className="h-4 w-4" aria-hidden /> Comprobar</Button>}
      />
      <DataState loading={st.isLoading} error={st.error}>
        {s && (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Card>
              <CardHeader><CardTitle>Conectividad</CardTitle></CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p>Servicio Ollama: <Badge tone={s.ollama === 'conectado' ? 'success' : 'danger'}>{s.ollama === 'conectado' ? 'Conectado' : 'No disponible'}</Badge></p>
                <p>Modelo configurado (OLLAMA_MODEL): <code className="rounded bg-slate-100 px-1">{s.modelo_configurado}</code> <Badge tone={s.modelo_disponible ? 'success' : 'warning'}>{s.modelo_disponible ? 'Instalado' : 'No instalado'}</Badge></p>
                {s.ollama_url && <p>URL (solo administradores): <code className="rounded bg-slate-100 px-1">{s.ollama_url}</code></p>}
                <p>Tiempo máximo por llamada: {s.timeout_ms / 1000} s · iteraciones máximas: {s.max_iteraciones}</p>
                <Alert tone={s.modelo_disponible ? 'success' : 'warning'}>{s.mensaje}</Alert>
                {!s.modelo_disponible && (
                  <div className="rounded-md bg-slate-900 p-3 font-mono text-xs text-slate-100">
                    <p># Instalar Ollama: https://ollama.com/download</p>
                    <p>ollama serve</p>
                    <p>ollama pull {s.modelo_configurado}</p>
                  </div>
                )}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Herramientas habilitadas para su rol</CardTitle></CardHeader>
              <CardContent><ul className="list-disc pl-5 text-sm">{s.herramientas_disponibles.map((h) => <li key={h}><code>{h}</code></li>)}</ul></CardContent>
            </Card>
            {s.ollama === 'conectado' && (
              <Card className="lg:col-span-2">
                <CardHeader><CardTitle>Modelos instalados</CardTitle></CardHeader>
                <DataState loading={models.isLoading} error={models.error} empty={models.data?.data.length === 0}>
                  <Table>
                    <thead><tr><Th>Modelo</Th><Th className="text-right">Tamaño</Th><Th>Modificado</Th></tr></thead>
                    <tbody>{models.data?.data.map((m) => <tr key={m.name}><Td>{m.name}</Td><Td className="text-right">{m.size ? `${(m.size / 1e9).toFixed(1)} GB` : '—'}</Td><Td>{m.modified_at?.slice(0, 10) ?? '—'}</Td></tr>)}</tbody>
                  </Table>
                </DataState>
              </Card>
            )}
          </div>
        )}
      </DataState>
    </>
  );
}
