import { createBrowserRouter, Navigate, useRouteError } from "react-router-dom";

function RouteErrorPage() {
  const error = useRouteError() as any;
  return (
    <div style={{ minHeight:"100vh", background:"#09090b", color:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"2rem", textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
      <h1 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Algo deu errado</h1>
      <p style={{ color:"#71717a", fontSize:14, marginBottom:24 }}>Ocorreu um erro inesperado. Recarregue a página para continuar.</p>
      <button onClick={() => window.location.reload()} style={{ padding:"10px 24px", background:"#f59e0b", color:"#000", border:"none", borderRadius:12, fontWeight:700, fontSize:14, cursor:"pointer" }}>
        Recarregar página
      </button>
      {error?.message && (
        <pre style={{ marginTop:16, color:"#ef4444", fontSize:11, maxWidth:600, textAlign:"left", background:"#1c1917", padding:12, borderRadius:8 }}>{String(error.message)}</pre>
      )}
    </div>
  );
}

import { AppLayout } from "../layouts/AppLayout";

import AuthPage from "../pages/auth";
import PrivacyPage from "../pages/privacy";
import TermsPage from "../pages/terms";
import DashboardPage from "../pages/dashboard";
import PdvPage from "../pages/pdv";
import ProductsPage from "../pages/products";
import StockPage from "../pages/stock";
import CustomersPage from "../pages/customers";
import CashPage from "../pages/cash";
import TablesPage from "../pages/tables";
import ReportsPage from "../pages/reports";
import SettingsPage from "../pages/settings";
import DigitalMenuPage from "../pages/digital-menu";
import AccountsPayablePage from "../pages/accounts-payable";
import PublicMenuPage from "../pages/menu";
import MenuTrackingPage from "../pages/menu-tracking";
import AdminPage from "../pages/admin";
import PricingPage from "../pages/pricing";
import AdminAvaliacoesPage from "../pages/admin/avaliacoes";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      {
        index: true,
        element: <DashboardPage />,
      },
      {
        path: "pdv",
        element: <PdvPage />,
      },
      {
        path: "products",
        element: <ProductsPage />,
      },
      {
        path: "stock",
        element: <StockPage />,
      },
      {
        path: "customers",
        element: <CustomersPage />,
      },
      {
        path: "cash",
        element: <CashPage />,
      },
      {
        path: "tables",
        element: <TablesPage />,
      },
      {
        path: "accounts-payable",
        element: <AccountsPayablePage />,
      },
      {
        path: "reports",
        element: <ReportsPage />,
      },
      {
        path: "settings",
        element: <SettingsPage />,
      },
      {
        path: "digital-menu",
        element: <DigitalMenuPage />,
      },
      {
        path: "admin",
        element: <AdminPage />,
      },
      {
        path: "admin/avaliacoes",
        element: <AdminAvaliacoesPage />,
      },
    ],
  },

  {
    path: "/auth",
    element: <AuthPage />,
  },

  {
    path: "/menu/:uid",
    element: <PublicMenuPage />,
    errorElement: <RouteErrorPage />,
  },

  {
    path: "/menu/:uid/pedido/:orderId",
    element: <MenuTrackingPage />,
    errorElement: <RouteErrorPage />,
  },

  {
    path: "/planos",
    element: <PricingPage />,
    errorElement: <RouteErrorPage />,
  },

  {
    path: "/privacy",
    element: <PrivacyPage />,
  },

  {
    path: "/terms",
    element: <TermsPage />,
  },

  {
    path: "*",
    element: <Navigate to="/auth" replace />,
  },
]);