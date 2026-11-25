// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, within, fireEvent } from '@testing-library/react';
import RecorridoGuiado, { colocarCartel, MARGEN_CARTEL } from '@/shared/components/ui/RecorridoGuiado';
import { PASOS_TABLERO, CLAVE_RECORRIDO_TABLERO } from '@/modules/tasks/lib/recorridoTablero';
import { RECORRIDOS_COBROS, pasosPara } from '@/shared/lib/recorridosCobros';
import { RECORRIDOS_DE_PRUEBA, pasosDePruebaPara, pasosApagada } from '@/shared/lib/recorridosDePrueba';
import { RECORRIDOS_FINANZAS } from '@/shared/lib/recorridosFinanzas';
import { RECORRIDOS_NOVEDADES } from '@/shared/lib/recorridosNovedades';
import { RECORRIDOS_NOVEDADES_B } from '@/shared/lib/recorridosNovedadesB';
import { RECORRIDOS_GESTORA } from '@/shared/lib/recorridosGestora';
import { RECORRIDOS_GESTORA_B } from '@/shared/lib/recorridosGestoraB';
import { RECORRIDOS_GESTORA_C } from '@/shared/lib/recorridosGestoraC';
import { RECORRIDOS_GESTORA_D } from '@/shared/lib/recorridosGestoraD';
import { RECORRIDOS_GESTORA_E } from '@/shared/lib/recorridosGestoraE';
import { RECORRIDOS_GESTORA_F } from '@/shared/lib/recorridosGestoraF';
import { RECORRIDOS_GESTORA_G } from '@/shared/lib/recorridosGestoraG';

/*
  El cartel del recorrido en el móvil (testeo del 18/11, CRM#908): a 375 px, en
  Finanzas › Facturas, se salía por la derecha (71..411 y 129..469 px) y
  «Siguiente» quedaba fuera de la pantalla. La página era más ancha que la
  pantalla, así que `innerWidth` (481) no era lo que se veía (375).

  Ahora se mide lo que se VE (`visualViewport`): el cartel nunca pasa del ancho
  de la vista menos 32 px, en pantallas estrechas va pegado abajo (o arriba, si
  lo señalado está abajo) y sus botones quedan siempre dentro. Vale para todos
  los recorridos: el del tablero de Tareas usa el mismo componente.
*/

const VISTA = { width: 375, height: 667, offsetLeft: 0, offsetTop: 0 };
let original;

/** Un teléfono de 375 px con una página más ancha (481 px) que la pantalla. */
function comoMovil() {
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: 481 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: 667 });
  Object.defineProperty(window, 'visualViewport', {
    configurable: true,
    value: { ...VISTA, addEventListener: vi.fn(), removeEventListener: vi.fn() },
  });
}

/** Lo que se señala, a 129 px de la izquierda (como en Facturas). */
function objetivo(nombre, caja) {
  const el = document.createElement('div');
  el.setAttribute('data-recorrido', nombre);
  const ancho = caja.width ?? 120;
  el.getBoundingClientRect = () => ({ x: caja.left, y: caja.top, height: 30, ...caja, width: ancho, right: caja.left + ancho, bottom: caja.top + 30, toJSON() {} });
  el.scrollIntoView = () => {};
  document.body.appendChild(el);
  return el;
}

/** El cartel cabe en lo que se ve, y sus botones con él. */
function cabeEnLaVista() {
  const cartel = screen.getByRole('dialog');
  const izq = parseFloat(cartel.style.left);
  const ancho = parseFloat(cartel.style.width);
  expect(izq).toBeGreaterThanOrEqual(MARGEN_CARTEL);
  expect(izq + ancho).toBeLessThanOrEqual(VISTA.width - MARGEN_CARTEL);
  expect(ancho).toBeLessThanOrEqual(VISTA.width - 32);
  expect(cartel.style.maxWidth).toBe('calc(100vw - 32px)');
  const arriba = parseFloat(cartel.style.top);
  expect(arriba).toBeGreaterThanOrEqual(MARGEN_CARTEL);
  // Los botones van dentro del cartel: si el cartel se ve, se pueden pulsar.
  expect(within(cartel).getByRole('button', { name: /Siguiente|Entendido/ })).toBeInTheDocument();
  return { izq, ancho, arriba };
}

beforeEach(() => {
  original = { w: window.innerWidth, h: window.innerHeight, vv: Object.getOwnPropertyDescriptor(window, 'visualViewport') };
  localStorage.clear();
  document.body.innerHTML = '';
});
afterEach(() => {
  cleanup();
  Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: original.w });
  Object.defineProperty(window, 'innerHeight', { configurable: true, writable: true, value: original.h });
  if (original.vv) Object.defineProperty(window, 'visualViewport', original.vv);
  else delete window.visualViewport;
});

describe('dónde va el cartel (colocarCartel)', () => {
  it('a 375 px, dentro de la vista y pegado abajo, aunque lo señalado esté a la derecha', () => {
    const c = colocarCartel({ w: 375, h: 667, x: 0, y: 0 }, { left: 129, top: 120, bottom: 150 }, 200);
    expect(c.izquierda).toBe(16);
    expect(c.izquierda + c.ancho).toBeLessThanOrEqual(375 - 16);
    expect(c.arriba).toBe(667 - 16 - 200);
  });

  it('a 375 px, si lo señalado está en la mitad de abajo, el cartel va arriba', () => {
    const c = colocarCartel({ w: 375, h: 667, x: 0, y: 0 }, { left: 20, top: 500, bottom: 530 }, 200);
    expect(c.arriba).toBe(16);
  });

  it('con la vista desplazada (zoom o página más ancha), sigue dentro de lo que se ve', () => {
    const c = colocarCartel({ w: 375, h: 667, x: 106, y: 40 }, { left: 300, top: 120, bottom: 150 }, 200);
    expect(c.izquierda).toBeGreaterThanOrEqual(106 + 16);
    expect(c.izquierda + c.ancho).toBeLessThanOrEqual(106 + 375 - 16);
  });

  it('en escritorio, junto a lo que señala, como siempre', () => {
    const c = colocarCartel({ w: 1280, h: 800, x: 0, y: 0 }, { left: 400, top: 100, bottom: 130 }, 200);
    expect(c).toEqual({ izquierda: 400, arriba: 142, ancho: 340 });
  });

  it('en escritorio, pegado al borde derecho, no se sale', () => {
    const c = colocarCartel({ w: 1280, h: 800, x: 0, y: 0 }, { left: 1200, top: 100, bottom: 130 }, 200);
    expect(c.izquierda + c.ancho).toBeLessThanOrEqual(1280 - 16);
  });
});

describe('a 375 px, con la página más ancha que la pantalla', () => {
  it('el cartel de un recorrido de cobros cabe y «Siguiente» se ve', () => {
    comoMovil();
    objetivo('factura-anular', { left: 129, top: 200 });
    render(<RecorridoGuiado clave="movil-1" alCerrar={() => {}} pasos={[
      { donde: '[data-recorrido="factura-anular"]', titulo: 'Anular con su motivo', texto: 'Pulsa «Anular».' },
      { titulo: 'Y listo', texto: 'Fin.' },
    ]} />);
    expect(screen.getByRole('dialog', { name: 'Anular con su motivo' })).toBeInTheDocument();
    cabeEnLaVista();
  });

  it('el del tablero de Tareas también (es el mismo componente)', () => {
    comoMovil();
    for (const p of PASOS_TABLERO.filter((x) => x.donde)) {
      const nombre = /data-recorrido="([a-z]+)"/.exec(p.donde)?.[1];
      if (nombre) objetivo(nombre, { left: 300, top: 150 });
    }
    render(<RecorridoGuiado pasos={PASOS_TABLERO} clave={CLAVE_RECORRIDO_TABLERO} alCerrar={() => {}} />);
    cabeEnLaVista();
    // El segundo paso señala algo a 300 px: antes, el cartel empezaba ahí.
    fireEvent.click(screen.getByRole('button', { name: /Siguiente/ }));
    const { izq } = cabeEnLaVista();
    expect(izq).toBe(MARGEN_CARTEL);
  });
});

/*
  Testeo del 18/11 (ISEIE#586): en ISEIE también fallaba en Pagos Stripe (el cartel
  llegaba a 466 px en una pantalla de 375). Se recorren TODOS los recorridos, paso
  a paso, a 375 px con la página a 481: lo señalado a la derecha, abajo o más ancho
  que la pantalla (una tabla), y en cada paso el cartel cabe y su botón se ve.
*/
const TODOS = [
  ...Object.values(RECORRIDOS_COBROS).map((r) => [r.id, pasosPara(r, () => true)]),
  // Los de «Ver cómo funciona» para probar staging (#522), encendidos y apagados.
  ...Object.values(RECORRIDOS_DE_PRUEBA).map((r) => [`prueba ${r.id}`, pasosDePruebaPara(r, () => true)]),
  ...Object.values(RECORRIDOS_DE_PRUEBA).map((r) => [`prueba ${r.id} (apagada)`, pasosApagada(r)]),
  ['tablero de Tareas', PASOS_TABLERO],
];

describe('a 375 px, todos los recorridos, paso a paso', () => {
  it('entre ellos, el de Ventas (#619, gemela de CRM#941), con todos sus pasos', () => {
    const ventas = TODOS.find(([id]) => id === 'ventas');
    expect(ventas).toBeTruthy();
    expect(ventas[1]).toHaveLength(RECORRIDOS_COBROS.ventas.pasos.length);
  });

  it('entre ellos, los once del bloque Finanzas (#619, las tres tandas), con todos sus pasos', () => {
    for (const r of Object.values(RECORRIDOS_FINANZAS)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, los cuatro de las novedades del 18/11 (#611, tanda A), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_NOVEDADES)).toEqual(['menu-bloques', 'hoy-dashboard', 'ventas-repetidas', 'venta-cuotas']);
    for (const r of Object.values(RECORRIDOS_NOVEDADES)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, los de las novedades del 18/11, tanda B (#611, gemela de CRM#928), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_NOVEDADES_B)).toEqual(['mi-factura', 'facturas-colaboradores', 'mi-campus', 'incidencias', 'prospectos']);
    for (const r of Object.values(RECORRIDOS_NOVEDADES_B)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, los del día a día de una gestora (#619, tanda C), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_GESTORA)).toEqual(['clientes', 'prospecto-ficha', 'cola-del-dia']);
    for (const r of Object.values(RECORRIDOS_GESTORA)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, los del día a día, segunda tanda (#619, tanda D), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_B)).toEqual(['seguimiento-fin-de-mes', 'whatsapp-conexion']);
    for (const r of Object.values(RECORRIDOS_GESTORA_B)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, los del día a día, tercera tanda (#619, tanda E; gemela de CRM#941), con todos sus pasos', () => {
    // Correos no: aquí la pantalla llega con #750, y su recorrido con ella.
    expect(Object.keys(RECORRIDOS_GESTORA_C)).toEqual([
      'whatsapp-banco', 'whatsapp-actividad',
      'consultas-alumnos', 'consultas-carga', 'consultas-tutores', 'consultas-metricas', 'consultas-respuestas',
    ]);
    for (const r of Object.values(RECORRIDOS_GESTORA_C)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, los del día a día, cuarta tanda (#619, tanda F), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_D)).toEqual(['tutores', 'proceso-comercial']);
    for (const r of Object.values(RECORRIDOS_GESTORA_D)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, lo que faltaba de Comercial (#619, tanda G), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_E)).toEqual(['convocatorias', 'revision-duplicados', 'buscar-duplicados', 'solicitud-admision']);
    for (const r of Object.values(RECORRIDOS_GESTORA_E)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, Captación y publicidad (#619, tanda H), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_F)).toEqual(['secuencias-email', 'formularios', 'widget-web', 'meta-ads']);
    for (const r of Object.values(RECORRIDOS_GESTORA_F)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it('entre ellos, el bloque Académico (#619, tanda I), con todos sus pasos', () => {
    expect(Object.keys(RECORRIDOS_GESTORA_G)).toEqual(['productos', 'cursos-pendientes', 'woocommerce', 'arbol-categorias', 'mis-cursos', 'sin-tutor']);
    for (const r of Object.values(RECORRIDOS_GESTORA_G)) {
      const fila = TODOS.find(([id]) => id === r.id);
      expect(fila, r.id).toBeTruthy();
      expect(fila[1]).toHaveLength(r.pasos.length);
    }
  });

  it.each(TODOS)('%s: el cartel cabe en cada paso y «Siguiente» se puede pulsar', (_id, pasos) => {
    comoMovil();
    const sitios = [
      { left: 300, top: 120 },              // a la derecha, como en Facturas
      { left: 260, top: 560 },              // abajo a la derecha
      { left: 0, top: 200, width: 466 },    // más ancho que la pantalla (Pagos Stripe)
      { left: 420, top: 300 },              // fuera de la vista, a la derecha
    ];
    pasos.forEach((p, i) => {
      const nombre = /data-recorrido="([a-z0-9-]+)"/.exec(p.donde || '')?.[1];
      if (nombre && !document.querySelector(p.donde)) objetivo(nombre, sitios[i % sitios.length]);
    });
    render(<RecorridoGuiado pasos={pasos} clave={`movil-${_id}`} alCerrar={() => {}} />);
    const vistos = [];
    for (let i = 0; i < pasos.length; i++) {
      cabeEnLaVista();
      vistos.push(document.getElementById('recorrido-titulo').textContent);
      const sig = screen.queryByRole('button', { name: /Siguiente/ });
      if (!sig) break;
      fireEvent.click(sig);
    }
    expect(vistos).toEqual(pasos.map((p) => p.titulo));
    expect(screen.getByRole('button', { name: 'Entendido' })).toBeInTheDocument();
  });
});
