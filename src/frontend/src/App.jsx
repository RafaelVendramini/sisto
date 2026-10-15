import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import RotaPorPerfil from './components/RotaPorPerfil.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import { SessaoProvider } from './components/Sessao.jsx';
import AlterarSenha from './pages/AlterarSenha.jsx';
import Inicio from './pages/Inicio.jsx';
import Login from './pages/Login.jsx';
import Usuarios from './pages/Usuarios.jsx';
import { ROTA_ALTERAR_SENHA } from './services/conta.js';
import { PERFIS_GESTAO_USUARIOS } from './services/perfis.js';

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
            <Route path={ROTA_ALTERAR_SENHA} element={<AlterarSenha />} />
            <Route element={<RotaPorPerfil perfis={PERFIS_GESTAO_USUARIOS} />}>
              <Route path="/usuarios" element={<Usuarios />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </SessaoProvider>
  );
}
