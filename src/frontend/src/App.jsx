import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import { SessaoProvider } from './components/Sessao.jsx';
import Inicio from './pages/Inicio.jsx';
import Login from './pages/Login.jsx';

function LayoutComConteudo() {
  return (
    <Layout>
      <Outlet />
    </Layout>
  );
}

// Componente raiz: rotas públicas (/login) e área autenticada (RF02, RNF03).
// O roteador (BrowserRouter) é criado em main.jsx; nos testes, MemoryRouter.
export default function App() {
  return (
    <SessaoProvider>
      <Routes>
        <Route element={<LayoutComConteudo />}>
          <Route path="/login" element={<Login />} />
          <Route element={<RotaProtegida />}>
            <Route path="/" element={<Inicio />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SessaoProvider>
  );
}
