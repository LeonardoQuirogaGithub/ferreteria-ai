import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AuthProvider } from '@/features/auth/AuthContext';
import { sessionStore } from '@/lib/api';
import type { User } from '@/types';

type Handler = (url: string, init?: RequestInit) => unknown | Promise<unknown>;

/** Simula el backend: cada ruta "MÉTODO /api/..." responde con JSON o con { __status, error }. */
export function mockApi(routes: Record<string, Handler>) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const path = url.split('?')[0];
    calls.push({ url, method, body: init?.body && typeof init.body === 'string' ? JSON.parse(init.body) : init?.body });
    const key = Object.keys(routes).find((k) => {
      const [m, p] = k.split(' ');
      return m === method && (p === path || (p.endsWith('*') && path.startsWith(p.slice(0, -1))));
    });
    if (!key) return new Response(JSON.stringify({ error: { code: 'NO_MOCK', message: `Sin mock: ${method} ${path}` } }), { status: 404 });
    const out = (await routes[key](url, init)) as { __status?: number } | undefined;
    const status = out && typeof out === 'object' && '__status' in out ? out.__status! : 200;
    return new Response(JSON.stringify(out), { status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

export const makeUser = (permisos: string[], over: Partial<User> = {}): User => ({
  id: 4, nombre: 'Valentina Ventas', correo: 'valentina@ferreteria.test', roles: ['Ventas'], permisos, ...over,
});

export function renderApp(ui: ReactNode, { user, route = '/' }: { user?: User; route?: string } = {}) {
  if (user) sessionStore.set({ accessToken: 'token-de-prueba', refreshToken: 'refresh-de-prueba-0000000000' });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[route]}>
        <AuthProvider>{ui}</AuthProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
