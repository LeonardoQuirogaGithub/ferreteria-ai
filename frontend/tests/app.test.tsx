import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { DataState } from '@/components/common';
import { RequireAuth } from '@/features/auth/AuthContext';
import { QuoteEditor } from '@/features/quotations/QuoteEditor';
import { AppLayout } from '@/layouts/AppLayout';
import { ApiError } from '@/lib/api';
import { ChatPage } from '@/pages/ChatPage';
import { DashboardPage } from '@/pages/DashboardPage';
import type { PricedQuote } from '@/types';
import { makeUser, mockApi, renderApp } from './utils';

const VENTAS = ['inventario.consultar', 'venta.registrar', 'cotizacion.gestionar', 'ia.usar', 'tercero.gestionar'];

describe('Estados de carga y error', () => {
  it('DataState muestra carga, error y vacío', () => {
    const { rerender } = renderApp(<DataState loading error={null}><p>datos</p></DataState>);
    expect(screen.getByRole('status')).toHaveTextContent('Cargando');
    rerender(<DataState loading={false} error={new ApiError(503, { code: 'BD_NO_DISPONIBLE', message: 'La base de datos no está disponible' })}><p>datos</p></DataState>);
    expect(screen.getByRole('alert')).toHaveTextContent('La base de datos no está disponible');
    rerender(<DataState loading={false} error={null} empty><p>datos</p></DataState>);
    expect(screen.getByText('No hay resultados')).toBeInTheDocument();
  });

  it('el dashboard muestra los indicadores del backend y oculta los que no tiene permitidos', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ user: makeUser(VENTAS) }),
      'GET /api/reports/dashboard': () => ({
        periodo: { desde: '2026-10-01', hasta: '2026-10-28' }, productos_activos: 24, productos_agotados: 4, productos_bajo_minimo: 1,
        valor_inventario: null, compras_periodo: null, ventas_periodo: null, mas_vendidos: null, alertas_vencimiento: [], actividad_reciente: null,
      }),
    });
    renderApp(<DashboardPage />, { user: makeUser(VENTAS) });
    expect(await screen.findByText('24')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
    expect(screen.getAllByText('Sin permiso').length).toBe(3);
  });
});

describe('Restricción de pantallas por permisos', () => {
  it('el menú solo muestra lo permitido y una ruta sin permiso queda bloqueada', async () => {
    mockApi({ 'GET /api/auth/me': () => ({ user: makeUser(VENTAS) }) });
    renderApp(
      <Routes>
        <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
          <Route path="/auditoria" element={<RequireAuth permission="auditoria.consultar"><p>Auditoría secreta</p></RequireAuth>} />
        </Route>
      </Routes>,
      { user: makeUser(VENTAS), route: '/auditoria' },
    );
    expect(await screen.findByText('Acceso restringido')).toBeInTheDocument();
    expect(screen.queryByText('Auditoría secreta')).not.toBeInTheDocument();
    const nav = screen.getAllByRole('navigation', { name: 'Principal' })[0];
    expect(within(nav).getByText('Asistente IA')).toBeInTheDocument();
    expect(within(nav).queryByText('Usuarios y roles')).not.toBeInTheDocument();
    expect(within(nav).queryByText('Auditoría')).not.toBeInTheDocument();
  });

  it('sin sesión redirige al login', async () => {
    renderApp(<Routes><Route path="/" element={<RequireAuth><p>Privado</p></RequireAuth>} /><Route path="/login" element={<p>Pantalla de login</p>} /></Routes>);
    expect(await screen.findByText('Pantalla de login')).toBeInTheDocument();
  });
});

describe('Flujo del asistente', () => {
  it('envía la pregunta, muestra la respuesta verificada y las tarjetas de productos', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ({ user: makeUser(VENTAS) }),
      'GET /api/ai/status': () => ({ ollama: 'conectado', modelo_disponible: true, mensaje: 'listo' }),
      'POST /api/ai/chat': () => ({
        conversacion_id: '0b6f1c64-7c0e-4c51-9d0a-4b1b9c1f2a11',
        respuesta: 'Hay 1 producto agotado: Tubo PVC presión 1/2 pulgada.',
        artefactos: [{ tipo: 'alertas', datos: { titulo: 'Productos agotados', total: 1, productos: [{ producto_id: 22, nombre: 'Tubo PVC presión 1/2 pulgada', marca: 'Pavco', presentacion: 'Tubo 6 m', unidad_base: 'TUBO', disponible: '0.0000', reservada: '0', danada: '0', estado_stock: 'agotado', precio_vigente: '11700.00' }] } }],
        herramientas: [{ nombre: 'consultar_productos_agotados', ok: true, ms: 5 }],
        verificacion: { estado: 'verificada', cifras_sin_respaldo: [] },
        limite_alcanzado: false,
        modelo: 'qwen2.5:7b',
      }),
    });
    renderApp(<ChatPage />, { user: makeUser(VENTAS) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: '¿Qué productos están agotados?' }));
    expect(await screen.findByText(/Hay 1 producto agotado/)).toBeInTheDocument();
    expect(screen.getByText('Datos verificados en el sistema')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Ver detalle/ })).toHaveAttribute('href', '/productos/22');
    const body = calls.find((c) => c.url.includes('/ai/chat'))!.body as Record<string, unknown>;
    expect(body).toEqual({ mensaje: '¿Qué productos están agotados?' });
    expect(body).not.toHaveProperty('usuario_id');
  });

  it('muestra el error cuando Ollama no está disponible', async () => {
    mockApi({
      'GET /api/auth/me': () => ({ user: makeUser(VENTAS) }),
      'GET /api/ai/status': () => ({ ollama: 'no_disponible', modelo_disponible: false, mensaje: 'El servicio de IA local (Ollama) no está disponible.' }),
      'POST /api/ai/chat': () => ({ __status: 503, error: { code: 'IA_NO_DISPONIBLE', message: 'El servicio de IA local (Ollama) no está disponible.' } }),
    });
    renderApp(<ChatPage />, { user: makeUser(VENTAS) });
    expect(await screen.findByText('El asistente no está listo')).toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Escriba su pregunta'), 'hola{Enter}');
    expect(await screen.findAllByText(/no está disponible/)).not.toHaveLength(0);
  });
});

describe('Creación y edición de cotizaciones', () => {
  const quote: PricedQuote = {
    total: '167400.00', total_disponible: '167400.00', total_faltante: '0.00',
    lineas: [{ producto_id: 9, codigo_barras: '7701234500090', nombre: 'Pintura vinilo tipo 1 blanco', marca: 'Andina Pinturas', presentacion: 'Galón 3,785 L', unidad_id: 5, unidad_codigo: 'GALON', rol: 'pintura', cantidad_necesaria: '7.04', unidad_necesaria: 'L', cantidad: '2', cantidad_base: '2.0000', precio_unitario: '83700.00', subtotal: '167400.00', disponible: '12.0000', reservada: '0', danada: '0', disponibilidad: 'disponible', cantidad_disponible_inmediata: '2', subtotal_disponible: '167400.00' }],
  };

  it('editar una cantidad exige recalcular en el servidor y luego permite guardar con confirmación', async () => {
    const calls = mockApi({
      'GET /api/auth/me': () => ({ user: makeUser(VENTAS) }),
      'POST /api/quotations/calculate': () => ({ ...quote, total: '251100.00', total_disponible: '251100.00', lineas: [{ ...quote.lineas[0], cantidad: '3', subtotal: '251100.00' }] }),
      'GET /api/third-parties': () => ({ data: [], meta: { page: 1, pageSize: 200, total: 0, totalPages: 0 } }),
      'POST /api/quotations': () => ({ __status: 201, id: 7, numero: 'COT-000007' }),
    });
    renderApp(<Routes><Route path="/" element={<QuoteEditor initial={quote} tipo="pintura" descripcion="Habitación" />} /><Route path="/cotizaciones/:id" element={<p>Detalle guardado</p>} /></Routes>, { user: makeUser(VENTAS) });
    const user = userEvent.setup();
    const cantidad = await screen.findByLabelText('Cantidad de Pintura vinilo tipo 1 blanco');
    await user.clear(cantidad);
    await user.type(cantidad, '3');
    expect(screen.getByText(/Hay cambios sin valorar/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Guardar cotización/ })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: /Recalcular/ }));
    await waitFor(() => expect(screen.getAllByText(/251\.100/).length).toBeGreaterThan(0));
    expect(calls.find((c) => c.url.includes('/quotations/calculate'))!.body).toEqual({ items: [expect.objectContaining({ producto_id: 9, cantidad: 3 })] });

    await user.click(screen.getByRole('button', { name: /Guardar cotización/ }));
    await user.click(await screen.findByRole('button', { name: 'Confirmar y guardar' }));
    await waitFor(() => expect(screen.getByText('Detalle guardado')).toBeInTheDocument());
    const saved = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/quotations'))!.body as { lineas: { precio_unitario_esperado: number }[] };
    // El cliente envía el precio que vio para que el servidor detecte cambios; no fija importes.
    expect(saved.lineas[0]).toMatchObject({ producto_id: 9, cantidad: 3, precio_unitario_esperado: 83700 });
  });

  it('quitar un producto lo elimina de la tabla', async () => {
    mockApi({ 'GET /api/auth/me': () => ({ user: makeUser(VENTAS) }) });
    renderApp(<QuoteEditor initial={quote} tipo="pintura" />, { user: makeUser(VENTAS) });
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Quitar Pintura vinilo tipo 1 blanco' }));
    expect(screen.queryByLabelText('Cantidad de Pintura vinilo tipo 1 blanco')).not.toBeInTheDocument();
  });
});
