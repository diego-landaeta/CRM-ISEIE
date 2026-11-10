import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * #423, fase 4 · Ninguna ruta se protege con una comprobación de rol a mano.
 *
 * - En los módulos no queda ni un `roleGuard`, `soloRoles`, `checkPermission`
 *   ni `rolOPermiso`: cada ruta lleva su `puede('clave')`.
 * - Las comparaciones de rol que quedan (`role === …`, `tieneRol(…)`) son de
 *   ALCANCE —sobre qué datos: la gestora ve los suyos, el superadmin todos los
 *   campus— o de COMPORTAMIENTO —qué se pinta o cómo se calcula—, nunca de
 *   «quién entra». Están contadas aquí, fichero por fichero, con su porqué. Si
 *   aparece una nueva, esta prueba falla: o es alcance y se apunta, o es un
 *   permiso y va al catálogo.
 */

const MODULOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/modules');

const GUARDIAS_VIEJOS = /\b(roleGuard|soloRoles|checkPermission|rolOPermiso)\(/;
const COMPARA_ROL = /role\b\s*(===|!==)|\.includes\([a-zA-Z_.?]*\.role\)|tieneRol\(|esSuperadmin\(/;

/** Lo que queda, y por qué no es un permiso. */
const DECLARADAS = {
  'auth/auth.model.js': [1, 'alcance: los campus que ve el superadmin'],
  'auth/auth.service.js': [1, 'comportamiento: la clave de webhook solo se enseña a admin'],
  // Cursos pendientes (#336) todavia no tiene claves en el catalogo de #423: quien crea, modifica, publica
  // y supervisa se decide POR ROL dentro del servicio, no con `puede(...)`. Es deuda declarada, no alcance:
  // el dia que haya `cursos_pendientes.*` en el catalogo, estas ocho comparaciones se quitan.
  'cursos-pendientes/cursos-pendientes.controller.js': [1, 'permiso por rol, sin clave en el catalogo todavia: la tutora ve solo lo suyo'],
  'cursos-pendientes/cursos-pendientes.service.js': [7, 'permiso por rol, sin clave en el catalogo todavia: quien crea, modifica, publica y supervisa'],
  'reports/report.controller.js': [2, 'comportamiento: el baremo general de la tasa de cierre solo lo cambia un super admin'],
  'connectors/connectors.controller.js': [4, 'alcance: el superadmin ve los conectores de todos los campus'],
  'consultas/consultas.controller.js': [2, 'alcance: lo suyo de Consultas (su carga, sus alumnos, sus métricas) solo existe para un tutor'],
  'facturas-colaborador/facturas-colaborador.service.js': [1, 'alcance: el superadmin, todas las empresas'],
  'feedback/feedback.controller.js': [1, 'alcance: la gestora, sus prospectos'],
  'invoices/invoices.controller.js': [1, 'alcance: la gestora, sus facturas; filtrar por empresa'],
  'invoices/invoices.model.js': [2, 'alcance: superadmin, todas las facturas; admin, todas salvo si lleva un equipo comercial (#415)'],
  'leads/lead.model.js': [1, 'alcance: el resumen del día de la gestora'],
  'leads/lead.service.js': [2, 'alcance y comportamiento: interacciones propias; el reparto no da a tutores'],
  'mcp/mcp.acceso.js': [2, 'alcance: soloLoSuyo, lo que ve por el MCP quien no es admin; al super admin no le recorta el equipo comercial'],
  'mcp/mcp.actividad.js': [1, 'alcance: el superadmin ve la actividad de todos'],
  'mcp/mcp.controller.js': [4, 'alcance y avisos: soloLoSuyo, por qué un rol no se marca, campus'],
  'mcp/mcp.model.js': [2, 'alcance: personas y campus de quien pregunta'],
  'notifications/notifications.service.js': [1, 'alcance: qué avisos ve cada uno'],
  'proceso/proceso.ambito.js': [1, 'alcance: qué campus entran en la cola'],
  'sales/sales.goals.js': [1, 'alcance: la gestora, su meta; el superadmin, la de cualquier campus'],
  'sales/sales.service.js': [1, 'comportamiento: a quién se asigna la venta'],
  'soporte/soporte.controller.js': [1, 'alcance: quien administra (admin, soporte, superadmin) responde y ve los tickets de su alcance; el resto, los suyos'],
  // Diego, 26/10/2026: sobre CADA tarea, mover, comentar, aprobar y devolver son del superadmin, del supervisor y de
  // quien la lleva; el superadmin edita y borra comentarios de cualquiera. Es quién actúa sobre una tarea concreta,
  // no quién entra a una pantalla (eso sigue en el catálogo: tasks.*).
  'tasks/tasks.reglas.js': [5, 'alcance por tarea: el superadmin (y admin/superadmin como supervisor válido) en todas'],
  'tasks/tasks.service.js': [9, 'alcance: superadmin y soporte ven todas las empresas; por tarea, lo que el superadmin mueve, aprueba y borra'],
  'tutores/tutor.controller.js': [6, 'alcance: el tutor, lo suyo; fichas de sus campus'],
  'users/user.empresas.js': [1, 'comportamiento: la empresa entera solo le da campus a un admin (al colaborador, no)'],
  'users/user.controller.js': [5, 'alcance: contraseña solo de tutores de su campus; su foto y su vista'],
  'users/user.model.js': [1, 'comportamiento: la lista sin tutores'],
  'users/user.service.js': [7, 'protección: al superadmin no se le edita y su contraseña solo se la pone otro superadmin; freno de correos a tutores'],
  'users/user.validation.js': [3, 'comportamiento: qué campus pide cada rol al darlo de alta'],
  'users/user.views.controller.js': [1, 'alcance: su vista, o la de cualquiera el superadmin'],
  'webhook-tokens/token.controller.js': [1, 'alcance: el superadmin, los webhooks de todos los campus'],
  'webhooks-salientes/webhooks-salientes.controller.js': [2, 'alcance: el superadmin ve todos los campus'],
  'asignacion/asignacion.controller.js': [3, 'alcance: el superadmin ve todas las configuraciones de la asignación; la de todas las empresas, solo él'],
  'whatsapp/chat.controller.js': [2, 'alcance: supervisar solo a quien comparte campus'],
  'whatsapp/roles.js': [2, 'comportamiento: por qué un rol no tiene WhatsApp (el motivo que se enseña)'],
  'whatsapp/vozOTexto.js': [1, 'alcance: admin, superadmin y soporte ven a todas las gestoras; la gestora, solo a si misma'],
};

function ficheros(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'permissions' ? [] : ficheros(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

const sinComentarios = (l) => !/^\s*(\/\/|\*|\/\*)/.test(l);

describe('sin roles sueltos (#423)', () => {
  const todos = ficheros(MODULOS);

  it('ningún guardia de rol queda en los módulos', () => {
    const quedan = [];
    for (const f of todos) {
      fs.readFileSync(f, 'utf8').split(/\r?\n/).forEach((l, i) => {
        if (sinComentarios(l) && GUARDIAS_VIEJOS.test(l)) quedan.push(`${path.relative(MODULOS, f)}:${i + 1}`);
      });
    }
    expect(quedan).toEqual([]);
  });

  it('las comparaciones de rol que quedan están declaradas como alcance o comportamiento', () => {
    const cuenta = {};
    for (const f of todos) {
      const n = fs.readFileSync(f, 'utf8').split(/\r?\n/).filter((l) => sinComentarios(l) && COMPARA_ROL.test(l)).length;
      if (n) cuenta[path.relative(MODULOS, f).split(path.sep).join('/')] = n;
    }
    const declaradas = Object.fromEntries(Object.entries(DECLARADAS).map(([f, [n]]) => [f, n]));
    expect(cuenta).toEqual(declaradas);
  });
});
