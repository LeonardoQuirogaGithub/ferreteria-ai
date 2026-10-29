import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { DataState, PageHeader, Pagination, StockBadge } from '@/components/common';
import { Button, Card, Input, Select, Table, Td, Th } from '@/components/ui';
import { useAuth } from '@/features/auth/AuthContext';
import { apiFetch, type Paginated } from '@/lib/api';
import { money, qty } from '@/lib/format';
import type { Product } from '@/types';

export function useCatalogs() {
  const brands = useQuery({ queryKey: ['brands'], queryFn: () => apiFetch<{ data: { id: number; nombre: string }[] }>('/brands'), staleTime: 60_000 });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => apiFetch<{ data: { id: number; nombre: string; categoria_padre: string | null }[] }>('/categories'), staleTime: 60_000 });
  const units = useQuery({ queryKey: ['units'], queryFn: () => apiFetch<{ data: { id: number; codigo: string; nombre: string; permite_decimal: boolean }[] }>('/units'), staleTime: 60_000 });
  return { brands: brands.data?.data ?? [], categories: categories.data?.data ?? [], units: units.data?.data ?? [] };
}

export function ProductsPage() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [marcaId, setMarcaId] = useState('');
  const [categoriaId, setCategoriaId] = useState('');
  const [inactivos, setInactivos] = useState(false);
  const [page, setPage] = useState(1);
  const { brands, categories } = useCatalogs();

  const list = useQuery({
    queryKey: ['products', q, marcaId, categoriaId, inactivos, page],
    queryFn: ({ signal }) => apiFetch<Paginated<Product>>('/products', { query: { q, marcaId, categoriaId, incluirInactivos: inactivos, page, pageSize: 25 }, signal }),
    placeholderData: keepPreviousData,
  });

  return (
    <>
      <PageHeader
        title="Catálogo de productos"
        description="Cada combinación de marca y presentación es un producto independiente con su propio código de barras."
        actions={can('producto.gestionar') && <Button onClick={() => navigate('/productos/nuevo')}><Plus className="h-4 w-4" aria-hidden /> Nuevo producto</Button>}
      />
      <Card>
        <div className="grid gap-3 border-b p-3 md:grid-cols-4">
          <Input aria-label="Buscar" placeholder="Nombre, código, marca o categoría…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} />
          <Select aria-label="Marca" value={marcaId} onChange={(e) => { setMarcaId(e.target.value); setPage(1); }}>
            <option value="">Todas las marcas</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.nombre}</option>)}
          </Select>
          <Select aria-label="Categoría" value={categoriaId} onChange={(e) => { setCategoriaId(e.target.value); setPage(1); }}>
            <option value="">Todas las categorías</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.categoria_padre ? `${c.categoria_padre} › ` : ''}{c.nombre}</option>)}
          </Select>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={inactivos} onChange={(e) => setInactivos(e.target.checked)} /> Incluir inactivos</label>
        </div>
        <DataState loading={list.isLoading} error={list.error} empty={list.data?.data.length === 0}>
          <Table>
            <thead>
              <tr><Th>Código</Th><Th>Producto</Th><Th>Marca</Th><Th>Presentación</Th><Th className="text-right">Disponible</Th><Th className="text-right">Reservada</Th><Th className="text-right">Dañada</Th><Th className="text-right">Precio</Th><Th>Estado</Th></tr>
            </thead>
            <tbody>
              {list.data?.data.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td className="font-mono text-xs">{p.codigo_barras}</Td>
                  <Td><Link className="font-medium text-brand-700 hover:underline" to={`/productos/${p.id}`}>{p.nombre}</Link><p className="text-xs text-slate-500">{p.categoria}</p></Td>
                  <Td>{p.marca}</Td>
                  <Td>{p.presentacion}</Td>
                  <Td className="text-right">{qty(p.disponible)} {p.unidad_codigo}</Td>
                  <Td className="text-right">{qty(p.reservada)}</Td>
                  <Td className="text-right">{qty(p.danada)}</Td>
                  <Td className="text-right">{money(p.precio_vigente)}</Td>
                  <Td><StockBadge estado={p.estado_stock} /></Td>
                </tr>
              ))}
            </tbody>
          </Table>
          {list.data && <Pagination page={page} totalPages={list.data.meta.totalPages} onChange={setPage} />}
        </DataState>
      </Card>
    </>
  );
}
