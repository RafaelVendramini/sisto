import { Outlet, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout.jsx';
import RotaPorPerfil from './components/RotaPorPerfil.jsx';
import RotaProtegida from './components/RotaProtegida.jsx';
import { SessaoProvider } from './components/Sessao.jsx';
import AlterarSenha from './pages/AlterarSenha.jsx';
import Categorias from './pages/Categorias.jsx';
import DetalheOcorrencia from './pages/DetalheOcorrencia.jsx';
import Estudantes from './pages/Estudantes.jsx';
import Inicio from './pages/Inicio.jsx';
import Login from './pages/Login.jsx';
import Ocorrencias from './pages/Ocorrencias.jsx';
import PaginaNaoEncontrada from './pages/PaginaNaoEncontrada.jsx';
import RegistrarOcorrencia from './pages/RegistrarOcorrencia.jsx';
import Turmas from './pages/Turmas.jsx';
import Usuarios from './pages/Usuarios.jsx';
import { ROTA_ALTERAR_SENHA } from './services/conta.js';
import {
  PERFIS_CONSULTA_OCORRENCIAS,
  PERFIS_GESTAO_CATEGORIAS,
  PERFIS_GESTAO_ESTUDANTES,
  PERFIS_GESTAO_TURMAS,
  PERFIS_GESTAO_USUARIOS,
  PERFIS_REGISTRO_OCORRENCIA,
} from './services/perfis.js';

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
            <Route element={<RotaPorPerfil perfis={PERFIS_CONSULTA_OCORRENCIAS} />}>
              <Route path="/ocorrencias" element={<Ocorrencias />} />
              <Route path="/ocorrencias/:id" element={<DetalheOcorrencia />} />
            </Route>
            <Route element={<RotaPorPerfil perfis={PERFIS_REGISTRO_OCORRENCIA} />}>
              <Route path="/ocorrencias/nova" element={<RegistrarOcorrencia />} />
            </Route>
            <Route element={<RotaPorPerfil perfis={PERFIS_GESTAO_USUARIOS} />}>
              <Route path="/usuarios" element={<Usuarios />} />
            </Route>
            <Route element={<RotaPorPerfil perfis={PERFIS_GESTAO_TURMAS} />}>
              <Route path="/turmas" element={<Turmas />} />
            </Route>
            <Route element={<RotaPorPerfil perfis={PERFIS_GESTAO_ESTUDANTES} />}>
              <Route path="/estudantes" element={<Estudantes />} />
            </Route>
            <Route element={<RotaPorPerfil perfis={PERFIS_GESTAO_CATEGORIAS} />}>
              <Route path="/categorias" element={<Categorias />} />
            </Route>
          </Route>
          {/* Endereço inexistente: página 404, fora de RotaProtegida (vale logado ou não). */}
          <Route path="*" element={<PaginaNaoEncontrada />} />
        </Route>
      </Routes>
    </SessaoProvider>
  );
}
