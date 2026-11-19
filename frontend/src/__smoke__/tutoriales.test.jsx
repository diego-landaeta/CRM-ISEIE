// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  Ayuda › Tutoriales (Diego, 18/11: «tienes que poner los tutoriales»). Se comprueba:

    · que cada tutorial tiene su texto, sus capturas, enlaces que llevan a algo,
      permisos del catálogo y recorridos que existen;
    · que no llevan datos internos (IPs, correos, rutas del servidor, valores de
      variables) y que lo del servidor solo sale en los de configuración;
    · que la lista enseña a cada uno lo de su permiso, que cada tutorial abre y
      que sin permiso no se abre ni por su dirección;
    · que «Ver recorrido» lleva a la pantalla y que allí el recorrido se abre,
      aunque ya se hubiera visto.
*/

const { permisos, yo } = vi.hoisted(() => ({ permisos: new Set(), yo: { current: { id: 7, role: 'gestor' } } }));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: yo.current }) }));
vi.mock('@/shared/hooks/usePermission', () => ({
  default: () => ({ can: (k) => permisos.has(k), llevaEquipo: false }),
}));

const { TUTORIALES, TEMAS, PERMISOS_DE_TUTORIALES } = await import('@/modules/manual/tutoriales/tutoriales');
const { leerTexto, anclaDe } = await import('@/modules/manual/tutoriales/TextoTutorial');
const { default: TutorialesPage } = await import('@/modules/manual/pages/TutorialesPage');
const { default: TutorialPage } = await import('@/modules/manual/pages/TutorialPage');
const { default: VerRecorrido } = await import('@/shared/components/ui/VerRecorrido');
const { RECORRIDOS_COBROS, claveRecorrido, recorridoPedido } = await import('@/shared/lib/recorridosCobros');
const { CLAVES } = await import('../../../backend/src/modules/permissions/catalogo.js');

const DIR = path.resolve(__dirname, '../modules/manual/tutoriales');
const texto = (id) => fs.readFileSync(path.join(DIR, 'contenido', `${id}.md`), 'utf8');
const lista = (p) => (Array.isArray(p) ? p : [p]);
const TODOS_LOS_PERMISOS = [...CLAVES];

/** Todos los bloques, también los de dentro de las notas. */
const aplanar = (bloques) => bloques.flatMap((b) => (b.t === 'nota' ? [b, ...aplanar(b.bloques)] : [b]));
const textosDe = (b) => {
  if (b.t === 'p' || b.t === 'h2' || b.t === 'h3') return [b.texto];
  if (b.t === 'ol' || b.t === 'ul') return b.items;
  if (b.t === 'tabla') return [...b.cabecera, ...b.filas.flat()];
  if (b.t === 'img') return [b.alt, b.pie || ''];
  return [];
};
const enlacesDe = (md) => aplanar(leerTexto(md)).flatMap(textosDe)
  .flatMap((t) => [...t.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)].map((m) => m[1]));
const anclasDe = (md) => new Set(aplanar(leerTexto(md)).filter((b) => b.t === 'h2' || b.t === 'h3').map((b) => b.id));

function pantalla(ruta) {
  return render(
    <MemoryRouter initialEntries={[ruta]}>
      <Routes>
        <Route path="/manual/tutoriales" element={<TutorialesPage />} />
        <Route path="/manual/tutoriales/:id" element={<TutorialPage />} />
        <Route path="*" element={<p>Otra pantalla</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  permisos.clear();
  localStorage.clear();
  sessionStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  document.body.innerHTML = '';
});

describe('los tutoriales y su texto', () => {
  it('cada tutorial tiene su texto, y no sobra ningún texto', () => {
    const ficheros = fs.readdirSync(path.join(DIR, 'contenido')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3));
    expect(ficheros.sort()).toEqual(TUTORIALES.map((t) => t.id).sort());
    expect(new Set(TUTORIALES.map((t) => t.id)).size).toBe(TUTORIALES.length);
  });

  it('cada tutorial pide permisos que existen en el catálogo, y su tema existe', () => {
    for (const t of TUTORIALES) {
      expect(TEMAS[t.tema], t.id).toBeTruthy();
      for (const p of lista(t.permiso)) expect(CLAVES.has(p), `${t.id}: ${p}`).toBe(true);
    }
    for (const p of PERMISOS_DE_TUTORIALES) expect(CLAVES.has(p), p).toBe(true);
  });

  it('cada recorrido de un tutorial existe y lleva a una pantalla', () => {
    for (const t of TUTORIALES) {
      for (const r of t.recorridos || []) {
        expect(RECORRIDOS_COBROS[r.id], `${t.id}: ${r.id}`).toBeTruthy();
        expect(r.ruta, `${t.id}: ${r.id}`).toMatch(/^\/[a-z]/);
      }
    }
  });

  it('cada captura que se cita existe, y no sobra ninguna', () => {
    const hay = new Set(fs.readdirSync(path.join(DIR, 'img')));
    const citadas = new Set();
    for (const t of TUTORIALES) {
      for (const b of aplanar(leerTexto(texto(t.id))).filter((x) => x.t === 'img')) {
        expect(hay.has(b.archivo), `${t.id}: ${b.archivo}`).toBe(true);
        expect(b.alt.length, `${t.id}: ${b.archivo} sin texto alternativo`).toBeGreaterThan(10);
        citadas.add(b.archivo);
      }
    }
    expect([...hay].filter((f) => !citadas.has(f))).toEqual([]);
  });

  it('las capturas pesan poco (WebP de menos de 80 KB y no más de 960 px de ancho)', () => {
    for (const f of fs.readdirSync(path.join(DIR, 'img'))) {
      expect(f, f).toMatch(/\.webp$/);
      const buf = fs.readFileSync(path.join(DIR, 'img', f));
      expect(buf.length, f).toBeLessThan(80 * 1024);
      // VP8X guarda el ancho menos uno en 3 bytes; VP8/VP8L, en su cabecera.
      const tipo = buf.toString('ascii', 12, 16);
      const ancho = tipo === 'VP8X' ? 1 + buf.readUIntLE(24, 3)
        : tipo === 'VP8 ' ? buf.readUInt16LE(26) & 0x3fff
          : 1 + (buf.readUInt32LE(21) & 0x3fff);
      expect(ancho, f).toBeLessThanOrEqual(960);
    }
  });

  it('cada enlace lleva a un tutorial o a un apartado que existe', () => {
    for (const t of TUTORIALES) {
      const md = texto(t.id);
      for (const destino of enlacesDe(md)) {
        if (destino.startsWith('tutorial:')) {
          const [id, ancla] = destino.slice(9).split('#');
          expect(TUTORIALES.some((x) => x.id === id), `${t.id} → ${destino}`).toBe(true);
          if (ancla) expect(anclasDe(texto(id)).has(ancla), `${t.id} → ${destino}`).toBe(true);
        } else if (destino.startsWith('#')) {
          expect(anclasDe(md).has(destino.slice(1)), `${t.id} → ${destino}`).toBe(true);
        } else {
          expect(destino, `${t.id}: enlace raro`).toMatch(/^(https:\/\/|\/)/);
        }
      }
    }
  });

  it('el ancla de un título va sin tildes ni signos', () => {
    expect(anclaDe('3. Disputas (contracargos)')).toBe('3-disputas-contracargos');
    expect(anclaDe('2. Factura automática y cola de facturación')).toBe('2-factura-automatica-y-cola-de-facturacion');
  });
});

describe('sin datos internos (los repos son públicos y lo lee una gestora)', () => {
  const PROHIBIDO = [
    [/\b\d{1,3}(\.\d{1,3}){3}\b/, 'una IP'],
    [/[\w.+-]+@[\w-]+\.[\w.-]+/, 'un correo'],
    [/\bacct_[A-Za-z0-9]+/, 'una cuenta de Stripe'],
    [/\b(sk|rk|pk)_(live|test)_[A-Za-z0-9]{6,}/, 'una clave de Stripe'],
    [/\bwhsec_[A-Za-z0-9]{4,}|\bxkeysib-[a-z0-9]{6,}|\bsbp_[a-z0-9]{6,}/, 'una clave'],
    [/\/var\/|\/home\/|\/etc\/|[A-Z]:\\|Desktop|Backups-CRM|\.env\b/, 'una ruta del servidor o del PC'],
    [/\b[A-Z][A-Z0-9]*(_[A-Z0-9]+)+\s*=/, 'el valor de una variable'],
    [/\bnpm run\b|\bpm2\b|\bssh\b|\.mjs\b|\.py\b/i, 'un comando del servidor'],
    [/\b(Diego|Carlos|Dayana|Mireia|Yolanda|Fabi[aá]n)\b/, 'el nombre de una persona del equipo'],
  ];

  for (const t of TUTORIALES) {
    it(`${t.id}: sin IPs, correos, claves, rutas ni nombres`, () => {
      const md = texto(t.id);
      for (const [re, que] of PROHIBIDO) expect(re.exec(md)?.[0] ?? null, `${t.id} lleva ${que}`).toBeNull();
    });
  }

  it('las variables del servidor solo salen en los de configuración', () => {
    for (const t of TUTORIALES.filter((x) => x.tema !== 'configuracion')) {
      expect(/`[A-Z][A-Z0-9]*(_[A-Z0-9]+)+`/.exec(texto(t.id))?.[0] ?? null, t.id).toBeNull();
    }
  });

  it('los de configuración solo los ve quien ve o configura integraciones o los links', () => {
    const config = ['integrations.view', 'integrations.edit', 'links_pago.configurar'];
    for (const t of TUTORIALES.filter((x) => x.tema === 'configuracion')) {
      expect(lista(t.permiso).sort(), t.id).toEqual([...config].sort());
    }
  });
});

describe('la lista, según el permiso', () => {
  const ids = () => [...document.querySelectorAll('[data-tutorial]')].map((a) => a.getAttribute('data-tutorial'));

  it('la gestora ve los suyos y ninguno de configuración', () => {
    ['links_pago.crear', 'conversions.create', 'conversions.cobros', 'facturas.view'].forEach((p) => permisos.add(p));
    pantalla('/manual/tutoriales');
    expect(ids()).toEqual(['links-de-pago', 'ventas-y-cuotas', 'anular-factura']);
    expect(screen.queryByRole('heading', { name: TEMAS.configuracion.titulo })).toBeNull();
  });

  it('quien ve integraciones ve los de configuración', () => {
    permisos.add('integrations.view');
    pantalla('/manual/tutoriales');
    const vistos = ids();
    expect(vistos).toContain('configuracion');
    expect(vistos).toContain('links-de-pago-instalacion');
    expect(vistos).toContain('stripe');
    expect(vistos).not.toContain('links-de-pago');
    expect(vistos).toHaveLength(TUTORIALES.filter((t) => t.tema === 'configuracion').length);
  });

  it('con «Configurar los links de pago» también', () => {
    permisos.add('links_pago.configurar');
    pantalla('/manual/tutoriales');
    expect(ids()).toContain('links-de-pago-instalacion');
  });

  it('sin ningún permiso, lo dice y manda al manual', () => {
    pantalla('/manual/tutoriales');
    expect(ids()).toEqual([]);
    expect(screen.getByText('No hay tutoriales para tu usuario')).toBeInTheDocument();
  });

  it('un tutorial de la lista abre al pulsarlo', () => {
    permisos.add('links_pago.crear');
    pantalla('/manual/tutoriales');
    fireEvent.click(document.querySelector('[data-tutorial="links-de-pago"]'));
    expect(screen.getByRole('heading', { level: 2, name: '1. Dónde está' })).toBeInTheDocument();
  });
});

describe('cada tutorial abre', () => {
  for (const t of TUTORIALES) {
    it(`${t.id}: con su permiso, su texto y sus capturas`, () => {
      lista(t.permiso).slice(0, 1).forEach((p) => permisos.add(p));
      pantalla(`/manual/tutoriales/${t.id}`);
      const primero = leerTexto(texto(t.id)).find((b) => b.t === 'h2');
      expect(screen.getByRole('heading', { level: 2, name: primero.texto.replace(/[*`]/g, '') })).toBeInTheDocument();
      const imgs = aplanar(leerTexto(texto(t.id))).filter((b) => b.t === 'img');
      expect(document.querySelectorAll('article img')).toHaveLength(imgs.length);
      for (const img of document.querySelectorAll('article img')) expect(img.getAttribute('src')).toBeTruthy();
      expect(screen.queryByText('Este tutorial no está disponible para tu usuario')).toBeNull();
    });
  }

  it('sin su permiso no se abre, tampoco por la dirección', () => {
    permisos.add('links_pago.crear');
    pantalla('/manual/tutoriales/stripe');
    expect(screen.getByText('Este tutorial no está disponible para tu usuario')).toBeInTheDocument();
    expect(document.querySelector('article')).toBeNull();
  });

  it('uno que no existe, igual', () => {
    TODOS_LOS_PERMISOS.forEach((p) => permisos.add(p));
    pantalla('/manual/tutoriales/no-existe');
    expect(screen.getByText('Este tutorial no está disponible para tu usuario')).toBeInTheDocument();
  });
});

describe('«Ver recorrido» desde un tutorial', () => {
  it('sin el permiso del recorrido no se ofrece', () => {
    permisos.add('integrations.view');
    pantalla('/manual/tutoriales/stripe');
    expect(document.querySelector('[data-ver-recorrido-tutorial="integraciones-stripe"]')).not.toBeNull();
    // «Disputas» pide «Asociar pagos de Stripe»: sin él, no sale.
    expect(document.querySelector('[data-ver-recorrido-tutorial="disputas-stripe"]')).toBeNull();
  });

  it('lleva a la pantalla y deja pedido el recorrido', () => {
    permisos.add('facturas.view');
    permisos.add('facturas.gestionar');
    pantalla('/manual/tutoriales/anular-factura');
    fireEvent.click(document.querySelector('[data-ver-recorrido-tutorial="anular-factura"]'));
    expect(screen.getByText('Otra pantalla')).toBeInTheDocument();
    expect(recorridoPedido('anular-factura')).toBe(true);
  });

  it('en la pantalla, el recorrido pedido se abre aunque ya se hubiera visto, y se gasta', () => {
    vi.useFakeTimers();
    permisos.add('stripe.edit');
    localStorage.setItem(claveRecorrido('disputas-stripe', 7), '1');
    sessionStorage.setItem('recorrido-pedido', JSON.stringify({ id: 'disputas-stripe', hasta: Date.now() + 60000 }));
    render(<VerRecorrido id="disputas-stripe" />);
    act(() => { vi.advanceTimersByTime(900); });
    expect(screen.getByRole('dialog', { name: 'Qué es una disputa' })).toBeInTheDocument();
    expect(recorridoPedido('disputas-stripe')).toBe(false);
  });

  it('un recorrido pedido de otra pantalla o caducado no abre este', () => {
    vi.useFakeTimers();
    permisos.add('stripe.edit');
    localStorage.setItem(claveRecorrido('disputas-stripe', 7), '1');
    sessionStorage.setItem('recorrido-pedido', JSON.stringify({ id: 'pagos-stripe', hasta: Date.now() + 60000 }));
    const { unmount } = render(<VerRecorrido id="disputas-stripe" />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByRole('dialog')).toBeNull();
    unmount();
    sessionStorage.setItem('recorrido-pedido', JSON.stringify({ id: 'disputas-stripe', hasta: Date.now() - 1 }));
    render(<VerRecorrido id="disputas-stripe" />);
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('el Markdown de los tutoriales', () => {
  it('lee títulos, pasos, listas, tablas, capturas y notas', () => {
    const b = leerTexto([
      '## 1. Uno', '', 'Un párrafo', 'que sigue.', '',
      '1. paso', '   que sigue', '2. otro', '', '- punto', '',
      '| A | B |', '|---|---|', '| x | y |', '',
      '![Alt de la captura](a.webp "Su pie")', '',
      '> [!aviso] Ojo', '> - dentro', '', '6. sexto',
    ].join('\n'));
    expect(b.map((x) => x.t)).toEqual(['h2', 'p', 'ol', 'ul', 'tabla', 'img', 'nota', 'ol']);
    expect(b[1].texto).toBe('Un párrafo que sigue.');
    expect(b[2].items).toEqual(['paso que sigue', 'otro']);
    expect(b[4]).toMatchObject({ cabecera: ['A', 'B'], filas: [['x', 'y']] });
    expect(b[5]).toMatchObject({ archivo: 'a.webp', pie: 'Su pie' });
    expect(b[6].tipo).toBe('aviso');
    expect(b[6].bloques.map((x) => x.t)).toEqual(['p', 'ul']);
    expect(b[7].inicio).toBe(6);
  });
});
