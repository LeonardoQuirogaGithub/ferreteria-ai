import { Route, Routes } from 'react-router-dom';
import { RequireAuth } from './features/auth/AuthContext';
import { AppLayout } from './layouts/AppLayout';
import { AuditPage, ClosuresPage, ImportsPage, ReportsPage, UsersPage } from './pages/AdminPages';
import { AiStatusPage } from './pages/AiStatusPage';
import { ChatPage } from './pages/ChatPage';
import { DashboardPage } from './pages/DashboardPage';
import { PurchasesPage, SalesPage, ThirdPartiesPage } from './pages/DocumentsPages';
import { CatalogsPage, InventoryPage, KardexPage, PricesPage } from './pages/InventoryPages';
import { LoginPage } from './pages/LoginPage';
import { PaintQuotePage } from './pages/PaintQuotePage';
import { ProductDetailPage } from './pages/ProductDetailPage';
import { ProductFormPage } from './pages/ProductFormPage';
import { ProductsPage } from './pages/ProductsPage';
import { QuotationDetailPage, QuotationsPage } from './pages/QuotationsPages';

const guard = (permission: string, el: JSX.Element) => <RequireAuth permission={permission}>{el}</RequireAuth>;

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<RequireAuth><AppLayout /></RequireAuth>}>
        <Route index element={guard('inventario.consultar', <DashboardPage />)} />
        <Route path="productos" element={guard('inventario.consultar', <ProductsPage />)} />
        <Route path="productos/nuevo" element={guard('producto.gestionar', <ProductFormPage />)} />
        <Route path="productos/:id" element={guard('inventario.consultar', <ProductDetailPage />)} />
        <Route path="productos/:id/editar" element={guard('producto.gestionar', <ProductFormPage />)} />
        <Route path="catalogos" element={guard('inventario.consultar', <CatalogsPage />)} />
        <Route path="existencias" element={guard('inventario.consultar', <InventoryPage />)} />
        <Route path="compras" element={guard('compra.registrar', <PurchasesPage />)} />
        <Route path="ventas" element={guard('venta.registrar', <SalesPage />)} />
        <Route path="terceros" element={guard('tercero.gestionar', <ThirdPartiesPage />)} />
        <Route path="precios" element={guard('inventario.consultar', <PricesPage />)} />
        <Route path="kardex" element={guard('kardex.consultar', <KardexPage />)} />
        <Route path="reportes" element={guard('reporte.consultar', <ReportsPage />)} />
        <Route path="usuarios" element={guard('usuario.gestionar', <UsersPage />)} />
        <Route path="auditoria" element={guard('auditoria.consultar', <AuditPage />)} />
        <Route path="cierres" element={guard('cierre.ejecutar', <ClosuresPage />)} />
        <Route path="importacion" element={guard('migracion.ejecutar', <ImportsPage />)} />
        <Route path="asistente" element={guard('ia.usar', <ChatPage />)} />
        <Route path="cotizador" element={guard('cotizacion.gestionar', <PaintQuotePage />)} />
        <Route path="cotizaciones" element={guard('cotizacion.gestionar', <QuotationsPage />)} />
        <Route path="cotizaciones/:id" element={guard('cotizacion.gestionar', <QuotationDetailPage />)} />
        <Route path="ia-estado" element={guard('ia.usar', <AiStatusPage />)} />
        <Route path="*" element={<p className="p-6">Página no encontrada.</p>} />
      </Route>
    </Routes>
  );
}
