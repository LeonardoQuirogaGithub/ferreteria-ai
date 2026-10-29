import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { ThirdPartyFormSchema } from '@/pages/DocumentsPages';
import { LoginPage } from '@/pages/LoginPage';
import { PaintFormSchema } from '@/pages/PaintQuotePage';
import { ProductFormSchema } from '@/pages/ProductFormPage';
import { mockApi, renderApp } from './utils';

describe('Validación de formularios', () => {
  it('login: muestra errores accesibles y el mensaje del servidor', async () => {
    mockApi({ 'POST /api/auth/login': () => ({ __status: 401, error: { code: 'NO_AUTENTICADO', message: 'Correo o contraseña incorrectos' } }) });
    renderApp(<Routes><Route path="/login" element={<LoginPage />} /></Routes>, { route: '/login' });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByText('Ingrese su correo')).toBeInTheDocument();
    expect(screen.getByLabelText('Correo')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Correo'), 'ana@ferreteria.test');
    await user.type(screen.getByLabelText('Contraseña'), 'mala');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Correo o contraseña incorrectos');
  });

  it('producto: rechaza porcentaje y stock mínimo negativos y decimales fuera de rango', () => {
    const base = { codigo_barras: '7700001', nombre: 'X', marca_id: 1, presentacion: 'Unidad', unidad_base_id: 1, decimales_permitidos: 0, controla_vencimiento: false, controla_garantia: false, porcentaje_incremento: 30, stock_minimo: 0, activo: true };
    expect(ProductFormSchema.safeParse(base).success).toBe(true);
    expect(ProductFormSchema.safeParse({ ...base, porcentaje_incremento: -1 }).success).toBe(false);
    expect(ProductFormSchema.safeParse({ ...base, stock_minimo: -5 }).success).toBe(false);
    expect(ProductFormSchema.safeParse({ ...base, decimales_permitidos: 6 }).success).toBe(false);
    expect(ProductFormSchema.safeParse({ ...base, codigo_barras: '!' }).success).toBe(false);
  });

  it('terceros: persona natural exige nombre y apellido; jurídica, razón social; al menos un rol', () => {
    const base = { tipo_persona: 'natural', tipo_documento: 'cedula', numero_documento: '1075', es_cliente: true, es_proveedor: false } as const;
    expect(ThirdPartyFormSchema.safeParse(base).success).toBe(false);
    expect(ThirdPartyFormSchema.safeParse({ ...base, nombre: 'Ana', apellido: 'Paz' }).success).toBe(true);
    expect(ThirdPartyFormSchema.safeParse({ ...base, tipo_persona: 'juridica' }).success).toBe(false);
    expect(ThirdPartyFormSchema.safeParse({ ...base, nombre: 'Ana', apellido: 'Paz', es_cliente: false }).success).toBe(false);
  });

  it('cotizador: medidas positivas y al menos paredes o techo', () => {
    const base = { espacios: [{ largo: 4, ancho: 3, alto: 2.5, cantidad: 1 }], aberturas: [], permitir_estimacion: false, incluir_paredes: true, incluir_techo: false, manos: 2, desperdicio_pct: 10, estado_superficie: 'buena', incluir_auxiliares: true };
    expect(PaintFormSchema.safeParse(base).success).toBe(true);
    expect(PaintFormSchema.safeParse({ ...base, espacios: [{ largo: -4, ancho: 3, alto: 2.5 }] }).success).toBe(false);
    expect(PaintFormSchema.safeParse({ ...base, incluir_paredes: false }).success).toBe(false);
    expect(PaintFormSchema.safeParse({ ...base, manos: 9 }).success).toBe(false);
  });
});

describe('Inicio de sesión exitoso', () => {
  it('redirige al usuario autenticado', async () => {
    mockApi({
      'POST /api/auth/login': () => ({ accessToken: 'a', refreshToken: 'r'.repeat(30), user: { id: 1, nombre: 'Ana', correo: 'ana@ferreteria.test', roles: ['Administrador'], permisos: ['inventario.consultar'] } }),
    });
    renderApp(<Routes><Route path="/login" element={<LoginPage />} /><Route path="/" element={<p>Inicio</p>} /></Routes>, { route: '/login' });
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText('Correo'), 'ana@ferreteria.test');
    await user.type(screen.getByLabelText('Contraseña'), 'ClaveSegura1');
    await user.click(screen.getByRole('button', { name: 'Ingresar' }));
    await waitFor(() => expect(screen.getByText('Inicio')).toBeInTheDocument());
  });
});
