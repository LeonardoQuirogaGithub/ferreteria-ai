import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { Calculator, Plus, Trash2 } from 'lucide-react';
import { useEffect } from 'react';
import { useFieldArray, useForm } from 'react-hook-form';
import { useLocation } from 'react-router-dom';
import { z } from 'zod';
import { PageHeader } from '@/components/common';
import { Alert, Button, Card, CardContent, CardHeader, CardTitle, Field, Input, Select } from '@/components/ui';
import { QuoteEditor } from '@/features/quotations/QuoteEditor';
import { apiFetch, errorMessage } from '@/lib/api';
import { date, money } from '@/lib/format';
import type { PaintResult, PricedQuote } from '@/types';

const optNum = z.preprocess((v) => (v === '' || v == null || Number.isNaN(v) ? undefined : Number(v)), z.number().positive('Debe ser mayor que cero').optional());
const reqNum = z.coerce.number({ invalid_type_error: 'Requerido' }).positive('Debe ser mayor que cero');

export const PaintFormSchema = z
  .object({
    descripcion_proyecto: z.string().max(500).optional(),
    espacios: z.array(z.object({ nombre: z.string().max(60).optional(), largo: reqNum, ancho: reqNum, alto: reqNum, cantidad: z.coerce.number().int().min(1).default(1) })),
    area_paredes_m2: optNum,
    area_techo_m2: optNum,
    area_construccion_m2: optNum,
    permitir_estimacion: z.boolean(),
    incluir_paredes: z.boolean(),
    incluir_techo: z.boolean(),
    aberturas: z.array(z.object({ tipo: z.enum(['puerta', 'ventana', 'otro']), ancho: reqNum, alto: reqNum, cantidad: z.coerce.number().int().min(1).default(1) })),
    manos: z.coerce.number().int().min(1, 'Entre 1 y 5').max(5, 'Entre 1 y 5'),
    desperdicio_pct: z.coerce.number().min(0, 'Entre 0 y 50').max(50, 'Entre 0 y 50'),
    estado_superficie: z.enum(['nueva', 'buena', 'regular', 'deteriorada']),
    rendimiento_m2_por_litro: optNum,
    incluir_auxiliares: z.boolean(),
  })
  .refine((v) => v.incluir_paredes || v.incluir_techo, { message: 'Incluya paredes, techo o ambos', path: ['incluir_paredes'] });
type FormValues = z.infer<typeof PaintFormSchema>;

const DEFAULTS: FormValues = {
  descripcion_proyecto: '',
  espacios: [{ nombre: 'Habitación 1', largo: 4, ancho: 3, alto: 2.4, cantidad: 1 }],
  aberturas: [{ tipo: 'puerta', ancho: 0.9, alto: 2, cantidad: 1 }],
  permitir_estimacion: false,
  incluir_paredes: true,
  incluir_techo: false,
  manos: 2,
  desperdicio_pct: 10,
  estado_superficie: 'buena',
  incluir_auxiliares: true,
};

export function PaintQuotePage() {
  const location = useLocation();
  const state = location.state as { parametros?: Partial<FormValues>; borrador?: PricedQuote & { descripcion_proyecto: string; tipo: 'general' | 'pintura' } } | null;
  const { register, control, handleSubmit, formState: { errors }, reset, watch } = useForm<FormValues>({ resolver: zodResolver(PaintFormSchema), defaultValues: DEFAULTS });
  const espacios = useFieldArray({ control, name: 'espacios' });
  const aberturas = useFieldArray({ control, name: 'aberturas' });
  const calc = useMutation({ mutationFn: (body: unknown) => apiFetch<PaintResult>('/quotations/paint/calculate', { body }) });

  useEffect(() => {
    if (state?.parametros) {
      reset({ ...DEFAULTS, espacios: [], aberturas: [], ...state.parametros } as FormValues);
      calc.mutate(state.parametros);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.parametros]);

  const onSubmit = handleSubmit((v) => {
    const body = { ...v, espacios: v.espacios.length ? v.espacios : undefined, aberturas: v.aberturas.length ? v.aberturas : undefined };
    calc.mutate(body);
  });
  const r = calc.data;
  const sinEspacios = watch('espacios').length === 0;

  if (state?.borrador) {
    const b = state.borrador;
    return (
      <>
        <PageHeader title="Revisar cotización del asistente" description={b.descripcion_proyecto} />
        <QuoteEditor initial={b} tipo={b.tipo} descripcion={b.descripcion_proyecto} supuestos={['Cotización preparada desde el asistente']} />
      </>
    );
  }

  return (
    <>
      <PageHeader title="Cotizador de pintura" description="El backend calcula el área neta, los litros y las presentaciones con fichas técnicas, precios y existencias reales." />
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[420px_minmax(0,1fr)]">
        <Card>
          <CardHeader><CardTitle>Parámetros del proyecto</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <Field label="Descripción">{(i) => <Input id={i} placeholder="Ej.: Pintar apartamento" {...register('descripcion_proyecto')} />}</Field>
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Espacios (largo × ancho × alto en metros)</legend>
                {espacios.fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[repeat(4,minmax(0,1fr))_36px] items-end gap-1 sm:grid-cols-[minmax(0,2fr)_repeat(4,minmax(0,1fr))_36px]">
                    <Input className="col-span-5 sm:col-span-1" aria-label={`Nombre del espacio ${i + 1}`} placeholder="Nombre" {...register(`espacios.${i}.nombre`)} />
                    <Input aria-label="Largo" type="number" step="any" aria-invalid={!!errors.espacios?.[i]?.largo} {...register(`espacios.${i}.largo`)} />
                    <Input aria-label="Ancho" type="number" step="any" aria-invalid={!!errors.espacios?.[i]?.ancho} {...register(`espacios.${i}.ancho`)} />
                    <Input aria-label="Alto" type="number" step="any" aria-invalid={!!errors.espacios?.[i]?.alto} {...register(`espacios.${i}.alto`)} />
                    <Input aria-label="Cantidad de espacios iguales" type="number" {...register(`espacios.${i}.cantidad`)} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Quitar espacio ${i + 1}`} onClick={() => espacios.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                {errors.espacios && <p role="alert" className="text-xs text-red-600">Revise las medidas: deben ser mayores que cero.</p>}
                <Button type="button" variant="outline" size="sm" onClick={() => espacios.append({ nombre: `Habitación ${espacios.fields.length + 1}`, largo: 3, ancho: 3, alto: 2.4, cantidad: 1 })}><Plus className="h-4 w-4" aria-hidden /> Espacio</Button>
              </fieldset>
              {sinEspacios && (
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Área de muros (m²)">{(i) => <Input id={i} type="number" step="any" {...register('area_paredes_m2')} />}</Field>
                  <Field label="Área de techos (m²)">{(i) => <Input id={i} type="number" step="any" {...register('area_techo_m2')} />}</Field>
                  <Field label="Área construida (m²)" hint="No equivale al área a pintar" className="col-span-2">{(i, d) => <Input id={i} type="number" step="any" aria-describedby={d} {...register('area_construccion_m2')} />}</Field>
                  <label className="col-span-2 flex items-center gap-2 text-sm"><input type="checkbox" {...register('permitir_estimacion')} /> Autorizo estimar los muros con supuestos explícitos</label>
                </div>
              )}
              <fieldset className="space-y-2">
                <legend className="text-sm font-medium">Puertas y ventanas que no se pintan</legend>
                {aberturas.fields.map((f, i) => (
                  <div key={f.id} className="grid grid-cols-[repeat(3,minmax(0,1fr))_36px] items-end gap-1 sm:grid-cols-[minmax(0,2fr)_repeat(3,minmax(0,1fr))_36px]">
                    <Select className="col-span-4 sm:col-span-1" aria-label="Tipo de abertura" {...register(`aberturas.${i}.tipo`)}><option value="puerta">Puerta</option><option value="ventana">Ventana</option><option value="otro">Otro</option></Select>
                    <Input aria-label="Ancho" type="number" step="any" {...register(`aberturas.${i}.ancho`)} />
                    <Input aria-label="Alto" type="number" step="any" {...register(`aberturas.${i}.alto`)} />
                    <Input aria-label="Cantidad" type="number" {...register(`aberturas.${i}.cantidad`)} />
                    <Button type="button" variant="ghost" size="icon" aria-label={`Quitar abertura ${i + 1}`} onClick={() => aberturas.remove(i)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => aberturas.append({ tipo: 'ventana', ancho: 1.2, alto: 1, cantidad: 1 })}><Plus className="h-4 w-4" aria-hidden /> Abertura</Button>
              </fieldset>
              <div className="flex gap-4 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" {...register('incluir_paredes')} /> Paredes</label>
                <label className="flex items-center gap-2"><input type="checkbox" {...register('incluir_techo')} /> Techos</label>
                <label className="flex items-center gap-2"><input type="checkbox" {...register('incluir_auxiliares')} /> Materiales auxiliares</label>
              </div>
              {errors.incluir_paredes && <p role="alert" className="text-xs text-red-600">{errors.incluir_paredes.message}</p>}
              <div className="grid grid-cols-2 gap-2">
                <Field label="Manos" error={errors.manos?.message}>{(i, d) => <Input id={i} type="number" aria-describedby={d} {...register('manos')} />}</Field>
                <Field label="Desperdicio (%)" error={errors.desperdicio_pct?.message}>{(i, d) => <Input id={i} type="number" step="any" aria-describedby={d} {...register('desperdicio_pct')} />}</Field>
                <Field label="Estado de la superficie">{(i) => <Select id={i} {...register('estado_superficie')}><option value="nueva">Nueva (requiere sellador)</option><option value="buena">Buena</option><option value="regular">Regular (lijar)</option><option value="deteriorada">Deteriorada (resanar)</option></Select>}</Field>
                <Field label="Rendimiento (m²/L)" hint="Solo si conoce el dato">{(i, d) => <Input id={i} type="number" step="any" aria-describedby={d} {...register('rendimiento_m2_por_litro')} />}</Field>
              </div>
              <Button type="submit" className="w-full" loading={calc.isPending}><Calculator className="h-4 w-4" aria-hidden /> Calcular materiales</Button>
            </form>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {calc.error && <Alert tone="danger">{errorMessage(calc.error)}</Alert>}
          {!r && !calc.isPending && <Alert tone="info">Indique las medidas y pulse «Calcular materiales». Nada se guarda hasta que confirme la cotización.</Alert>}
          {r?.estado === 'faltan_datos' && (
            <Alert tone="warning" title="Faltan datos para un resultado definitivo">
              <ul className="list-disc pl-4">{r.faltantes?.map((f) => <li key={f}>{f}</li>)}</ul>
            </Alert>
          )}
          {r?.estado === 'calculado' && r.areas && (
            <>
              <Card>
                <CardHeader><CardTitle>Resumen del cálculo</CardTitle></CardHeader>
                <CardContent className="grid gap-4 text-sm md:grid-cols-2">
                  <dl className="grid grid-cols-2 gap-1">
                    <dt className="text-slate-500">Paredes (bruto)</dt><dd>{r.areas.area_paredes_bruta} m²</dd>
                    <dt className="text-slate-500">Puertas y ventanas</dt><dd>− {r.areas.area_aberturas} m²</dd>
                    <dt className="text-slate-500">Techos</dt><dd>{r.areas.area_techo} m²</dd>
                    <dt className="font-medium">Área neta</dt><dd className="font-bold">{r.areas.area_neta_total} m²</dd>
                    <dt className="text-slate-500">Manos / desperdicio</dt><dd>{r.manos} / {r.desperdicio_pct} %</dd>
                    <dt className="text-slate-500">Fecha / vigencia</dt><dd>{date(r.calculado_en)} · {r.vigencia_dias} días</dd>
                  </dl>
                  <div className="space-y-1">
                    {r.pintura?.map((p) => (
                      <p key={p.superficie}><strong>{p.superficie}:</strong> {p.litros_necesarios} L de {p.linea} ({p.rendimiento_m2_por_litro} m²/L · {p.fuente_rendimiento})</p>
                    ))}
                    <p>Total estimado del proyecto: <strong>{money(r.total)}</strong></p>
                  </div>
                </CardContent>
              </Card>
              {!!r.advertencias?.length && (
                <Alert tone="warning" title="Advertencias técnicas y de disponibilidad"><ul className="list-disc pl-4">{r.advertencias.map((a) => <li key={a}>{a}</li>)}</ul></Alert>
              )}
              {!!r.pendientes?.length && (
                <Alert tone="info" title="Materiales pendientes (no suman al total)"><ul className="list-disc pl-4">{r.pendientes.map((p) => <li key={p.tipo + p.motivo}>{p.tipo}: {p.motivo}</li>)}</ul></Alert>
              )}
              <QuoteEditor
                initial={r}
                tipo="pintura"
                descripcion={r.descripcion_proyecto}
                parametros={r.parametros}
                supuestos={r.supuestos}
                advertencias={r.advertencias}
                area={r.areas.area_neta_total}
                manos={r.manos}
              />
              {!!r.alternativas?.length && (
                <Card>
                  <CardHeader><CardTitle>Alternativas compatibles del catálogo</CardTitle></CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    {r.alternativas.map((a) => (
                      <div key={a.para}>
                        <p className="font-medium">{a.para}</p>
                        <ul className="list-disc pl-5 text-slate-600">
                          {a.opciones.map((o, i) => (
                            <li key={i}>{String(o.linea ?? o.nombre)}{o.costo_estimado ? ` · ${money(o.costo_estimado as string)}` : o.precio_vigente ? ` · ${money(o.precio_vigente as string)}` : ''}{o.existencia_suficiente === false ? ' · sin existencia suficiente' : ''}</li>
                          ))}
                        </ul>
                      </div>
                    ))}
                    <p className="text-xs text-slate-500">Use el buscador de la tabla para sustituir un producto y pulse «Recalcular».</p>
                  </CardContent>
                </Card>
              )}
              <Card>
                <CardHeader><CardTitle>Supuestos utilizados</CardTitle></CardHeader>
                <CardContent><ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">{r.supuestos?.map((s) => <li key={s}>{s}</li>)}</ul></CardContent>
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
