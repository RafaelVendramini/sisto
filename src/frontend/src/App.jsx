import Layout from './components/Layout.jsx';
import Inicio from './pages/Inicio.jsx';

// Componente raiz. As telas de login e de usuários entram nas Issues #14, #15 e #16.
export default function App() {
  return (
    <Layout>
      <Inicio />
    </Layout>
  );
}
