import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/*
  Los formularios, con el mismo formato (#106). La misma prueba que en
  MultiCRM, con las rutas de ISEIE (el usuario se edita en SettingsPage).

  Dos candados y un recuento.

  Los candados cierran lo que ya está unificado: una sola `inputClass` y un
  solo `Field` en todo el proyecto. Si mañana alguien vuelve a escribirse el
  suyo —que es como se llegó a 16 copias con 6 valores distintos— salta aquí.

  El recuento deja escrito lo que falta. Las etiquetas de los formularios que
  nombra el issue están puestas; en el resto del CRM quedan escritas a mano y
  con estilos distintos. No se migran todas de golpe: son ~80 ficheros y eso
  no hay quien lo revise.
*/

const SRC = resolve(__dirname, '..');

function ficheros(dir, acc = []) {
  for (const nombre of readdirSync(dir)) {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) {
      if (nombre === 'test' || nombre === '__smoke__' || nombre === 'node_modules') continue;
      ficheros(ruta, acc);
    } else if (/\.(tsx|jsx|ts)$/.test(nombre)) {
      acc.push(ruta);
    }
  }
  return acc;
}

const TODOS = ficheros(SRC).map((ruta) => ({
  ruta: ruta.replace(SRC, 'src').replace(/\\/g, '/'),
  texto: readFileSync(ruta, 'utf8'),
}));

// De Configuración, solo cuentan los dos diálogos de usuario, que son el
// formulario «Usuario» de la lista. Disponibilidad e Integraciones viven en el
// mismo fichero pero no son de la #106.
function delFormulario({ ruta, texto }) {
  if (ruta !== 'src/shared/pages/SettingsPage.jsx') return texto;
  const ini = texto.indexOf('function EditUserModal');
  const fin = texto.indexOf('function AvailabilitySection');
  if (ini < 0 || fin < 0) throw new Error('SettingsPage.jsx: no están los diálogos de usuario');
  return texto.slice(ini, fin);
}

// La lista de pendientes solo puede encoger: cada uno tiene que seguir teniendo
// su copia. Si alguien la quita, que lo quite también de aquí.
function sigueTeniendoCopia(PENDIENTES, patron) {
  return PENDIENTES.filter((r) => !patron.test(TODOS.find((x) => x.ruta === r)?.texto || ''));
}

describe('formato de los formularios (#106)', () => {
  it('la clase del campo se define en un solo sitio', () => {
    // `export { inputClass } from …` es un reenvío, no otra definición.
    const definen = TODOS
      .filter(({ texto }) => /^\s*(?:export\s+)?(?:const|let)\s+inputClass\s*=/m.test(texto))
      .map(({ ruta }) => ruta);
    // En ISEIE aún quedan copias (en MultiCRM ya se unificaron). Están todas
    // aquí: la lista solo puede encoger, nunca crecer.
    const PENDIENTES = [
      'src/modules/accounting/components/PayableDialog.tsx',
      'src/modules/accounting/components/PaymentDialog.tsx',
      'src/modules/accounts-payable/components/PayableDialog.tsx',
      'src/modules/accounts-payable/components/PaymentDialog.tsx',
      'src/modules/commissions/components/RulesDialog.tsx',
      'src/modules/conversions/components/PaymentDialog.tsx',
    ];
    expect(definen.filter((r) => !PENDIENTES.includes(r))).toEqual(['src/shared/lib/ui.ts']);
    expect(sigueTeniendoCopia(PENDIENTES, /^\s*(?:export\s+)?(?:const|let)\s+inputClass\s*=/m)).toEqual([]);
  });

  it('el envoltorio del campo se define en un solo sitio', () => {
    const definen = TODOS
      .filter(({ texto }) => /^\s*(?:export\s+default\s+)?function\s+Field\s*\(/m.test(texto))
      .map(({ ruta }) => ruta);
    // Igual que arriba: las copias que quedan en ISEIE, y que no salga ninguna más.
    const PENDIENTES = [
      'src/modules/change-requests/pages/ChangeRequestDetailPage.tsx',
    ];
    expect(definen.filter((r) => !PENDIENTES.includes(r))).toEqual(['src/shared/components/ui/Field.tsx']);
    expect(sigueTeniendoCopia(PENDIENTES, /^\s*(?:export\s+default\s+)?function\s+Field\s*\(/m)).toEqual([]);
  });

  it('los formularios que pedía Diego no tienen etiquetas sueltas', () => {
    // Los nueve del issue: prospecto, venta, factura, usuario, producto,
    // tutor, campos personalizados, plantillas de correo y secuencias.
    const NOMBRADOS = [
      'src/modules/leads/components/LeadFormDialog.tsx',
      'src/modules/conversions/components/ConversionDialog.tsx',
      'src/modules/sales/components/RegisterSaleDialog.tsx',
      'src/modules/invoices/pages/InvoiceCreatePage.tsx',
      'src/modules/invoices/components/FiscalDataDialog.tsx',
      'src/shared/pages/SettingsPage.jsx',
      'src/modules/products/components/ProductFormDialog.tsx',
      'src/modules/tutores/pages/TutoresPage.tsx',
      'src/modules/email-templates/pages/EmailTemplatesPage.tsx',
    ];
    // Lo que tiene que coincidir es el tamaño y el espaciado. Un énfasis
    // puntual —la etiqueta del aviso de proyecto va en `text-info` porque
    // vive dentro de un recuadro de color— no rompe la uniformidad; un
    // tamaño distinto sí.
    const ESQUELETO = ['mb-1.5', 'block', 'px-1', 'text-secundario'];
    const sueltas = [];
    for (const ruta of NOMBRADOS) {
      const f = TODOS.find((x) => x.ruta === ruta);
      if (!f) { sueltas.push(`${ruta}: no existe`); continue; }
      for (const m of delFormulario(f).matchAll(/<label className="([^"{}]+)"/g)) {
        const clases = m[1].split(/\s+/);
        // Las que envuelven una casilla llevan `flex` y no son etiquetas de campo.
        if (clases.includes('flex') || clases.includes('inline-flex')) continue;
        const falta = ESQUELETO.filter((c) => !clases.includes(c));
        if (falta.length) sueltas.push(`${ruta}: le falta ${falta.join(' ')} — ${m[1]}`);
      }
    }
    expect(sueltas).toEqual([]);
  });

  // Lo que faltaba de la lista de Diego (revisado el 06/10): los dos formularios
  // que no cubría la prueba de arriba (campos personalizados y secuencias), y dos
  // de sus cuatro puntos en todos los de la lista: «que en móvil los campos se
  // apilen» y «que el error diga qué falta… no "Error"».
  const DE_LA_LISTA = [
    'src/modules/leads/components/LeadFormDialog.tsx',
    'src/modules/conversions/components/ConversionDialog.tsx',
    'src/modules/sales/components/RegisterSaleDialog.tsx',
    'src/modules/invoices/pages/InvoiceCreatePage.tsx',
    'src/shared/pages/SettingsPage.jsx',
    'src/modules/products/components/ProductFormDialog.tsx',
    'src/modules/tutores/pages/TutoresPage.tsx',
    'src/modules/field-definitions/pages/FieldDefinitionsPage.tsx',
    'src/modules/email-templates/pages/EmailTemplatesPage.tsx',
    'src/modules/email-sequences/pages/EmailSequencesPage.tsx',
  ];
  const deLaLista = () => DE_LA_LISTA.map((ruta) => {
    const f = TODOS.find((x) => x.ruta === ruta);
    if (!f) throw new Error(`${ruta}: no existe`);
    return { ruta, texto: delFormulario(f) };
  });
  const lineas = (texto) => texto.split(/\r?\n/);

  it('campos personalizados y secuencias, con Field e inputClass como los demás', () => {
    for (const ruta of [
      'src/modules/field-definitions/pages/FieldDefinitionsPage.tsx',
        'src/modules/email-sequences/pages/EmailSequencesPage.tsx',
    ]) {
      const f = TODOS.find((x) => x.ruta === ruta);
      expect(f.texto, ruta).toMatch(/<Field\b/);
      expect(f.texto, ruta).toMatch(/inputClass/);
    }
  });

  it('en el móvil, las filas de campos se apilan: nada de grid-cols-2 sin sm:', () => {
    // No cuentan el botón doble «Cliente existente / nuevo» de la venta, que no
    // es una fila de campos, ni las tablas de conceptos (grid-cols-12).
    const SIN_APILAR = /(^|[\s"'`])grid-cols-[2-6](?=[\s"'`])/;
    const CON_PUNTO_DE_CORTE = /\b(sm|md|lg):grid-cols-/;
    const malas = [];
    for (const { ruta, texto } of deLaLista()) {
      lineas(texto).forEach((l, i) => {
        if (SIN_APILAR.test(l) && !CON_PUNTO_DE_CORTE.test(l) && !l.includes('rounded-lg grid grid-cols-2 gap-1')) {
          malas.push(`${ruta}:${i + 1}`);
        }
      });
    }
    expect(malas).toEqual([]);
  });

  it('los avisos dicen qué ha fallado, no solo «Error»', () => {
    const malas = [];
    for (const { ruta, texto } of deLaLista()) {
      lineas(texto).forEach((l, i) => {
        if (/title:\s*['"]Error['"]/.test(l)) malas.push(`${ruta}:${i + 1}`);
      });
    }
    expect(malas).toEqual([]);
  });

  // Visto en la prueba a mano (17/10): la opción vacía de cada desplegable lo
  // decía de una forma («— elegir factura —», «— Selecciona —», «Seleccionar...»).
  // Todas con «Elige …» y sin guiones, como en MultiCRM.
  it('ningún texto entre guiones en los formularios: la opción vacía dice «Elige …»', () => {
    const ENTRE_GUIONES = /(['"`])\s*[—-]\s+[^'"`]*?\s+[—-]\s*\1/;
    const malas = [];
    const otros = ['src/modules/invoices/components/FiscalDataDialog.tsx',
      'src/modules/field-definitions/components/CustomFieldRenderer.tsx']
      .map((ruta) => ({ ruta, texto: TODOS.find((x) => x.ruta === ruta).texto }));
    for (const { ruta, texto } of [...deLaLista(), ...otros]) {
      lineas(texto).forEach((l, i) => {
        if (ENTRE_GUIONES.test(l) || /label: ['"]Seleccionar\.\.\.['"]/.test(l)) malas.push(`${ruta}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(malas).toEqual([]);
  });

  // Visto en la prueba a mano (17/10): el navegador sacaba su burbuja con lo
  // escrito otras veces. Ningún desplegable que no sea del CRM: cada casilla
  // de texto lleva autoComplete (como en MultiCRM).
  it('ninguna casilla de texto deja al navegador autocompletar', () => {
    const SIN = /type=(?:"|\{?')(?:checkbox|radio|hidden|file|date|password|color|range)/;
    const otros = [
      'src/modules/leads/components/lead-detail/LeadInfoCard.tsx',
      'src/modules/leads/components/ProductCombobox.tsx',
      'src/modules/invoices/components/FiscalDataDialog.tsx',
      'src/modules/field-definitions/components/CustomFieldRenderer.tsx',
      'src/modules/tutores/components/BuscadorCurso.tsx',
    ].map((ruta) => ({ ruta, texto: TODOS.find((x) => x.ruta === ruta).texto }));
    const malas = [];
    for (const { ruta, texto } of [...deLaLista(), ...otros]) {
      for (const m of texto.matchAll(/<(input|textarea)\b/g)) {
        const etiqueta = texto.slice(m.index, texto.indexOf('/>', m.index));
        if (!etiqueta.includes('autoComplete') && !SIN.test(etiqueta)) {
          malas.push(`${ruta}:${texto.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(malas).toEqual([]);
  });

  it('deja escrito cuántas etiquetas sueltas quedan en el resto del CRM', () => {
    const CANON = 'mb-1.5 block px-1 text-secundario text-muted-foreground';
    const estilos = new Map();
    let total = 0;
    for (const { ruta, texto } of TODOS) {
      for (const m of texto.matchAll(/<label className="([^"{}]+)"/g)) {
        const clases = m[1];
        if (/\bflex\b/.test(clases) || clases === CANON) continue;
        const clave = clases.split(/\s+/).sort().join(' ');
        estilos.set(clave, (estilos.get(clave) || 0) + 1);
        total += 1;
      }
    }
    const ordenados = [...estilos.entries()].sort((a, b) => b[1] - a[1]);
    console.log('\netiquetas de formulario sin unificar (tarea que sigue abierta):');
    for (const [clases, n] of ordenados.slice(0, 8)) {
      console.log(`  ${String(n).padStart(4)}  ${clases.slice(0, 90)}`);
    }
    console.log(`  ${String(total).padStart(4)}  TOTAL, en ${estilos.size} estilos distintos\n`);
    // Sin número fijo: es un recuento, no un límite. Lo que no puede es crecer
    // sin que nadie lo vea.
    expect(total).toBeGreaterThanOrEqual(0);
  });
});

// Los espacios con nombre de la #32 (16/10). El código de ISEIE ya usaba
// p-tarjeta, space-y-bloque y gap-tarjeta (el de `FilaCampos`), pero el
// tailwind.config.js no los definía: Tailwind no generaba esas clases y los
// campos de cada fila salían pegados, sin ningún aviso.
describe('los espacios con nombre de la #32', () => {
  it('cada espacio con nombre que usa el código está definido en tailwind.config.js', () => {
    const config = readFileSync(resolve(SRC, '..', 'tailwind.config.js'), 'utf8');
    const usados = new Set();
    for (const { texto } of TODOS) {
      for (const m of texto.matchAll(/\b(?:p|px|py|pt|pb|m|mt|mb|gap|gap-x|gap-y|space-y|space-x)-(bloque|tarjeta|fila)\b/g)) usados.add(m[1]);
    }
    expect(usados.size).toBeGreaterThan(0);
    for (const nombre of usados) {
      expect(config, `falta «${nombre}» en theme.extend.spacing`).toMatch(new RegExp(`\\b${nombre}:\\s*'[\\d.]+rem'`));
    }
  });
});
