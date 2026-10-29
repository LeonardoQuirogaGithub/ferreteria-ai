import {
  BarChart3, Bot, Boxes, Calculator, ClipboardList, FileSpreadsheet, FileText, History, LayoutDashboard, Lock, LogOut, Menu,
  Package, Receipt, Settings2, ShieldCheck, ShoppingCart, Tags, Truck, Users, Wallet, X,
} from 'lucide-react';
import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { Button } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { cn } from '@/lib/format';

export const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, perm: 'inventario.consultar' },
  { to: '/asistente', label: 'Asistente IA', icon: Bot, perm: 'ia.usar' },
  { to: '/cotizador', label: 'Cotizador de pintura', icon: Calculator, perm: 'cotizacion.gestionar' },
  { to: '/cotizaciones', label: 'Cotizaciones', icon: FileText, perm: 'cotizacion.gestionar' },
  { to: '/productos', label: 'Productos', icon: Package, perm: 'inventario.consultar' },
  { to: '/catalogos', label: 'Marcas y unidades', icon: Tags, perm: 'inventario.consultar' },
  { to: '/existencias', label: 'Existencias y lotes', icon: Boxes, perm: 'inventario.consultar' },
  { to: '/compras', label: 'Compras', icon: Truck, perm: 'compra.registrar' },
  { to: '/ventas', label: 'Ventas', icon: ShoppingCart, perm: 'venta.registrar' },
  { to: '/terceros', label: 'Clientes y proveedores', icon: Users, perm: 'tercero.gestionar' },
  { to: '/precios', label: 'Precios', icon: Wallet, perm: 'inventario.consultar' },
  { to: '/kardex', label: 'Movimientos y kardex', icon: History, perm: 'kardex.consultar' },
  { to: '/reportes', label: 'Reportes', icon: BarChart3, perm: 'reporte.consultar' },
  { to: '/usuarios', label: 'Usuarios y roles', icon: ShieldCheck, perm: 'usuario.gestionar' },
  { to: '/auditoria', label: 'Auditoría', icon: ClipboardList, perm: 'auditoria.consultar' },
  { to: '/cierres', label: 'Cierres mensuales', icon: Lock, perm: 'cierre.ejecutar' },
  { to: '/importacion', label: 'Importación Excel', icon: FileSpreadsheet, perm: 'migracion.ejecutar' },
  { to: '/ia-estado', label: 'Estado de Ollama', icon: Settings2, perm: 'ia.usar' },
];

export function AppLayout() {
  const { user, can, logout } = useAuth();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const items = NAV.filter((n) => can(n.perm));

  const nav = (
    <nav aria-label="Principal" className="space-y-0.5 p-3">
      {items.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => setOpen(false)}
          className={({ isActive }) =>
            cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm', isActive ? 'bg-brand-50 font-medium text-brand-700' : 'text-slate-600 hover:bg-slate-100')
          }
        >
          <Icon className="h-4 w-4" aria-hidden /> {label}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-screen">
      <a href="#contenido" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:p-2">
        Saltar al contenido
      </a>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">
        <div className="flex items-center gap-2 border-b px-5 py-4">
          <Receipt className="h-6 w-6 text-brand-600" aria-hidden />
          <span className="font-bold">Ferretería</span>
        </div>
        {nav}
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-slate-900/40 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-white" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b px-4 py-3">
              <span className="font-bold">Ferretería</span>
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cerrar menú"><X className="h-4 w-4" /></Button>
            </div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={() => setOpen(true)} aria-label="Abrir menú"><Menu className="h-5 w-5" /></Button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <div className="text-right">
              <p className="font-medium">{user?.nombre}</p>
              <p className="text-xs text-slate-500">{user?.roles.join(', ')}</p>
            </div>
            <Button variant="outline" size="sm" onClick={logout}><LogOut className="h-4 w-4" aria-hidden /> Salir</Button>
          </div>
        </header>
        <main id="contenido" className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          <ErrorBoundary resetKey={location.pathname}>
            <Outlet />
          </ErrorBoundary>
        </main>
      </div>
    </div>
  );
}
