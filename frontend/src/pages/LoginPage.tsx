import { zodResolver } from '@hookform/resolvers/zod';
import { Receipt } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { Alert, Button, Card, CardContent, Field, Input } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { errorMessage } from '@/lib/api';

const Schema = z.object({
  correo: z.string().trim().min(1, 'Ingrese su correo').email('Correo inválido'),
  contrasena: z.string().min(1, 'Ingrese su contraseña'),
});
type FormValues = z.infer<typeof Schema>;

export function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const { register, handleSubmit, formState, setError } = useForm<FormValues>({ resolver: zodResolver(Schema) });

  if (user) return <Navigate to="/" replace />;

  const onSubmit = handleSubmit(async (v) => {
    try {
      await login(v.correo, v.contrasena);
      navigate((location.state as { from?: string } | null)?.from ?? '/', { replace: true });
    } catch (e) {
      setError('root', { message: errorMessage(e) });
    }
  });

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-100 to-brand-50 p-4">
      <Card className="w-full max-w-sm">
        <CardContent className="space-y-6 p-6">
          <div className="text-center">
            <Receipt className="mx-auto h-10 w-10 text-brand-600" aria-hidden />
            <h1 className="mt-2 text-xl font-bold">Inventario de ferretería</h1>
            <p className="text-sm text-slate-500">Inicie sesión para continuar</p>
          </div>
          <form onSubmit={onSubmit} className="space-y-4" noValidate>
            <Field label="Correo" error={formState.errors.correo?.message}>
              {(id, d) => <Input id={id} type="email" autoComplete="username" aria-invalid={!!formState.errors.correo} aria-describedby={d} {...register('correo')} />}
            </Field>
            <Field label="Contraseña" error={formState.errors.contrasena?.message}>
              {(id, d) => <Input id={id} type="password" autoComplete="current-password" aria-invalid={!!formState.errors.contrasena} aria-describedby={d} {...register('contrasena')} />}
            </Field>
            {formState.errors.root && <Alert tone="danger">{formState.errors.root.message}</Alert>}
            <Button type="submit" className="w-full" loading={formState.isSubmitting}>Ingresar</Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
