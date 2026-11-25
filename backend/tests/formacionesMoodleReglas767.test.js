import { describe, it, expect } from 'vitest';

/**
 * CRM#1113 / CRM-ISEIE#767 · fase 2: las dos decisiones de Diego (24/11, «hazlo, acomoda
 * eso»), sin base y con Moodle simulado.
 *
 *   · Nombre corto: el SKU; si no, CUR/DIP/MAS + trozo del nombre + año de inicio; si ya
 *     existe en el campus, -2, -3…
 *   · Categoría por tipo: la guardada en Integraciones; si no, la que se llama como el tipo;
 *     si no, la de por defecto (0).
 *   · Leer el campus: con el token del plugin (sin core_course_get_categories) las
 *     categorías salen de los cursos.
 *
 *   npx vitest run tests/formacionesMoodleReglas767.test.js
 */

const {
  nombreCortoPropuesto, trozoDelNombre, primeroLibre, conSufijo, proponerCategorias, categoriaParaTipo, categoriasGuardadas, tipoDe,
} = await import('../src/modules/products/formacion.moodle.js');
const { categoriasDelCampus } = await import('../src/shared/services/moodle.client.js');

const HOY = new Date('2026-11-24T10:00:00Z');

describe('nombre corto', () => {
  it('con SKU, el SKU tal cual', () => {
    expect(nombreCortoPropuesto({ nombre: 'Máster en Voz', sku: ' MV-01 ', tipo_formacion: 'master' }, { hoy: HOY }))
      .toEqual({ valor: 'MV-01', origen: 'sku' });
  });

  it('sin SKU: iniciales del tipo + trozo del nombre + año de inicio', () => {
    expect(nombreCortoPropuesto({ nombre: 'Diplomado en Psicología Clínica Infantil', tipo_formacion: 'diplomado', fecha_inicio: '2027-02-01' }, { hoy: HOY }))
      .toEqual({ valor: 'DIP-PSICOLOGIA-CLINICA-INFANTIL-2027', origen: 'regla' });
    expect(nombreCortoPropuesto({ nombre: 'Curso de Disfagia', tipo_formacion: 'curso' }, { hoy: HOY }).valor).toBe('CUR-DISFAGIA-2026');
    expect(nombreCortoPropuesto({ nombre: 'Máster en Logopedia', tipo_formacion: 'master', fecha_inicio: '2028-01-15' }, { hoy: HOY }).valor)
      .toBe('MAS-LOGOPEDIA-2028');
  });

  it('sin tipo guardado, el que dice el nombre', () => {
    expect(tipoDe({ nombre: 'Maestría en Educación', tipo_formacion: null })).toBe('master');
    expect(nombreCortoPropuesto({ nombre: 'Maestría en Educación' }, { hoy: HOY }).valor).toBe('MAS-EDUCACION-2026');
  });

  it('el trozo no pasa de 30 letras y corta por palabras', () => {
    const t = trozoDelNombre('Diplomado en Neuropsicología del Desarrollo y Trastornos del Aprendizaje');
    expect(t.length).toBeLessThanOrEqual(30);
    expect(t).toBe('NEUROPSICOLOGIA-DESARROLLO');
    expect(trozoDelNombre('Curso de')).toBe('FORMACION');
  });

  it('si ya existe, -2, -3… sin distinguir mayúsculas', () => {
    expect(conSufijo('A', 1)).toBe('A');
    expect(primeroLibre('CUR-VOZ-2027', [])).toBe('CUR-VOZ-2027');
    expect(primeroLibre('CUR-VOZ-2027', ['cur-voz-2027'])).toBe('CUR-VOZ-2027-2');
    expect(primeroLibre('CUR-VOZ-2027', ['CUR-VOZ-2027', 'CUR-VOZ-2027-2'])).toBe('CUR-VOZ-2027-3');
  });
});

describe('categoría por tipo', () => {
  // Como un Moodle con el árbol entero (core_course_get_categories).
  const arbol = [
    { id: 1, nombre: 'Miscelánea', ruta: 'Miscelánea', profundidad: 1, cursos: 1 },
    { id: 2, nombre: 'CURSOS', ruta: 'CURSOS', profundidad: 1, cursos: 50 },
    { id: 24, nombre: 'CURSOS DE ESPECIALIZACIÓN', ruta: 'CURSOS DE ESPECIALIZACIÓN', profundidad: 1, cursos: 3 },
    { id: 5, nombre: 'Diplomados', ruta: 'Diplomados', profundidad: 1, cursos: 10 },
    { id: 6, nombre: 'Másteres', ruta: 'Másteres', profundidad: 1, cursos: 4 },
  ];

  it('propone la que se llama como el tipo, la más exacta', () => {
    expect(proponerCategorias(arbol)).toEqual({
      curso: { id: 2, nombre: 'CURSOS' }, diplomado: { id: 5, nombre: 'Diplomados' }, master: { id: 6, nombre: 'Másteres' },
    });
  });

  it('«Maestrías» también es máster; sin ninguna que encaje, nada', () => {
    expect(proponerCategorias([{ id: 9, nombre: 'Maestrías', cursos: 2 }]).master).toEqual({ id: 9, nombre: 'Maestrías' });
    expect(proponerCategorias([{ id: 12, nombre: 'FACULTAD DE MEDICINA', cursos: 51 }])).toEqual({ curso: null, diplomado: null, master: null });
  });

  it('manda lo guardado en Integraciones; 0 es la de por defecto; sin nada, la propuesta o 0', () => {
    expect(categoriaParaTipo('curso', { guardadas: { curso: 24 }, categorias: arbol }))
      .toEqual({ id: 24, nombre: 'CURSOS DE ESPECIALIZACIÓN', origen: 'campus' });
    expect(categoriaParaTipo('curso', { guardadas: { curso: 0 }, categorias: arbol })).toEqual({ id: 0, nombre: null, origen: 'por_defecto' });
    expect(categoriaParaTipo('diplomado', { guardadas: {}, categorias: arbol })).toEqual({ id: 5, nombre: 'Diplomados', origen: 'propuesta' });
    expect(categoriaParaTipo('master', { guardadas: {}, categorias: [] })).toEqual({ id: 0, nombre: null, origen: 'por_defecto' });
  });

  it('lo guardado se limpia: solo los tres tipos y enteros ≥ 0', () => {
    expect(categoriasGuardadas({ categorias_formacion: { curso: '7', diplomado: null, master: -1, otro: 3 } })).toEqual({ curso: 7 });
    expect(categoriasGuardadas({})).toEqual({});
    expect(categoriasGuardadas({ categorias_formacion: 'x' })).toEqual({});
  });
});

describe('leer el campus (solo lectura)', () => {
  const json = (c) => new Response(JSON.stringify(c), { status: 200, headers: { 'content-type': 'application/json' } });
  const conexion = { url: 'https://campus.test', token: 'tok0123456789abcdef' };
  const cursos = {
    courses: [
      { id: 1, format: 'site', shortname: 'portada', categoryid: 0 },
      { id: 10, shortname: 'DEPCS', categoryid: 12, categoryname: 'FACULTAD DE MEDICINA' },
      { id: 11, shortname: 'CDIDIO', categoryid: 2, categoryname: 'CURSOS' },
      { id: 12, shortname: 'CMVP', categoryid: 2, categoryname: 'CURSOS' },
    ],
  };

  it('sin core_course_get_categories en el token, las categorías salen de los cursos', async () => {
    const llamadas = [];
    const fetchImpl = async (_url, init) => {
      const f = new URLSearchParams(String(init.body)).get('wsfunction');
      llamadas.push(f);
      if (f === 'core_course_get_courses_by_field') return json(cursos);
      return json({ exception: 'webservice_access_exception', errorcode: 'accessexception', message: 'Access control exception' });
    };
    const r = await categoriasDelCampus(conexion, { fetchImpl });
    expect(r.fuente).toBe('cursos');
    expect(r.cortos).toEqual(['DEPCS', 'CDIDIO', 'CMVP']);
    expect(r.categorias).toEqual([
      { id: 2, nombre: 'CURSOS', ruta: null, profundidad: null, cursos: 2 },
      { id: 12, nombre: 'FACULTAD DE MEDICINA', ruta: null, profundidad: null, cursos: 1 },
    ]);
    // Solo funciones de lectura.
    expect(llamadas.every((f) => /_get_/.test(f))).toBe(true);
  });

  it('con la función, el árbol entero con la ruta de cada una', async () => {
    const fetchImpl = async (_url, init) => {
      const f = new URLSearchParams(String(init.body)).get('wsfunction');
      if (f === 'core_course_get_courses_by_field') return json(cursos);
      return json([
        { id: 3, name: 'Diplomados', parent: 0, depth: 1, coursecount: 0 },
        { id: 12, name: 'Medicina', parent: 3, depth: 2, coursecount: 1 },
      ]);
    };
    const r = await categoriasDelCampus(conexion, { fetchImpl });
    expect(r.fuente).toBe('moodle');
    expect(r.categorias.map((c) => c.ruta)).toEqual(['Diplomados', 'Diplomados › Medicina']);
  });

  it('si el campus falla de verdad (token caducado), se dice', async () => {
    const fetchImpl = async () => json({ exception: 'x', errorcode: 'invalidtoken', message: 'Invalid token' });
    await expect(categoriasDelCampus(conexion, { fetchImpl })).rejects.toMatchObject({ codigo: 'TOKEN' });
  });
});

describe('tutoras de la ficha sin «% de comisión» (Diego, 24/11: «no va»)', () => {
  it('la colaboración se crea sin %, y entonces es 0 (no cobra); con % sigue igual', async () => {
    const { colaboracionSchema } = await import('../src/modules/tutores/tutor.validation.js');
    const sin = colaboracionSchema.parse({ tutorId: 1, productId: 2, desde: '2026-11-24' });
    expect(sin.pct).toBe(0);
    expect(colaboracionSchema.parse({ tutorId: 1, productId: 2, pct: 12.5, desde: '2026-11-24' }).pct).toBe(12.5);
    expect(colaboracionSchema.safeParse({ tutorId: 1, productId: 2, pct: 120, desde: '2026-11-24' }).success).toBe(false);
  });
});
