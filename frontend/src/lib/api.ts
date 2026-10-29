// Cliente HTTP del backend. Guarda los tokens en sessionStorage (se borran al cerrar la pestaña)
// y renueva el token de acceso una vez cuando el servidor responde 401.

export interface ApiErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

export class ApiError extends Error {
  constructor(public status: number, public body: ApiErrorBody) {
    super(body.message);
  }
}

const KEY = 'ferreteria.sesion';

export interface Session {
  accessToken: string;
  refreshToken: string;
}

export const sessionStore = {
  get(): Session | null {
    try {
      const raw = sessionStorage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Session) : null;
    } catch {
      return null;
    }
  },
  set(s: Session | null) {
    try {
      if (s) sessionStorage.setItem(KEY, JSON.stringify(s));
      else sessionStorage.removeItem(KEY);
    } catch {
      /* almacenamiento no disponible */
    }
  },
};

let onUnauthorized: () => void = () => undefined;
export const setUnauthorizedHandler = (fn: () => void) => {
  onUnauthorized = fn;
};

let refreshing: Promise<boolean> | null = null;
async function tryRefresh(): Promise<boolean> {
  const s = sessionStore.get();
  if (!s) return false;
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: s.refreshToken }),
  })
    .then(async (r) => {
      if (!r.ok) return false;
      const body = await r.json();
      sessionStore.set({ accessToken: body.accessToken, refreshToken: body.refreshToken });
      return true;
    })
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined | null>;
  signal?: AbortSignal;
  raw?: boolean;
}

export async function apiFetch<T>(path: string, opts: RequestOptions = {}, retry = true): Promise<T> {
  const qs = opts.query
    ? '?' +
      new URLSearchParams(
        Object.entries(opts.query)
          .filter(([, v]) => v !== undefined && v !== null && v !== '')
          .map(([k, v]) => [k, String(v)]),
      ).toString()
    : '';
  const s = sessionStore.get();
  const isForm = opts.body instanceof FormData;
  const res = await fetch(`/api${path}${qs}`, {
    method: opts.method ?? (opts.body ? 'POST' : 'GET'),
    headers: {
      ...(isForm || !opts.body ? {} : { 'Content-Type': 'application/json' }),
      ...(s ? { Authorization: `Bearer ${s.accessToken}` } : {}),
    },
    body: opts.body ? (isForm ? (opts.body as FormData) : JSON.stringify(opts.body)) : undefined,
    signal: opts.signal,
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await tryRefresh()) return apiFetch<T>(path, opts, false);
    sessionStore.set(null);
    onUnauthorized();
  }
  if (!res.ok) {
    let body: ApiErrorBody = { code: 'ERROR', message: `Error ${res.status}` };
    try {
      body = (await res.json()).error ?? body;
    } catch {
      /* respuesta sin JSON */
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  if (opts.raw) return (await res.blob()) as T;
  return (await res.json()) as T;
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const errorMessage = (e: unknown) => {
  if (e instanceof ApiError) {
    const det = e.body.details as { errores?: string[] } | { campo: string; mensaje: string }[] | undefined;
    if (Array.isArray(det)) return `${e.message}: ${det.map((d) => `${d.campo} ${d.mensaje}`).join('; ')}`;
    if (det && 'errores' in det && det.errores) return `${e.message}: ${det.errores.join('; ')}`;
    return e.message;
  }
  if (e instanceof DOMException && e.name === 'AbortError') return 'Consulta cancelada';
  return 'No fue posible comunicarse con el servidor';
};
