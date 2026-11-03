import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';

/*
  Los formularios, con el mismo formato (#106). Gemela de la de MultiCRM.

  Dos candados y un recuento.

  Los candados cierran lo que ya está unificado: una sola `inputClass` y un
  solo `Field`. Si mañana alguien vuelve a escribirse el suyo —que es como se
  llegó a 16 copias con 6 valores distintos— salta aquí.

  EN ISEIE quedan copias locales en módulos que todavía no han pasado por la
  #106 (cobros, cuentas por pagar, comisiones, solicitudes de cambio). Van en
  una lista con nombre: la prueba no deja que aparezca ninguna NUEVA, y cuando
  se migre una hay que quitarla de la lista (si no, salta también).

  Los formularios que se miran son los de la #106 que existen en ISEIE con la
  misma forma: prospecto, producto, tutor, campos personalizados, plantillas
  de correo y secuencias. Venta, factura y usuario tienen aquí otra forma y se
  añaden a la lista cuando se porten.
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

// Las copias que quedan en ISEIE, en módulos aún sin pasar por la #106.
const INPUTCLASS_PENDIENTES = [
  'src/modules/accounting/components/PayableDialog.tsx',
  'src/modules/accounting/components/PaymentDialog.tsx',
  'src/modules/accounts-payable/components/PayableDialog.tsx',
  'src/modules/accounts-payable/components/PaymentDialog.tsx',
  'src/modules/commissions/components/RulesDialog.tsx',
  'src/modules/conversions/components/PaymentDialog.tsx',
];
const FIELD_PENDIENTES = [
  'src/modules/change-requests/pages/ChangeRequestDetailPage.tsx',
];

describe('formato de los formularios (#106)', () => {
  it('la clase del campo se define en un solo sitio (más las copias que quedan, sin crecer)', () => {
    // `export { inputClass } from …` es un reenvío, no otra definición.
    const definen = TODOS
      .filter(({ texto }) => /^\s*(?:export\s+)?(?:const|let)\s+inputClass\s*=/m.test(texto))
      .map(({ ruta }) => ruta)
      .sort();
    expect(definen).toEqual(['src/shared/lib/ui.ts', ...INPUTCLASS_PENDIENTES].sort());
  });

  it('el envoltorio del campo se define en un solo sitio (más las copias que quedan, sin crecer)', () => {
    const definen = TODOS
      .filter(({ texto }) => /^\s*(?:export\s+default\s+)?function\s+Field\s*\(/m.test(texto))
      .map(({ ruta }) => ruta)
      .sort();
    expect(definen).toEqual(['src/shared/components/ui/Field.tsx', ...FIELD_PENDIENTES].sort());
  });

  it('los formularios de la #106 no tienen etiquetas sueltas', () => {
    const NOMBRADOS = [
      'src/modules/leads/components/LeadFormDialog.tsx',
      'src/modules/products/components/ProductFormDialog.tsx',
      'src/modules/tutores/pages/TutoresPage.tsx',
      'src/modules/email-templates/pages/EmailTemplatesPage.tsx',
    ];
    // Lo que tiene que coincidir es el tamaño y el espaciado.
    const ESQUELETO = ['mb-1.5', 'block', 'px-1', 'text-secundario'];
    const sueltas = [];
    for (const ruta of NOMBRADOS) {
      const f = TODOS.find((x) => x.ruta === ruta);
      if (!f) { sueltas.push(`${ruta}: no existe`); continue; }
      for (const m of f.texto.matchAll(/<label className="([^"{}]+)"/g)) {
        const clases = m[1].split(/\s+/);
        // Las que envuelven una casilla llevan `flex` y no son etiquetas de campo.
        if (clases.includes('flex') || clases.includes('inline-flex')) continue;
        const falta = ESQUELETO.filter((c) => !clases.includes(c));
        if (falta.length) sueltas.push(`${ruta}: le falta ${falta.join(' ')} — ${m[1]}`);
      }
    }
    expect(sueltas).toEqual([]);
  });

  const DE_LA_LISTA = [
    'src/modules/leads/components/LeadFormDialog.tsx',
    'src/modules/products/components/ProductFormDialog.tsx',
    'src/modules/tutores/pages/TutoresPage.tsx',
    'src/modules/field-definitions/pages/FieldDefinitionsPage.tsx',
    'src/modules/email-templates/pages/EmailTemplatesPage.tsx',
    'src/modules/email-sequences/pages/EmailSequencesPage.tsx',
  ];
  const deLaLista = () => DE_LA_LISTA.map((ruta) => {
    const f = TODOS.find((x) => x.ruta === ruta);
    if (!f) throw new Error(`${ruta}: no existe`);
    return f;
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
    const SIN_APILAR = /(^|[\s"'`])grid-cols-[2-6](?=[\s"'`])/;
    const CON_PUNTO_DE_CORTE = /\b(sm|md|lg):grid-cols-/;
    const malas = [];
    for (const { ruta, texto } of deLaLista()) {
      lineas(texto).forEach((l, i) => {
        if (SIN_APILAR.test(l) && !CON_PUNTO_DE_CORTE.test(l)) {
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

  // La opción vacía de cada desplegable, con «Elige …» y sin guiones.
  it('ningún texto entre guiones en los formularios: la opción vacía dice «Elige …»', () => {
    const ENTRE_GUIONES = /(['"`])\s*[—-]\s+[^'"`]*?\s+[—-]\s*\1/;
    const malas = [];
    const rutas = [...DE_LA_LISTA,
      'src/modules/field-definitions/components/CustomFieldRenderer.tsx'];
    for (const ruta of rutas) {
      const f = TODOS.find((x) => x.ruta === ruta);
      lineas(f.texto).forEach((l, i) => {
        if (ENTRE_GUIONES.test(l) || /label: ['"]Seleccionar\.\.\.['"]/.test(l)) malas.push(`${ruta}:${i + 1}: ${l.trim()}`);
      });
    }
    expect(malas).toEqual([]);
  });

  // El navegador sacaba su burbuja con lo escrito otras veces. Cada casilla de
  // texto lleva autoComplete.
  it('ninguna casilla de texto deja al navegador autocompletar', () => {
    const SIN = /type=(?:"|\{?')(?:checkbox|radio|hidden|file|date|password|color|range)/;
    const rutas = [...DE_LA_LISTA,
      'src/modules/leads/components/lead-detail/LeadInfoCard.tsx',
      'src/modules/leads/components/ProductCombobox.tsx',
      'src/modules/field-definitions/components/CustomFieldRenderer.tsx',
      'src/modules/product-categories/components/CascadaDeCategorias.tsx',
      'src/modules/tutores/components/BuscadorCurso.tsx',
      'src/shared/components/ui/BuscadorEnLista.tsx'];
    const malas = [];
    for (const ruta of rutas) {
      const { texto } = TODOS.find((x) => x.ruta === ruta);
      for (const m of texto.matchAll(/<(input|textarea)\b/g)) {
        const etiqueta = texto.slice(m.index, texto.indexOf('/>', m.index));
        if (!etiqueta.includes('autoComplete') && !SIN.test(etiqueta)) {
          malas.push(`${ruta}:${texto.slice(0, m.index).split('\n').length}`);
        }
      }
    }
    expect(malas).toEqual([]);
  });
});
