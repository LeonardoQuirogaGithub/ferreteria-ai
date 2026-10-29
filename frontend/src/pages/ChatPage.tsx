import { useMutation, useQuery } from '@tanstack/react-query';
import { Bot, MessageSquarePlus, Send, ShieldCheck, Square, TriangleAlert, User as UserIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { PageHeader } from '@/components/common';
import { Alert, Badge, Button, Card, Textarea } from '@/components/ui';
import { ArtifactView } from '@/features/chat/ArtifactView';
import { apiFetch, errorMessage } from '@/lib/api';
import { cn } from '@/lib/format';
import type { ChatResponse } from '@/types';

export const SUGERENCIAS = [
  '¿Qué productos están agotados?',
  '¿Qué materiales debo reponer?',
  '¿Cuánto cemento tenemos disponible?',
  'Cotiza los materiales para pintar una habitación de 4 × 3 metros.',
  'Muéstrame los productos con menos de 5 unidades disponibles.',
];

interface Msg {
  id: number;
  rol: 'user' | 'assistant';
  texto: string;
  respuesta?: ChatResponse;
  error?: boolean;
}

const VERIF: Record<ChatResponse['verificacion']['estado'], { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  verificada: { tone: 'success', label: 'Datos verificados en el sistema' },
  sin_herramientas: { tone: 'neutral', label: 'Sin consulta a datos' },
  con_advertencias: { tone: 'warning', label: 'Revise las cifras' },
  fallo_herramienta: { tone: 'danger', label: 'No se pudo verificar' },
};

export function ChatPage() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState('');
  const [conversacionId, setConversacionId] = useState<string>();
  const abortRef = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const status = useQuery({ queryKey: ['ai-status'], queryFn: () => apiFetch<{ ollama: string; modelo_disponible: boolean; mensaje: string }>('/ai/status'), staleTime: 30_000 });

  const send = useMutation({
    mutationFn: async (mensaje: string) => {
      abortRef.current = new AbortController();
      return apiFetch<ChatResponse>('/ai/chat', { body: { mensaje, conversacion_id: conversacionId }, signal: abortRef.current.signal });
    },
    onSuccess: (r) => {
      setConversacionId(r.conversacion_id);
      setMsgs((m) => [...m, { id: Date.now(), rol: 'assistant', texto: r.respuesta, respuesta: r }]);
    },
    onError: (e) => setMsgs((m) => [...m, { id: Date.now(), rol: 'assistant', texto: errorMessage(e), error: true }]),
  });

  // Con llaves: en Chrome scrollIntoView puede devolver una Promise y un efecto solo puede devolver su limpieza.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth' });
  }, [msgs, send.isPending]);

  const submit = (mensaje: string) => {
    const m = mensaje.trim();
    if (!m || send.isPending) return;
    setMsgs((x) => [...x, { id: Date.now(), rol: 'user', texto: m }]);
    setText('');
    send.mutate(m);
  };

  const nueva = () => {
    abortRef.current?.abort();
    setMsgs([]);
    setConversacionId(undefined);
  };

  return (
    <>
      <PageHeader
        title="Asistente de inventario"
        description="Consulta existencias, precios y materiales con datos reales. El asistente no modifica inventario ni precios."
        actions={<Button variant="outline" onClick={nueva}><MessageSquarePlus className="h-4 w-4" aria-hidden /> Nueva conversación</Button>}
      />
      {status.data && (!status.data.modelo_disponible) && (
        <Alert tone="warning" className="mb-4" title="El asistente no está listo">
          {status.data.mensaje} <Link to="/ia-estado" className="underline">Ver estado</Link>
        </Alert>
      )}
      <Card className="flex h-[calc(100vh-15rem)] min-h-[420px] flex-col">
        <div className="flex-1 space-y-4 overflow-y-auto p-4" aria-live="polite" aria-busy={send.isPending}>
          {msgs.length === 0 && (
            <div className="mx-auto max-w-xl space-y-3 py-6 text-center">
              <Bot className="mx-auto h-10 w-10 text-brand-600" aria-hidden />
              <p className="text-sm text-slate-600">Pruebe con alguna de estas preguntas:</p>
              <div className="flex flex-wrap justify-center gap-2">
                {SUGERENCIAS.map((s) => <Button key={s} variant="outline" size="sm" onClick={() => submit(s)}>{s}</Button>)}
              </div>
            </div>
          )}
          {msgs.map((m) => (
            <div key={m.id} className={cn('flex gap-3', m.rol === 'user' && 'flex-row-reverse')}>
              <div className={cn('mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full', m.rol === 'user' ? 'bg-slate-200' : 'bg-brand-100 text-brand-700')}>
                {m.rol === 'user' ? <UserIcon className="h-4 w-4" aria-hidden /> : <Bot className="h-4 w-4" aria-hidden />}
              </div>
              <div className={cn('max-w-[85%] space-y-2', m.rol === 'user' && 'text-right')}>
                <div className={cn('inline-block whitespace-pre-wrap rounded-lg px-3 py-2 text-left text-sm', m.rol === 'user' ? 'bg-brand-600 text-white' : m.error ? 'bg-red-50 text-red-900' : 'bg-slate-100')}>
                  <span className="sr-only">{m.rol === 'user' ? 'Usted:' : 'Asistente:'}</span>
                  {m.error && <TriangleAlert className="mr-1 inline h-4 w-4" aria-hidden />}
                  {m.texto}
                </div>
                {m.respuesta && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <Badge tone={VERIF[m.respuesta.verificacion.estado].tone}><ShieldCheck className="mr-1 h-3 w-3" aria-hidden />{VERIF[m.respuesta.verificacion.estado].label}</Badge>
                      {m.respuesta.herramientas.length > 0 && <span>Consultas: {m.respuesta.herramientas.map((h) => `${h.nombre}${h.ok ? '' : ' (falló)'}`).join(', ')}</span>}
                    </div>
                    {m.respuesta.artefactos.map((a, i) => <ArtifactView key={i} artifact={a} />)}
                  </>
                )}
              </div>
            </div>
          ))}
          {send.isPending && (
            <div role="status" className="flex items-center gap-3 text-sm text-slate-500">
              <Bot className="h-4 w-4 animate-pulse" aria-hidden /> Consultando el inventario…
              <Button variant="ghost" size="sm" onClick={() => abortRef.current?.abort()}><Square className="h-3 w-3" aria-hidden /> Cancelar</Button>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <form className="flex gap-2 border-t p-3" onSubmit={(e) => { e.preventDefault(); submit(text); }}>
          <label htmlFor="chat-input" className="sr-only">Escriba su pregunta</label>
          <Textarea
            id="chat-input"
            value={text}
            maxLength={2000}
            rows={1}
            className="min-h-[44px] resize-none"
            placeholder="Escriba su pregunta… (Enter para enviar)"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(text); } }}
          />
          <Button type="submit" disabled={!text.trim() || send.isPending} aria-label="Enviar"><Send className="h-4 w-4" aria-hidden /></Button>
        </form>
      </Card>
    </>
  );
}
