import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { errorMessage } from '@/lib/api';
import { Alert, Badge, Button, Spinner } from './ui';

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Estados de carga, error y vacío para cualquier consulta. */
export function DataState({ loading, error, empty, emptyText = 'No hay resultados', children }: {
  loading: boolean; error: unknown; empty?: boolean; emptyText?: string; children: ReactNode;
}) {
  if (loading) return <Spinner />;
  if (error) return <Alert tone="danger" title="No se pudo cargar la información">{errorMessage(error)}</Alert>;
  if (empty) return <p className="p-6 text-center text-sm text-slate-500">{emptyText}</p>;
  return <>{children}</>;
}

export function Pagination({ page, totalPages, onChange }: { page: number; totalPages: number; onChange: (p: number) => void }) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Paginación" className="flex items-center justify-end gap-2 p-3 text-sm">
      <Button variant="outline" size="sm" onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Página anterior"><ChevronLeft className="h-4 w-4" /></Button>
      <span>Página {page} de {totalPages}</span>
      <Button variant="outline" size="sm" onClick={() => onChange(page + 1)} disabled={page >= totalPages} aria-label="Página siguiente"><ChevronRight className="h-4 w-4" /></Button>
    </nav>
  );
}

const STOCK: Record<string, { tone: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  normal: { tone: 'success', label: 'Disponible' },
  bajo_minimo: { tone: 'warning', label: 'Bajo mínimo' },
  agotado: { tone: 'danger', label: 'Agotado' },
  inactivo: { tone: 'neutral', label: 'Inactivo' },
};
export const StockBadge = ({ estado }: { estado: string }) => <Badge tone={STOCK[estado]?.tone ?? 'neutral'}>{STOCK[estado]?.label ?? estado}</Badge>;

const AVAIL: Record<string, { tone: 'success' | 'warning' | 'danger'; label: string }> = {
  disponible: { tone: 'success', label: 'Disponible' },
  insuficiente: { tone: 'warning', label: 'Insuficiente' },
  agotado: { tone: 'danger', label: 'Agotado' },
};
export const AvailabilityBadge = ({ estado }: { estado: string }) => <Badge tone={AVAIL[estado]?.tone}>{AVAIL[estado]?.label ?? estado}</Badge>;
