// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import fs from 'fs';
import path from 'path';

/*
  CRM-ISEIE#611, tanda B (gemela de CRM#928 / CRM#1010; Diego, 19/11: «es un
  tutorial guiado de la app, como el del tablero»): «Ver recorrido» en las
  novedades del 18/11 que no son de la primera tanda: «Mi factura» y validar,
  «Mi campus», Incidencias y Prospectos con sus filtros. La misma prueba que en
  el 360, con lo que en ISEIE es distinto: «Mis cursos y comisiones» es un enlace
  de la cabecera de Mi campus (no una pestaña), y Prospectos no tiene filtro de
  campus dentro de «Filtros» (no hay empresas; el campus se elige en el menú).

  Se comprueba que están los cinco, que cada pantalla ofrece el suyo, y se pintan
  de verdad con datos en los que sale todo para recorrerlas enteras. Lo que solo
  ve un rol (validar, apuntar una incidencia) se salta sin su permiso. Que cada
  anclaje sigue en el código y que los permisos existen lo comprueba
  `recorridosCobros.test.jsx` (estos se suman a `RECORRIDOS_COBROS`); que el
  cartel cabe a 375 px, paso a paso, `recorridoEnMovil.test.jsx`.
*/

const { permisos, rol, ambito, api } = vi.hoisted(() => ({
  permisos: new Set(),
  rol: { current: 'admin' },
  ambito: { current: null },
  api: {
    mias: vi.fn(), empresas: vi.fn(), mes: vi.fn(), colaboradores: vi.fn(), vista: vi.fn(), costePorCampus: vi.fn(),
    miCampus: vi.fn(), listar: vi.fn(), metricas: vi.fn(), personas: vi.fn(),
  },
}));

vi.mock('@/contexts/AuthContext', () => ({ useAuth: () => ({ user: { id: 41, role: rol.current } }) }));
vi.mock('@/contexts/ProjectContext', () => ({ useProjectContext: () => ambito.current }));
vi.mock('@/shared/hooks/usePermission', () => ({ default: () => ({ can: (k) => permisos.has(k) }) }));
vi.mock('@/shared/hooks/useToast', () => ({ toast: vi.fn() }));
vi.mock('@/modules/facturas-colaborador/api/facturasColaborador.api', async (original) => ({
  ...(await original()),
  facturasColaboradorApi: api,
}));
vi.mock('@/modules/tutores/api/tutores.api', async (original) => ({
  ...(await original()),
  tutoresApi: { miCampus: (...a) => api.miCampus(...a) },
}));
vi.mock('@/modules/incidencias/api/incidencias.api', async (original) => ({
  ...(await original()),
  incidenciasApi: { listar: (...a) => api.listar(...a), metricas: (...a) => api.metricas(...a), personas: (...a) => api.personas(...a) },
}));

const { RECORRIDOS_NOVEDADES_B } = await import('@/shared/lib/recorridosNovedadesB');
const { RECORRIDOS_COBROS, claveRecorrido, pasosPara } = await import('@/shared/lib/recorridosCobros');
const { default: MiFacturaPage } = await import('@/modules/facturas-colaborador/pages/MiFacturaPage');
const { default: FacturasColaboradoresPage } = await import('@/modules/facturas-colaborador/pages/FacturasColaboradoresPage');
const { default: MiCampusPage } = await import('@/modules/tutores/pages/MiCampusPage');
const { default: IncidenciasPage } = await import('@/modules/incidencias/pages/IncidenciasPage');

const SRC = path.resolve(__dirname, '..');

const empresa = { razon_social: 'CEDIA Investigación y Desarrollo SL', nif: null, direccion: null, cp: null, ciudad: null, pais: null, logo_url: null };
const mesDe = (id, extra = {}) => ({
  id, estado: 'abierto', periodo: '2026-10', mes: 'octubre de 2026', colaborador: 'Laura', empresa,
  importe_acordado: 600, moneda: 'EUR', caduca_at: null, cobro: null, recibida: null, pago: null, enlace: null, ...extra,
});
const filaFactura = (extra = {}) => ({
  id: 41, colaborador_id: 3, issuer_id: 7, periodo: '2026-10', colaborador_nombre: 'Lucía', email: 'lucia@x.test', area: 'otra',
  tipo: 'vendedora', empresa: 'CEDIA Investigación y Desarrollo SL', importe_esperado: null, importe: '412.50', moneda: 'EUR',
  diferencia: null, numero_factura: 'A-10', numero_recepcion: 'REC-2026-10-0001', subida_at: '2026-11-02T10:00:00Z',
  enviado_at: null, abierto_at: null, caduca_at: null, anulada_at: null, motivo_anulacion: null, nombre_original: 'a.pdf', tamano: 10,
  base: null, total: null, horas: null, cuadra: true, importe_pdf: '412.50', mime: 'application/pdf',
  pagada_at: null, forma_pago: null, referencia_pago: null, con_justificante: false, validada_at: null, estado: 'recibida',
  ...extra,
});
const alumno = (id, nombre) => ({ id, nombre, email: null, ultimoAcceso: new Date().toISOString(), progreso: 40, mensajeUrl: '#' });
const MI_CAMPUS = {
  leidoAt: new Date().toISOString(),
  pendientes: [{ id: 1, nombre: 'Curso nuevo', tipo: 'curso', estado: 'en_desarrollo', campus: 'Fono', fechaComprometida: null, avance: { foto: true, video: false, modulos: 20 } }],
  sinConectar: [{ projectId: 4, campus: 'ISEIH', motivo: 'Tu correo no está en su Moodle.' }],
  campus: [{
    projectId: 3, campus: 'Fono', url: '#', error: null, dudasSinCurso: [],
    cursos: [{
      id: 30, nombre: 'Curso A', url: '#', error: null, seguimiento: true, avisoProgreso: null,
      alumnos: [alumno(900, 'Ana Alumna')],
      dudas: [{ consultaId: 1, alumnoId: 900, alumno: 'Ana Alumna', desde: null }],
      tareas: [{ id: 77, nombre: 'Tarea 1', entrega: null, corregirUrl: '#', sinCorregir: [{ alumnoId: 900, alumno: 'Ana Alumna', entregadaAt: null }] }],
    }],
  }],
};
const INCIDENCIA = {
  id: 5, estado: 'open', gravedad: 'medium', tipos: ['capa8'], quePaso: 'Se cobró dos veces la matrícula', ocurrioAt: '2026-11-18T10:00:00Z',
  projectName: 'Psiko Aprende', sociedadName: null, crm: 'multicrm', causadaPorId: 41, causadaPorNombre: 'Marta Gestora',
  entidadTipo: null, entidadId: null,
};
const CIFRAS = {
  total: 1,
  porPersona: [{ userId: 41, nombre: 'Marta Gestora', capa8: 1, fallo_crm: 0, dato_mal: 0, externo: 0, total: 1 }],
  porTipo: [{ tipo: 'capa8', total: 1 }],
  porMes: [{ mes: '2026-11', capa8: 1, fallo_crm: 0, dato_mal: 0, externo: 0, total: 1 }],
};

/** Recorre el recorrido abierto pulsando «Siguiente» y devuelve los títulos vistos. */
function recorrer(n) {
  const vistos = [];
  for (let i = 0; i < n + 2; i++) {
    const titulo = document.getElementById('recorrido-titulo');
    vistos.push(titulo.textContent);
    const sig = within(titulo.closest('[role="dialog"]')).queryByRole('button', { name: /Siguiente/ });
    if (!sig) break;
    fireEvent.click(sig);
  }
  return vistos;
}
const titulos = (id, fuera = []) => RECORRIDOS_NOVEDADES_B[id].pasos.map((p) => p.titulo).filter((t) => !fuera.includes(t));
const pintar = (Pantalla, ruta = '/') => render(<MemoryRouter initialEntries={[ruta]}><Pantalla /></MemoryRouter>);

beforeEach(() => {
  localStorage.clear();
  permisos.clear();
  rol.current = 'admin';
  ambito.current = { activeIssuerId: 7, isAllProjects: true, activeProject: null, projects: [] };
  for (const f of Object.values(api)) f.mockReset();
  api.mias.mockResolvedValue({
    data: [
      mesDe(1),
      mesDe(2, { estado: 'recibida', recibida: { numero_recepcion: 'REC-1', importe: 600, cuadra: true }, validada: false }),
    ],
  });
  api.empresas.mockResolvedValue({ data: [{ id: 7, razon_social: 'CEDIA Investigación y Desarrollo SL' }] });
  api.colaboradores.mockResolvedValue({ data: [] });
  api.costePorCampus.mockResolvedValue({ data: { campus: [] } });
  api.mes.mockResolvedValue({ data: { periodo: '2026-10', mes: 'octubre de 2026', facturas: [filaFactura()], resumen: { total: 1, recibidas: 1, importe_recibido: 412.5, importe_acordado: 0 } } });
  api.vista.mockResolvedValue({ data: { vista: 'por_validar', resumen: { total: 1, importe: 412.5, pendiente: 412.5 }, facturas: [filaFactura()] } });
  api.miCampus.mockResolvedValue({ success: true, data: MI_CAMPUS });
  api.listar.mockResolvedValue({ success: true, data: [INCIDENCIA], pagination: { total: 1 } });
  api.metricas.mockResolvedValue({ success: true, data: CIFRAS });
  api.personas.mockResolvedValue({ success: true, data: [{ id: 41, nombre: 'Marta Gestora' }] });
});
afterEach(() => cleanup());

describe('los recorridos de las novedades del 18/11, tanda B (#611)', () => {
  it('son los cinco, en el orden de la issue, y están registrados con los demás', () => {
    expect(Object.keys(RECORRIDOS_NOVEDADES_B)).toEqual(['mi-factura', 'facturas-colaboradores', 'mi-campus', 'incidencias', 'prospectos']);
    for (const id of Object.keys(RECORRIDOS_NOVEDADES_B)) expect(RECORRIDOS_COBROS[id]).toBe(RECORRIDOS_NOVEDADES_B[id]);
  });

  it.each(Object.values(RECORRIDOS_NOVEDADES_B).map((r) => [r.id, r]))('%s: de 5 a 8 pasos, con permiso, y su pantalla lo ofrece', (id, r) => {
    expect(r.pasos.length).toBeGreaterThanOrEqual(5);
    expect(r.pasos.length).toBeLessThanOrEqual(8);
    expect(r.permiso).toBeTruthy();
    expect(r.pasos.filter((p) => p.donde).length).toBeGreaterThanOrEqual(r.pasos.length - 2);
    const codigo = fs.readFileSync(path.join(SRC, r.pantalla[0]), 'utf8');
    expect(codigo).toMatch(new RegExp(`<VerRecorrido id="${id}"`));
    expect(codigo).toContain('[&_[data-recorrido]]:scroll-mt-40');
  });

  it('cada uno, con el permiso con el que el servidor deja ver su pantalla', () => {
    const permiso = Object.fromEntries(Object.values(RECORRIDOS_NOVEDADES_B).map((r) => [r.id, r.permiso]));
    expect(permiso).toEqual({
      'mi-factura': 'facturas_colaborador.subir',
      'facturas-colaboradores': 'facturas_colaborador.ver_todas',
      'mi-campus': 'tutores.mis_cursos',
      incidencias: 'incidencias.view',
      prospectos: 'leads.view',
    });
  });
});

/** Desde la #1012 ninguno sale solo: se abre con su botón. */
const abrir = async (id) => {
  const r = RECORRIDOS_COBROS[id];
  fireEvent.click(await screen.findByRole('button', { name: `Ver recorrido: ${r.titulo}` }, { timeout: 3000 }));
};

describe('pintadas de verdad, se recorren enteras', () => {
  it('Mi factura: no sale sola (#1012); con «Ver recorrido» pasa por sus cinco pasos', async () => {
    rol.current = 'gestor'; // una vendedora: gestora con su ficha y el permiso por excepción
    permisos.add('facturas_colaborador.subir');
    pintar(MiFacturaPage);
    await screen.findAllByText(/Octubre de 2026 · CEDIA/);
    await abrir('mi-factura');
    await screen.findByRole('dialog', { name: 'Tu factura del mes' }, { timeout: 3000 });
    // Se marca en un efecto, que puede ir un instante detrás del cartel (lo abre un
    // temporizador, fuera de `act`): se espera, en vez de mirarlo en el acto.
    await waitFor(() => expect(localStorage.getItem(claveRecorrido('mi-factura', 41))).toBe('1'));
    expect(recorrer(5)).toEqual(titulos('mi-factura'));
    expect(document.querySelector('[data-recorrido="mi-factura-pago"]').textContent).toBe('En revisión');
    fireEvent.click(screen.getByRole('button', { name: 'Entendido' }));
    expect(screen.queryByRole('dialog', { name: /./ })).toBeNull();
  });

  it('Mi factura sin nada que subir: se salta «Subir mi factura» y «Revisión y pago»', async () => {
    permisos.add('facturas_colaborador.subir');
    api.mias.mockResolvedValue({ data: [] });
    pintar(MiFacturaPage);
    await screen.findByText('Todavía no tienes facturas que subir');
    await abrir('mi-factura');
    await screen.findByRole('dialog', { name: 'Tu factura del mes' }, { timeout: 3000 });
    expect(recorrer(5)).toEqual(titulos('mi-factura', ['Subir mi factura', 'Revisión y pago']));
  });

  it('Facturas de colaboradores, con «validar»: pasa por los siete', async () => {
    permisos.add('facturas_colaborador.ver_todas');
    permisos.add('facturas_colaborador.validar');
    pintar(FacturasColaboradoresPage, '/finanzas/facturas-colaboradores');
    await screen.findByText('Lucía');
    await abrir('facturas-colaboradores');
    await screen.findByRole('dialog', { name: 'Las facturas del mes' }, { timeout: 3000 });
    expect(recorrer(7)).toEqual(titulos('facturas-colaboradores'));
    // «Validar antes de pagar» señala la pestaña «Por validar».
    expect(document.querySelector('[data-recorrido="facturas-colab-por-validar"]').textContent).toBe('Por validar');
  });

  it('Facturas de colaboradores sin «validar» (project manager): no se explica validar', async () => {
    rol.current = 'project_manager';
    permisos.add('facturas_colaborador.ver_todas');
    pintar(FacturasColaboradoresPage, '/finanzas/facturas-colaboradores');
    await screen.findByText('Lucía');
    await abrir('facturas-colaboradores');
    await screen.findByRole('dialog', { name: 'Las facturas del mes' }, { timeout: 3000 });
    expect(recorrer(7)).toEqual(titulos('facturas-colaboradores', ['Validar antes de pagar']));
  });

  it('Mi campus (tutora) con un solo campus: pasa por todos menos «Tus campus» (no hay selector)', async () => {
    rol.current = 'tutor';
    permisos.add('tutores.mis_cursos');
    pintar(MiCampusPage, '/mis-cursos/campus');
    await screen.findByTestId('resumen-mi-campus');
    await abrir('mi-campus');
    await screen.findByRole('dialog', { name: 'Tu campus' }, { timeout: 3000 });
    expect(recorrer(8)).toEqual(titulos('mi-campus', ['Tus campus']));
  });

  it('Mi campus con dos campus (gemela de CRM#1084): también «Tus campus», el selector', async () => {
    rol.current = 'tutor_redactor';
    permisos.add('tutores.mis_cursos');
    api.miCampus.mockResolvedValue({ success: true, data: {
      ...MI_CAMPUS, todosLosCampus: [{ projectId: 3, campus: 'Fono' }, { projectId: 5, campus: 'ISEF' }], elegidos: null,
    } });
    pintar(MiCampusPage, '/mis-cursos/campus');
    await screen.findByTestId('resumen-mi-campus');
    await abrir('mi-campus');
    await screen.findByRole('dialog', { name: 'Tu campus' }, { timeout: 3000 });
    expect(recorrer(8)).toEqual(titulos('mi-campus'));
  });

  it('Mi campus con todo conectado: se salta «Campus sin conectar»', async () => {
    rol.current = 'tutor';
    permisos.add('tutores.mis_cursos');
    api.miCampus.mockResolvedValue({ success: true, data: { ...MI_CAMPUS, sinConectar: [] } });
    pintar(MiCampusPage, '/mis-cursos/campus');
    await screen.findByTestId('resumen-mi-campus');
    await abrir('mi-campus');
    await screen.findByRole('dialog', { name: 'Tu campus' }, { timeout: 3000 });
    expect(recorrer(8)).toEqual(titulos('mi-campus', ['Campus sin conectar', 'Tus campus']));
  });

  it('Incidencias (admin): en la lista pasa por todo menos las cifras', async () => {
    permisos.add('incidencias.view');
    permisos.add('incidencias.create');
    pintar(IncidenciasPage);
    await screen.findAllByText('Se cobró dos veces la matrícula');
    await abrir('incidencias');
    await screen.findByRole('dialog', { name: 'Lo que salió mal' }, { timeout: 3000 });
    expect(recorrer(7)).toEqual(titulos('incidencias', ['Las cifras']));
  });

  it('Incidencias (gestora): sin «Nueva incidencia»; en las cifras, se saltan filtros y lista', async () => {
    rol.current = 'gestor';
    permisos.add('incidencias.view');
    localStorage.setItem(claveRecorrido('incidencias', 41), '1');
    pintar(IncidenciasPage);
    await screen.findAllByText('Se cobró dos veces la matrícula');
    expect(screen.queryByRole('button', { name: /Nueva incidencia/ })).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'Por persona, tipo y mes' }));
    await screen.findByText('Por persona');
    fireEvent.click(screen.getByRole('button', { name: 'Ver recorrido: Incidencias' }));
    expect(recorrer(7)).toEqual(titulos('incidencias', ['Nueva incidencia', 'Los filtros', 'La lista']));
  });

  it('ya visto, no vuelve a salir solo; sin el permiso, ni botón ni recorrido', async () => {
    permisos.add('incidencias.view');
    localStorage.setItem(claveRecorrido('incidencias', 41), '1');
    const { unmount } = pintar(IncidenciasPage);
    await screen.findAllByText('Se cobró dos veces la matrícula');
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('dialog', { name: 'Lo que salió mal' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Ver recorrido: Incidencias' })).toBeInTheDocument();
    unmount();

    permisos.clear();
    permisos.add('leads.view'); // otro cualquiera: no el de Mi campus
    pintar(MiCampusPage, '/mis-cursos/campus');
    await screen.findByTestId('resumen-mi-campus');
    await new Promise((r) => setTimeout(r, 1200));
    expect(screen.queryByRole('button', { name: /Ver recorrido/ })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Tu campus' })).toBeNull();
  });
});

describe('Prospectos: los filtros', () => {
  it('en ISEIE no va «El filtro de campus»: no hay empresas ni campus dentro de «Filtros»', () => {
    const titulos = RECORRIDOS_NOVEDADES_B.prospectos.pasos.map((p) => p.titulo);
    expect(titulos).not.toContain('El filtro de campus');
    expect(titulos).toEqual(['Tus prospectos', 'Nuevo prospecto', 'Lista y Equipo', 'Buscar y filtrar', 'La lista', 'Lo que toca', 'Y listo']);
    const barra = fs.readFileSync(path.join(SRC, 'modules/leads/components/LeadsFiltersBar.tsx'), 'utf8');
    expect(barra).not.toContain('prospectos-campus');
  });

  it('sin «crear prospectos», el paso «Nuevo prospecto» no sale', () => {
    const vistos = pasosPara(RECORRIDOS_NOVEDADES_B.prospectos, (k) => k === 'leads.view').map((p) => p.titulo);
    expect(vistos).not.toContain('Nuevo prospecto');
    expect(vistos).toContain('Buscar y filtrar');
  });

  it('en «Equipo» no se ofrece: sus partes son las de la lista, que está escondida', () => {
    const codigo = fs.readFileSync(path.join(SRC, 'modules/leads/pages/LeadsPage.tsx'), 'utf8');
    expect(codigo).toContain("{vista === 'lista' && <VerRecorrido id=\"prospectos\"");
  });
});
