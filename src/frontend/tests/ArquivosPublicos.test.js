// Issue #78 — arquivos estáticos (RNF06: sistema interno fora dos buscadores):
// robots.txt bloqueando tudo, meta robots no index.html, manifest com os
// ícones e nenhum <link> do index.html apontando para arquivo inexistente.
// Lê os arquivos do disco (public/ e index.html); sem dependência nova.
import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// No ambiente jsdom, import.meta.url não é file://; usa-se a pasta do arquivo.
const RAIZ = join(import.meta.dirname, '..');
const PUBLICO = join(RAIZ, 'public');

function lerTexto(...partes) {
  // Normaliza o fim de linha (o checkout no Windows pode trazer CRLF).
  return readFileSync(join(...partes), 'utf8').replace(/\r\n/g, '\n');
}

/** Converte um href absoluto ("/arquivo.png") no caminho dentro de public/. */
function caminhoEmPublic(href) {
  return join(PUBLICO, href.replace(/^\//, '').split(/[?#]/)[0]);
}

function documentoIndex() {
  return new DOMParser().parseFromString(lerTexto(RAIZ, 'index.html'), 'text/html');
}

const ICONES = ['favicon.ico', 'favicon-32x32.png', 'icon-192.png', 'apple-touch-icon.png'];

describe('Arquivos públicos (#78)', () => {
  it('robots.txt bloqueia todos os buscadores (conteúdo exato)', () => {
    expect(lerTexto(PUBLICO, 'robots.txt').trimEnd()).toBe('User-agent: *\nDisallow: /');
  });

  it('index.html tem <meta name="robots" content="noindex, nofollow">', () => {
    const meta = documentoIndex().querySelector('meta[name="robots"]');

    expect(meta).not.toBeNull();
    expect(meta.getAttribute('content')).toBe('noindex, nofollow');
  });

  it.each(ICONES)('o ícone %s existe em public/', (arquivo) => {
    expect(existsSync(join(PUBLICO, arquivo))).toBe(true);
  });

  it('os PNGs têm a assinatura de PNG e o tamanho combinado', () => {
    const tamanhos = { 'favicon-32x32.png': 32, 'icon-192.png': 192, 'apple-touch-icon.png': 180 };
    for (const [arquivo, lado] of Object.entries(tamanhos)) {
      const bytes = readFileSync(join(PUBLICO, arquivo));
      expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
      // Cabeçalho IHDR: largura e altura (big-endian) nos bytes 16–23.
      expect(bytes.readUInt32BE(16)).toBe(lado);
      expect(bytes.readUInt32BE(20)).toBe(lado);
    }
  });

  it('favicon.ico tem o cabeçalho de ícone (ICO)', () => {
    const bytes = readFileSync(join(PUBLICO, 'favicon.ico'));
    // reservado = 0, tipo = 1 (ícone), quantidade de imagens > 0
    expect(bytes.readUInt16LE(0)).toBe(0);
    expect(bytes.readUInt16LE(2)).toBe(1);
    expect(bytes.readUInt16LE(4)).toBeGreaterThan(0);
  });

  it('o sizes do favicon.ico no index.html lista os tamanhos que o arquivo contém', () => {
    const bytes = readFileSync(join(PUBLICO, 'favicon.ico'));
    // Cada entrada do diretório ICO tem 16 bytes; o byte 0 é a largura (0 = 256).
    const lados = Array.from({ length: bytes.readUInt16LE(4) }, (_, i) => bytes.readUInt8(6 + i * 16) || 256);
    const sizes = documentoIndex().querySelector('link[href="/favicon.ico"]').getAttribute('sizes');

    expect(sizes).toBe(lados.map((lado) => `${lado}x${lado}`).join(' '));
  });

  describe('manifest.webmanifest', () => {
    const manifest = () => JSON.parse(lerTexto(PUBLICO, 'manifest.webmanifest'));

    it('é JSON válido com name, short_name e theme_color #88185D', () => {
      const dados = manifest();

      expect(typeof dados.name).toBe('string');
      expect(dados.name.length).toBeGreaterThan(0);
      expect(dados.short_name).toBe('Sisto');
      expect(dados.theme_color.toUpperCase()).toBe('#88185D');
    });

    it('lista ícones, e cada um existe em public/ e tem sizes e type', () => {
      const { icons } = manifest();

      expect(Array.isArray(icons)).toBe(true);
      expect(icons.length).toBeGreaterThan(0);
      for (const icone of icons) {
        expect(existsSync(caminhoEmPublic(icone.src))).toBe(true);
        expect(icone.sizes).toBeTruthy();
        expect(icone.type).toBeTruthy();
      }
      expect(icons.map((icone) => icone.src)).toContain('/icon-192.png');
    });
  });

  describe('index.html', () => {
    it('mantém o SVG e liga favicon.ico, favicon-32x32, apple-touch-icon e o manifest', () => {
      const hrefs = [...documentoIndex().querySelectorAll('link[href]')].map((link) =>
        link.getAttribute('href'),
      );

      expect(hrefs).toEqual(
        expect.arrayContaining([
          '/logo-sisto-icone.svg',
          '/favicon.ico',
          '/favicon-32x32.png',
          '/apple-touch-icon.png',
          '/manifest.webmanifest',
        ]),
      );
    });

    it('nenhum <link href> aponta para arquivo inexistente em public/', () => {
      const links = [...documentoIndex().querySelectorAll('link[href]')];

      expect(links.length).toBeGreaterThan(0);
      for (const link of links) {
        const href = link.getAttribute('href');
        expect(href.startsWith('/'), `href relativo/externo: ${href}`).toBe(true);
        expect(existsSync(caminhoEmPublic(href)), `arquivo ausente: ${href}`).toBe(true);
      }
    });

    it('mantém theme-color #88185D', () => {
      const meta = documentoIndex().querySelector('meta[name="theme-color"]');

      expect(meta.getAttribute('content').toUpperCase()).toBe('#88185D');
    });
  });
});
