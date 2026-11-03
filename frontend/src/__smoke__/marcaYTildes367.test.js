// @vitest-environment node
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { MARCA } from '@/shared/config/marca';

/**
 * #367 (gemela de diego-landaeta/CRM#534) · La marca y las tildes de lo que se ve.
 *
 * Manuel, 29/10, en el 360: arriba ponía «MultiCRM BETA» y la marca es la del
 * CRM (aquí, «CRM ISEIE», que estaba escrita a mano); y en el Dashboard salían «Lo que entro», «numeros», «Tu dia», «Distribucion»,
 * «Origenes», «mas», «Ultimos» y «reminders hoy».
 *
 * El candado: la marca sale de UNA constante (los dos ficheros que no pueden
 * importarla tienen que decir lo mismo), y los textos de la lista no vuelven.
 *
 * ANTES del arreglo no carga: no existía `marca.ts`.
 */

const RAIZ = path.resolve(__dirname, '..', '..');
const leer = (p) => fs.readFileSync(path.join(RAIZ, p), 'utf8');

/** Todo `src`, sin pruebas ni maquetas (`*-preview`), que no son pantallas del CRM. */
function fuentes(dir = 'src') {
  const abs = path.join(RAIZ, dir);
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((e) => {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) return /(^|\/)(test|__smoke__)$|-preview$/.test(rel) ? [] : fuentes(rel);
    return /\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name) ? [rel] : [];
  });
}

/** El fichero sin comentarios: lo que dicen los comentarios no se ve. */
const sinComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('la marca', () => {
  it('es la del CRM, no el nombre del proyecto', () => {
    expect(MARCA).toBe('CRM ISEIE');
  });

  it('ninguna pantalla escribe «MultiCRM» a mano', () => {
    const conMultiCRM = fuentes().filter((f) => /MultiCRM/.test(sinComentarios(leer(f))));
    expect(conMultiCRM).toEqual([]);
  });

  it('index.html, el manifiesto y la página sin conexión dicen lo mismo que la constante', () => {
    const html = leer('index.html');
    expect(html).toContain(`<title>${MARCA}</title>`);
    expect(html).toContain(`<meta name="apple-mobile-web-app-title" content="${MARCA}" />`);
    const manifiesto = JSON.parse(leer('public/manifest.webmanifest'));
    expect(manifiesto.name).toBe(MARCA);
    expect(manifiesto.short_name).toBe(MARCA);
    expect(leer('public/offline.html')).toContain(`<title>Sin conexión · ${MARCA}</title>`);
  });

  it('la pestaña, el acceso, el chat y el manual la toman de la constante', () => {
    for (const f of [
      // La cabecera y la página de contraseña llevan el logo, no el nombre.
      'src/App.jsx',
      'src/shared/pages/LoginPage.jsx',
      'src/modules/messages/components/ChatPanel.tsx',
      'src/modules/manual/pages/ManualPage.tsx',
    ]) {
      expect(leer(f), f).toMatch(/import \{ MARCA \} from '@\/shared\/config\/marca'/);
    }
  });
});

describe('las tildes de lo que se ve', () => {
  // Cada texto, tal como salía en pantalla. Se buscan en el código sin
  // comentarios: los nombres de variables (`numeros`, `dia`) no se tocan.
  const MAL = [
    'Lo que entro y lo que se hizo',
    'Los mismos numeros que Reportes',
    'Tu dia de hoy',
    'actividad del dia<',
    'Al dia con los seguimientos',
    'reminders hoy',
    ' mas pendientes',
    'Distribucion actual',
    'Origenes de los prospectos',
    'Numeros descargables',
    'Ultimos ',
    'Ultimas actualizaciones',
    'mas proximas a vencer',
    'no le enviara nada mas',
    'lo que mas rápido',
    'Cuentanos lo que pasa',
  ];

  it('ninguno de los de la lista vuelve a salir', () => {
    const encontrados = [];
    for (const f of fuentes()) {
      const s = sinComentarios(leer(f));
      for (const t of MAL) if (s.includes(t)) encontrados.push(`${f}: «${t.trim()}»`);
    }
    expect(encontrados).toEqual([]);
  });
});
