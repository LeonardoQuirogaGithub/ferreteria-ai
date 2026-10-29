import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { useNavigate, useParams } from 'react-router-dom';
import { z } from 'zod';
import { PageHeader } from '@/components/common';
import { Alert, Button, Card, CardContent, Field, Input, Select, Textarea } from '@/components/ui';
import { apiFetch, errorMessage } from '@/lib/api';
import type { ProductDetail } from '@/types';
import { useCatalogs } from './ProductsPage';

const num = (msg: string) => z.coerce.number({ invalid_type_error: msg });
export const ProductFormSchema = z.object({
  codigo_barras: z.string().trim().regex(/^[0-9A-Za-z-]{3,50}$/, 'Código de 3 a 50 caracteres (letras, números o guion)'),
  nombre: z.string().trim().min(1, 'El nombre es obligatorio').max(150),
  descripcion: z.string().max(2000).optional(),
  marca_id: num('Seleccione la marca').int().positive('Seleccione la marca'),
  presentacion: z.string().trim().min(1, 'La presentación es obligatoria').max(100),
  categoria_id: z.union([z.literal(''), z.coerce.number().int().positive()]).optional(),
  unidad_base_id: num('Seleccione la unidad').int().positive('Seleccione la unidad'),
  decimales_permitidos: num('Indique los decimales').int().min(0, 'Entre 0 y 4').max(4, 'Entre 0 y 4'),
  controla_vencimiento: z.boolean(),
  controla_garantia: z.boolean(),
  porcentaje_incremento: num('Indique el porcentaje').min(0, 'No puede ser negativo'),
  stock_minimo: num('Indique el stock mínimo').min(0, 'No puede ser negativo'),
  activo: z.boolean(),
});
type FormValues = z.infer<typeof ProductFormSchema>;

export function ProductFormPage() {
  const { id } = useParams();
  const editing = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { brands, categories, units } = useCatalogs();
  const existing = useQuery({ queryKey: ['product', id], queryFn: () => apiFetch<ProductDetail>(`/products/${id}`), enabled: editing });
  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormValues>({
    resolver: zodResolver(ProductFormSchema),
    defaultValues: { decimales_permitidos: 0, controla_vencimiento: false, controla_garantia: false, porcentaje_incremento: 30, stock_minimo: 0, activo: true },
  });

  useEffect(() => {
    const p = existing.data;
    if (p) reset({ ...p, descripcion: p.descripcion ?? '', categoria_id: p.categoria_id ?? '', porcentaje_incremento: Number(p.porcentaje_incremento), stock_minimo: Number(p.stock_minimo) });
  }, [existing.data, reset]);

  const save = useMutation({
    mutationFn: (v: FormValues) => {
      const body = { ...v, categoria_id: v.categoria_id === '' ? null : v.categoria_id, descripcion: v.descripcion || null };
      return apiFetch<ProductDetail>(editing ? `/products/${id}` : '/products', { method: editing ? 'PATCH' : 'POST', body });
    },
    onSuccess: (p) => {
      qc.invalidateQueries({ queryKey: ['products'] });
      qc.invalidateQueries({ queryKey: ['product', String(p.id)] });
      navigate(`/productos/${p.id}`);
    },
  });

  const err = (k: keyof FormValues) => errors[k]?.message as string | undefined;
  return (
    <>
      <PageHeader title={editing ? 'Editar producto' : 'Nuevo producto'} description="RF-PRO-001: código de barras único, marca, presentación, unidad base, incremento y stock mínimo." />
      <Card>
        <CardContent>
          <form className="grid gap-4 md:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate(v))} noValidate>
            <Field label="Código de barras" error={err('codigo_barras')}>{(i, d) => <Input id={i} aria-describedby={d} aria-invalid={!!errors.codigo_barras} {...register('codigo_barras')} />}</Field>
            <Field label="Nombre" error={err('nombre')}>{(i, d) => <Input id={i} aria-describedby={d} aria-invalid={!!errors.nombre} {...register('nombre')} />}</Field>
            <Field label="Marca" error={err('marca_id')}>{(i, d) => <Select id={i} aria-describedby={d} {...register('marca_id')}><option value="">Seleccione</option>{brands.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}</Select>}</Field>
            <Field label="Presentación" error={err('presentacion')}>{(i, d) => <Input id={i} aria-describedby={d} placeholder="Ej.: Galón 3,785 L" {...register('presentacion')} />}</Field>
            <Field label="Categoría">{(i) => <Select id={i} {...register('categoria_id')}><option value="">Sin categoría</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.categoria_padre ? `${c.categoria_padre} › ` : ''}{c.nombre}</option>)}</Select>}</Field>
            <Field label="Unidad base" error={err('unidad_base_id')}>{(i, d) => <Select id={i} aria-describedby={d} {...register('unidad_base_id')}><option value="">Seleccione</option>{units.map((u) => <option key={u.id} value={u.id}>{u.nombre} ({u.codigo})</option>)}</Select>}</Field>
            <Field label="Decimales permitidos (0 a 4)" error={err('decimales_permitidos')}>{(i, d) => <Input id={i} type="number" aria-describedby={d} {...register('decimales_permitidos')} />}</Field>
            <Field label="Porcentaje de incremento (%)" error={err('porcentaje_incremento')}>{(i, d) => <Input id={i} type="number" step="any" aria-describedby={d} aria-invalid={!!errors.porcentaje_incremento} {...register('porcentaje_incremento')} />}</Field>
            <Field label="Stock mínimo" error={err('stock_minimo')}>{(i, d) => <Input id={i} type="number" step="any" aria-describedby={d} aria-invalid={!!errors.stock_minimo} {...register('stock_minimo')} />}</Field>
            <fieldset className="space-y-2 text-sm">
              <legend className="font-medium text-slate-700">Controles</legend>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('controla_vencimiento')} /> Controla vencimiento</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('controla_garantia')} /> Controla garantía</label>
              <label className="flex items-center gap-2"><input type="checkbox" {...register('activo')} /> Activo (los productos se desactivan, no se eliminan)</label>
            </fieldset>
            <Field label="Descripción" className="md:col-span-2">{(i) => <Textarea id={i} {...register('descripcion')} />}</Field>
            {save.error && <Alert tone="danger" className="md:col-span-2">{errorMessage(save.error)}</Alert>}
            <div className="flex justify-end gap-2 md:col-span-2">
              <Button type="button" variant="outline" onClick={() => navigate(-1)}>Cancelar</Button>
              <Button type="submit" loading={save.isPending}>Guardar</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
