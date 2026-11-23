import app from './app.js';
import { registrarEncerramentoLimpo } from './lib/encerramento.js';

const PORT = Number(process.env.PORT) || 3000;

const servidor = app.listen(PORT, () => {
  console.log(`Sisto API ouvindo na porta ${PORT}`);
});

// SIGTERM/SIGINT: fecha o servidor HTTP e a conexão com o banco (Issue #129).
registrarEncerramentoLimpo(servidor);
