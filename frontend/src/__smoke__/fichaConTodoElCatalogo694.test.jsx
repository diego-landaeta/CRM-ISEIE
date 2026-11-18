// @vitest-environment jsdom
// ISEIE no tiene un setup común de pruebas: el entorno, los matchers y la limpieza se ponen aquí.
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor, cleanup } from '@testing-library/react';

/*
  #694 · Diego, 11/11: «una prueba que recorra el catálogo entero y compruebe
  que cada clave sale en la ficha con su forma correcta para cada rol, también
  el tutor redactor. Sin esa prueba, el próximo permiso que añadamos no saldrá.»

  Se usa el catálogo y el resolver DEL SERVIDOR, tal cual: si mañana se añade
  una clave, un rol o una marca (`propia`, `requiere`, `nunca`…), esta prueba
  la recorre sin tocarla. Lo esperado se calcula aquí desde el catálogo crudo,
  no con la misma función que pinta la ficha.

    npx vitest run src/test/fichaConTodoElCatalogo694.test.jsx
*/

const api = vi.hoisted(() => ({ getCatalogo: vi.fn(), getFicha: vi.fn(), guardarExcepciones: vi.fn(), cambiarRolAMedida: vi.fn() }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/shared/components/ui/portal', () => ({ default: ({ children }) => children }));
vi.mock('@/modules/permissions/api/permissions.api', () => api);

const { ACCIONES, ROLES_FIJOS, SECCIONES, catalogoParaPantalla, dependencias, vetada } = await import('../../../backend/src/modules/permissions/catalogo.js');
const { resolverPermisos } = await import('../../../backend/src/modules/permissions/resolver.js');
const { default: ListaDePermisos } = await import('@/modules/permissions/components/ListaDePermisos');
const { default: PermisosDePersona } = await import('@/modules/permissions/components/PermisosDePersona');

const CATALOGO = catalogoParaPantalla();
const nombreRol = (r) => ROLES_FIJOS.find((x) => x.clave === r).nombre;
const nombreClave = (k) => ACCIONES.find((x) => x.clave === k).nombre;

/** Pinta la ficha de alguien, con todas las secciones abiertas. */
function pintar({ role, roles_extra = [], excepciones = {} }) {
  cleanup();
  const { mapa, origenes } = resolverPermisos({ role, roles_extra, excepciones });
  const utils = render(
    <ListaDePermisos catalogo={CATALOGO} mapa={mapa} origenes={origenes} excepciones={excepciones}
      puedeEditar onElegir={() => {}} role={role} />,
  );
  for (const s of CATALOGO.secciones) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${s.nombre}\\b`) }));
  const fila = (clave) => utils.container.querySelector(`li[data-clave="${clave}"]`);
  return { ...utils, mapa, fila };
}

/** Lo que es el permiso en sí, desde el catálogo crudo. */
function marcasEsperadas(x) {
  const m = [];
  if (x.propia) m.push('propia');
  if (x.independiente) m.push('independiente');
  if (dependencias(x.clave).length) m.push('requiere');
  if (x.soloPrincipal) m.push('soloPrincipal');
  return m.join(' ');
}

describe('#694 · la ficha enseña TODO el catálogo, con su forma, para cada rol', () => {
  it.each(ROLES_FIJOS.map((r) => r.clave))('%s', (role) => {
    const { fila, mapa } = pintar({ role });
    const filas = document.querySelectorAll('li[data-clave]');
    // Ni una de más ni una de menos: todo lo del catálogo, también lo que no tiene.
    expect(filas.length).toBe(ACCIONES.length);

    for (const x of ACCIONES) {
      const li = fila(x.clave);
      expect(li, `${role}: falta ${x.clave}`).not.toBeNull();
      expect(li.textContent).toContain(x.nombre);
      expect(li.getAttribute('data-marcas'), `${role} · ${x.clave}`).toBe(marcasEsperadas(x));

      const origen = within(li).getByText((_, el) => el?.getAttribute('data-forma') === 'origen');
      const si = within(li).getByRole('radio', { name: 'Sí' });

      if (role === 'superadmin') {
        expect(li.dataset.origen, x.clave).toBe('superadmin');
      } else if (vetada(x, role, [])) {
        // Bloqueada, a la vista y con el motivo: no escondida.
        expect(li.dataset.origen, `${role} · ${x.clave}`).toBe('nunca');
        expect(within(li).getByLabelText('Bloqueado')).toBeTruthy();
        expect(origen.textContent).toContain(nombreRol(role));
        expect(origen.textContent).toMatch(/^Bloqueado: .* no puede tenerlo/);
        expect(si).toBeDisabled();
        expect(si.getAttribute('title')).toBe(origen.textContent);
      } else if (x.roles.includes(role)) {
        expect(li.dataset.origen, `${role} · ${x.clave}`).toBe('rol');
        expect(origen.textContent).toBe(`Su rol: ${nombreRol(role)}`);
        expect(mapa[x.clave]).toBe(true);
      } else {
        expect(li.dataset.origen, `${role} · ${x.clave}`).toBe('ninguno');
        expect(mapa[x.clave]).toBe(false);
      }

      // «Requiere»: lo dice, y sin lo que necesita no deja dar el «Sí».
      const deps = dependencias(x.clave);
      if (deps.length) {
        const chip = within(li).getByText((_, el) => el?.getAttribute('data-forma') === 'requiere');
        for (const d of deps) expect(chip.textContent).toContain(nombreClave(d));
        const faltan = deps.filter((d) => !mapa[d]);
        if (role !== 'superadmin' && !vetada(x, role, []) && faltan.length) {
          expect(si, `${role} · ${x.clave}`).toBeDisabled();
          expect(si.getAttribute('title')).toMatch(/^Antes necesita: /);
        }
      }
    }

    // En el tablero, quién cierra una tarea con supervisor no es una casilla, y se explica.
    const nota = document.querySelector('li[data-nota="tasks"]');
    expect(nota?.textContent).toMatch(/supervisor/);
  });
});

describe('#694 · las formas que dependen de la persona', () => {
  it('por un rol de más: dice de qué rol le viene; lo de «solo rol principal» no lo suma', () => {
    const { fila } = pintar({ role: 'gestor', roles_extra: ['tutor'] });
    const misCursos = fila('tutores.mis_cursos');
    expect(misCursos.dataset.origen).toBe('rol_extra');
    expect(misCursos.textContent).toContain('Rol de más: Tutor');
    // Lo de su rol principal sigue siendo «su rol».
    expect(fila('leads.view').dataset.origen).toBe('rol');
    // WhatsApp lo trae su rol principal (gestora); el tutor de más no se lo quita.
    expect(fila('whatsapp.usar').dataset.origen).toBe('rol');
  });

  it('`nuncaPrincipal`: un tutor con un rol de más sigue bloqueado, y se dice que es por su rol principal', () => {
    const { fila } = pintar({ role: 'tutor', roles_extra: ['gestor'] });
    for (const k of ['whatsapp.usar', 'mcp.usar']) {
      expect(fila(k).dataset.origen, k).toBe('nunca');
      expect(fila(k).textContent).toContain('su rol principal (Tutor) no puede tenerlo');
    }
    // Lo de la gestora, por su rol de más.
    expect(fila('leads.view').dataset.origen).toBe('rol_extra');
    expect(fila('leads.view').textContent).toContain('Rol de más: Gestora');
  });

  it('excepciones suyas: dado y quitado a mano se ven distintos', () => {
    const { fila } = pintar({ role: 'gestor', excepciones: { 'leads.delete': true, 'leads.create': false } });
    expect(fila('leads.delete').dataset.origen).toBe('dado');
    expect(fila('leads.delete').textContent).toContain('Excepción suya: dado a mano');
    expect(fila('leads.create').dataset.origen).toBe('quitado');
    expect(fila('leads.create').textContent).toContain('Excepción suya: quitado a mano');
  });

  it('una excepción no salta el bloqueo: sigue bloqueada', () => {
    const { fila } = pintar({ role: 'colaborador', excepciones: { 'whatsapp.usar': true, 'mcp.usar': true } });
    expect(fila('whatsapp.usar').dataset.origen).toBe('nunca');
    expect(fila('mcp.usar').dataset.origen).toBe('nunca');
  });
});

describe('#694 · lo nuevo de la semana sale sin tocar la pantalla', () => {
  it('el tutor redactor: lo que trae de serie y lo que nunca puede tener', () => {
    const { fila } = pintar({ role: 'tutor_redactor' });
    for (const k of ['tasks.view_own', 'tasks.create', 'tasks.edit', 'facturas_colaborador.subir', 'tutores.mis_cursos', 'consultas.atender']) {
      expect(fila(k).dataset.origen, k).toBe('rol');
      expect(fila(k).textContent).toContain('Su rol: Tutor redactor');
    }
    expect(fila('consultas.atender').dataset.marcas).toBe('propia independiente');
    expect(fila('facturas_colaborador.subir').dataset.marcas).toContain('propia');
    for (const k of ['whatsapp.usar', 'mcp.usar']) expect(fila(k).dataset.origen, k).toBe('nunca');
  });

  it('WhatsApp y MCP, bloqueados para tutor, tutor redactor y colaborador (Diego, 12/11)', () => {
    for (const role of ['tutor', 'tutor_redactor', 'colaborador']) {
      const { fila } = pintar({ role });
      for (const k of ['whatsapp.usar', 'mcp.usar']) expect(fila(k).dataset.origen, `${role} · ${k}`).toBe('nunca');
    }
  });

  it('consultas, Mi campus, Moodle, tablero, links de pago y facturas de colaboradores están en la ficha', () => {
    const { fila } = pintar({ role: 'gestor' });
    const claves = [
      'consultas.atender', 'consultas.view', 'consultas.gestionar', 'tutores.mis_cursos', 'moodle.view', 'moodle.conectar',
      'tasks.view_own', 'tasks.create', 'tasks.edit', 'tasks.assign', 'tasks.manage', 'tasks.close',
      'links_pago.crear', 'links_pago.ver_todos', 'links_pago.configurar',
      'facturas_colaborador.subir', 'facturas_colaborador.ver_todas', 'facturas_colaborador.anular', 'facturas_colaborador.pagar',
    ];
    for (const k of claves) expect(fila(k), k).not.toBeNull();
    // Las del catálogo de verdad, no una lista de la prueba que se quede vieja.
    const todas = SECCIONES.flatMap((s) => s.recursos.flatMap((r) => r.acciones.map((a) => `${r.clave}.${a.accion}`)));
    for (const k of claves) expect(todas).toContain(k);
  });
});

describe('#694 · la ficha de verdad (PermisosDePersona) con el catálogo entero', () => {
  it('un tutor redactor, en su ficha: todo el catálogo y la nota del tablero', async () => {
    const { mapa, origenes } = resolverPermisos({ role: 'tutor_redactor' });
    api.getCatalogo.mockResolvedValue(CATALOGO);
    api.getFicha.mockResolvedValue({
      persona: { id: 9, nombre: 'Rita', email: 'r@x', role: 'tutor_redactor', roles_extra: [], active: true },
      mapa, origenes, excepciones: {}, rolAMedida: null, rolesAMedida: [], registro: [], puedeEditar: false,
    });
    cleanup();
    render(<PermisosDePersona userId={9} enLinea />);
    await waitFor(() => expect(screen.getByText(/Tutor redactor/)).toBeTruthy());
    expect(screen.getByText(new RegExp(`de ${ACCIONES.length}`))).toBeTruthy();
    for (const s of CATALOGO.secciones) fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${s.nombre}\\b`) }));
    expect(document.querySelectorAll('li[data-clave]').length).toBe(ACCIONES.length);
    expect(document.querySelector('li[data-clave="whatsapp.usar"]').dataset.origen).toBe('nunca');
    expect(document.querySelector('li[data-nota="tasks"]')).not.toBeNull();
  });
});
