import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * CRM#534, parte 4 · Prospectos abre con la lista.
 *
 * Manuel, 29/10: antes de llegar a la lista salían el último lead de cada
 * gestora, el ranking, «Lo que toca» y las cifras. Ahora:
 *   · pestañas «Lista» (la de entrada) y «Equipo»;
 *   · en «Equipo»: último lead, ranking, cifras y el resumen del día;
 *   · Diego, 18/11 (PR #883): «Lo que toca hoy y mañana» SE QUEDA en
 *     Prospectos, debajo de la lista, separado en «Hoy» y «Mañana» con su
 *     número; y el ranking SE QUEDA en Clientes.
 *
 * Como las demás pruebas de estas pantallas (#346, equipo comercial), se mira la
 * fuente: montar LeadsPage entera pide medio CRM de dobles.
 */

const leer = (f) => fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');
const prospectos = leer('modules/leads/pages/LeadsPage.tsx').replace(/\r\n/g, '\n');
// Lo que pinta la pantalla: empieza con el diálogo de alta.
const devuelve = prospectos.slice(prospectos.indexOf('<LeadFormDialog open={formOpen}'));

describe('Prospectos: la lista primero, los paneles en «Equipo»', () => {
  it('entra en «Lista» salvo que la URL pida ?vista=equipo', () => {
    expect(prospectos).toMatch(/searchParams\.get\('vista'\) === 'equipo' \? 'equipo' : 'lista'/);
    // La vista se escribe sobre la dirección real: si partiera del `prev` del
    // router, pisaría el filtro rápido escrito en el mismo clic (visto en local).
    expect(prospectos).toMatch(/new URLSearchParams\(window\.location\.search\)/);
    expect(devuelve).toMatch(/role="tablist" aria-label="Vista de prospectos"/);
    expect(devuelve).toMatch(/\['lista', 'Lista'\], \['equipo', 'Equipo'\]/);
  });

  it('los paneles van dentro de «Equipo» y ninguno antes de las pestañas', () => {
    const pestanas = devuelve.indexOf('role="tablist"');
    const equipo = devuelve.indexOf("{vista === 'equipo' && (");
    const lista = devuelve.indexOf("hidden={vista !== 'lista'}");
    expect(pestanas).toBeGreaterThan(0);
    expect(equipo).toBeGreaterThan(pestanas);
    expect(lista).toBeGreaterThan(equipo);
    for (const panel of ['<UltimoLeadAsignado', '<ComoVoy', '<CifrasProspectos', '<BloquePlegable', '<SaludComercial', '<SiguientesAcciones']) {
      const donde = devuelve.indexOf(panel);
      expect(donde, panel).toBeGreaterThan(equipo);
      expect(donde, panel).toBeLessThan(lista);
      // Una sola vez en la pantalla.
      expect(devuelve.indexOf(panel, donde + 1), panel).toBe(-1);
    }
  });

  it('pulsar una cifra o un estado en «Equipo» lleva a la lista', () => {
    expect(devuelve).toMatch(/onFiltroRapido=\{\(clave\) => \{ setQuickFilter\(clave \|\| ''\); irALaLista\(\); \}\}/);
    expect(devuelve).toMatch(/onFiltroEstado=\{\(v\) => \{ setFilterEstadoSafe\(v\); irALaLista\(\); \}\}/);
    expect(devuelve).toMatch(/onVerTodos=\{\(\) => \{ setQuickFilter\(''\); irALaLista\(\); \}\}/);
  });

  it('la lista se esconde, no se desmonta (no pierde página ni selección)', () => {
    expect(devuelve).toMatch(/<div hidden=\{vista !== 'lista'\}/);
    expect(devuelve).toMatch(/id="lista-de-prospectos"/);
  });
});

describe('«Lo que toca» y el ranking se quedan (Diego, 18/11, PR #883)', () => {
  it('«Lo que toca hoy y mañana» sigue en Prospectos, debajo de la lista y dentro de «Lista»', () => {
    const lista = devuelve.indexOf("hidden={vista !== 'lista'}");
    const tabla = devuelve.indexOf('id="lista-de-prospectos"');
    const toca = devuelve.indexOf('<LoQueTocaHoyYManana');
    const finLista = devuelve.indexOf('{/* /LA LISTA */}');
    expect(toca, 'no está en Prospectos').toBeGreaterThan(0);
    expect(toca).toBeGreaterThan(tabla);
    expect(toca).toBeGreaterThan(lista);
    expect(toca).toBeLessThan(finLista);
    // Una sola vez, y con el ámbito de arriba (campus o empresa).
    expect(devuelve.indexOf('<LoQueTocaHoyYManana', toca + 1)).toBe(-1);
    expect(devuelve).toMatch(/<LoQueTocaHoyYManana projectId=\{proyectoDeLaCola\} projectIds=\{campusCsv\}/);
    // El Dashboard conserva el suyo.
    expect(leer('shared/pages/DashboardPage.jsx')).toMatch(/<ParaHoyYManana/);
  });

  it('el ranking se queda en Clientes', () => {
    const clientes = leer('modules/clients/pages/ClientsPage.tsx');
    expect(clientes).toMatch(/import ComoVoy/);
    expect(clientes).toMatch(/<ComoVoy compacto \/>/);
  });
});
