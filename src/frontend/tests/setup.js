import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Bloqueia o fetch real: nenhum teste pode sair para a rede. Os testes que
// precisam de fetch o simulam com vi.stubGlobal('fetch', ...), que vale por
// cima deste padrão e é desfeito por vi.unstubAllGlobals().
//
// O services/api.js converte qualquer erro do fetch em "sem conexão", então o
// erro lançado aqui não derrubaria o teste sozinho. Por isso cada chamada
// bloqueada é anotada e o afterEach falha o teste que a fez (Issue #129).
const chamadasBloqueadas = [];

function fetchBloqueado(url) {
  chamadasBloqueadas.push(String(url));
  throw new Error(
    `fetch real bloqueado nos testes (${String(url)}). Simule o fetch com vi.stubGlobal('fetch', ...).`,
  );
}

globalThis.fetch = fetchBloqueado;

// Só para o teste que verifica a própria trava: descarta as chamadas anotadas.
globalThis.descartarChamadasFetchBloqueadas = () => chamadasBloqueadas.splice(0);

beforeEach(() => {
  chamadasBloqueadas.length = 0;
  globalThis.fetch = fetchBloqueado;
});

afterEach(() => {
  cleanup();
  if (chamadasBloqueadas.length > 0) {
    const urls = chamadasBloqueadas.splice(0).join(', ');
    throw new Error(
      `O teste chamou o fetch real (bloqueado): ${urls}. Simule o fetch com vi.stubGlobal('fetch', ...).`,
    );
  }
});
