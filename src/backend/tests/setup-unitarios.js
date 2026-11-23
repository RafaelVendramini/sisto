// Trava dos testes unitários e de integração (`npm test`) — Issue #134.
//
// Os testes do `npm test` usam o Prisma simulado (mock) e nunca devem tocar um
// banco de verdade. No build do Render (SSD 1.13, "Testes no build"), porém, o
// `npm test` roda com as variáveis do serviço — inclusive a DATABASE_URL do
// banco de produção (Neon). Para que um teste futuro que esqueça o mock não
// conecte nesse banco (RN05 / LGPD), a DATABASE_URL é trocada aqui, antes de
// qualquer teste, por um endereço fictício e inacessível (porta 1, que nada
// escuta). Os testes que precisam de outro valor continuam usando vi.stubEnv.
//
// Os testes de ponta a ponta (tests/e2e) NÃO usam este arquivo: eles rodam com
// `npm run test:e2e`, contra o banco `sisto_test` do .env.test, com a trava
// própria de tests/e2e/apoio/ambiente.js.
process.env.DATABASE_URL = 'postgresql://teste:teste@127.0.0.1:1/banco_inexistente_testes_unitarios';
