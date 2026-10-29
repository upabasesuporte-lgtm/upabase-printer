import { createBrowserRouter, Navigate, useRouteError, useNavigate } from "react-router-dom";

function RouteErrorPage() {
  const error = useRouteError() as any;
  return (
    <div style={{ minHeight:"100vh", background:"#09090b", color:"#fff", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"2rem", textAlign:"center" }}>
      <div style={{ fontSize:48, marginBottom:16 }}>⚠️</div>
      <h1 style={{ fontSize:20, fontWeight:700, marginBottom:8 }}>Algo deu errado</h1>
      <p style={{ color:"#71717a", fontSize:14, marginBottom:24 }}>Ocorreu um erro inesperado. Recarregue a página para continuar.</p>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
      <button onClick={() => window.location.reload()} style={{ padding:"10px 24px", background:"#f59e0b", color:"#000", border:"none", borderRadius:12, fontWeight:700, fontSize:14, cursor:"pointer" }}>
        Recarregar página
      </button>
      <button onClick={() => { window.location.href = "/pdv"; }} style={{ padding:"10px 24px", background:"#315DFB", color:"#fff", border:"none", borderRadius:12, fontWeight:700, fontSize:14, cursor:"pointer" }}>
        Ir para o PDV
      </button>
      </div>
      {error?.message && (
        <pre style={{ marginTop:16, color:"#ef4444", fontSize:11, maxWidth:600, textAlign:"left", background:"#1c1917", padding:12, borderRadius:8 }}>{String(error.message)}</pre>
      )}
    </div>
  );
}

// Erro dentro de uma tela do sistema: o menu continua na tela e dá para ir
// para outra (ex.: sem internet, voltar ao PDV, que funciona offline).
function PageErrorPage() {
  const error = useRouteError() as any;
  const navigate = useNavigate();
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return (
    <div style={{ minHeight:"60vh", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", padding:"2rem", textAlign:"center" }}>
      <div style={{ fontSize:44, marginBottom:12 }}>{offline ? "📡" : "⚠️"}</div>
      <h1 style={{ fontSize:19, fontWeight:700, marginBottom:8 }}>{offline ? "Esta tela precisa de internet" : "Algo deu errado nesta tela"}</h1>
      <p style={{ color:"#71717a", fontSize:14, marginBottom:22, maxWidth:420 }}>
        {offline
          ? "Sem internet, use o PDV: as vendas ficam guardadas e sobem sozinhas quando a internet voltar."
          : "Volte ao PDV ou tente abrir esta tela de novo."}
      </p>
      <div style={{ display:"flex", gap:10, flexWrap:"wrap", justifyContent:"center" }}>
        <button onClick={() => navigate("/pdv")} style={{ padding:"10px 24px", background:"#315DFB", color:"#fff", border:"none", borderRadius:12, fontWeight:700, fontSize:14, cursor:"pointer" }}>
          Voltar ao PDV
        </button>
        <button onClick={() => window.location.reload()} style={{ padding:"10px 24px", background:"transparent", color:"#71717a", border:"1px solid #71717a55", borderRadius:12, fontWeight:600, fontSize:14, cursor:"pointer" }}>
          Tentar de novo
        </button>
      </div>
      {!offline && error?.message && (
        <pre style={{ marginTop:16, color:"#ef4444", fontSize:11, maxWidth:600, whiteSpace:"pre-wrap", textAlign:"left" }}>{String(error.message)}</pre>
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
import PurchasesPage from "../pages/purchases";
import CostsPage from "../pages/costs";
import PrintAgentPage from "../pages/print-agent";
import SuppliersPage from "../pages/suppliers";
import CustomersPage from "../pages/customers";
import CashPage from "../pages/cash";
import TablesPage from "../pages/tables";
import KitchenPage from "../pages/kitchen";
import ReportsPage from "../pages/reports";
import SettingsPage from "../pages/settings";
import DigitalMenuPage from "../pages/digital-menu";
import AccountsPayablePage from "../pages/accounts-payable";
import PublicMenuPage from "../pages/menu";
import MenuTrackingPage from "../pages/menu-tracking";
import MenuSlugRedirectPage from "../pages/menu-slug";
import AdminPage from "../pages/admin";
import PricingPage from "../pages/pricing";
import AdminAvaliacoesPage from "../pages/admin/avaliacoes";

export const router = createBrowserRouter([
  {
    path: "/",
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [{
    // Erro de uma tela aparece dentro do layout (menu continua funcionando)
    errorElement: <PageErrorPage />,
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
        path: "purchases",
        element: <PurchasesPage />,
      },
      {
        path: "costs",
        element: <CostsPage />,
      },
      {
        path: "suppliers",
        element: <SuppliersPage />,
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
        path: "kitchen",
        element: <KitchenPage />,
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
    }],
  },

  {
    path: "/auth",
    element: <AuthPage />,
  },

  // Painel do programa de impressão (aberto pelo Upabase Impressão no Windows)
  {
    path: "/agente-impressao",
    element: <PrintAgentPage />,
    errorElement: <RouteErrorPage />,
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
    path: "/loja/:slug",
    element: <MenuSlugRedirectPage />,
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