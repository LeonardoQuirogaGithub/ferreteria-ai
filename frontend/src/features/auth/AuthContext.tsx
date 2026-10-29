import { useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '@/components/ui';
import { apiFetch, sessionStore, setUnauthorizedHandler } from '@/lib/api';
import type { User } from '@/types';

interface AuthState {
  user: User | null;
  loading: boolean;
  login: (correo: string, contrasena: string) => Promise<void>;
  logout: () => Promise<void>;
  can: (...permisos: string[]) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const qc = useQueryClient();

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    if (!sessionStore.get()) {
      setLoading(false);
      return;
    }
    apiFetch<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch(() => sessionStore.set(null))
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (correo: string, contrasena: string) => {
    const r = await apiFetch<{ accessToken: string; refreshToken: string; user: User }>('/auth/login', { body: { correo, contrasena } });
    sessionStore.set({ accessToken: r.accessToken, refreshToken: r.refreshToken });
    setUser(r.user);
  }, []);

  const logout = useCallback(async () => {
    const s = sessionStore.get();
    if (s) await apiFetch('/auth/logout', { body: { refreshToken: s.refreshToken } }).catch(() => undefined);
    sessionStore.set(null);
    qc.clear();
    setUser(null);
  }, [qc]);

  // La interfaz oculta lo que no se puede usar, pero el backend es quien autoriza cada operación.
  const can = useCallback((...permisos: string[]) => !!user && permisos.some((p) => user.permisos.includes(p)), [user]);

  const value = useMemo(() => ({ user, loading, login, logout, can }), [user, loading, login, logout, can]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de AuthProvider');
  return ctx;
}

export function RequireAuth({ children, permission }: { children: ReactNode; permission?: string | string[] }) {
  const { user, loading, can } = useAuth();
  const location = useLocation();
  if (loading) return <Spinner label="Verificando sesión…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  const perms = permission ? (Array.isArray(permission) ? permission : [permission]) : [];
  if (perms.length && !can(...perms)) {
    return (
      <div role="alert" className="rounded-lg border border-amber-200 bg-amber-50 p-6 text-amber-900">
        <h1 className="text-lg font-semibold">Acceso restringido</h1>
        <p className="mt-1 text-sm">Su rol no tiene permiso para esta pantalla.</p>
      </div>
    );
  }
  return <>{children}</>;
}
