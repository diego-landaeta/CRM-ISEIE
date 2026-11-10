import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Preguntarle a los datos (#30): las cuatro reglas que NO dependen de que el
 * modelo se porte bien. Claude se simula; lo que se prueba es lo que hace el
 * servidor con lo que Claude le devuelve.
 *
 *  1. el alcance lo pone el servidor, diga lo que diga el modelo;
 *  2. sin ninguna consulta detras, su texto no se enseña;
 *  3. las cifras que no salen de los datos, se devuelven aparte;
 *  4. el tope se mira antes de CADA llamada.
 */

const reportes = {
  overview: vi.fn(async () => ({ leads: { total: 120, convertido: 18 }, cobrado: 12345.67 })),
  resumenMensual: vi.fn(async () => ([{ mes: '2026-07', ventas: 7 }])),
  ventasPorAsesoraReport: vi.fn(async () => ([])),
};
vi.mock('../src/modules/reports/report.model.js', () => reportes);

const gasto = {
  compruebaAntesDeGastar: vi.fn(async () => ({ permitido: true, motivo: null, estado: {} })),
  registrar: vi.fn(async () => ({ apuntado: true })),
  estado: vi.fn(async () => ({ porcentaje: 10, cerca: false, queda: 18, tope: 20, gastado: 2 })),
};
vi.mock('../src/shared/services/gastoIA.service.js', () => gasto);

const clave = vi.fn(async () => 'clave-falsa-de-prueba');
vi.mock('../src/modules/credentials/credentials.model.js', () => ({ getDecryptedValue: (...a) => clave(...a) }));

const { preguntar, instruccion, recortar, MAX_VUELTAS, SIN_DATO } =
  await import('../src/modules/ia-analisis/preguntar.service.js');

const HOY = new Date('2026-08-15T10:00:00Z');

const usoDe = (name, input = {}, id = 'tu_1') => ({ type: 'tool_use', id, name, input });
const pideHerramienta = (...usos) => ({
  stop_reason: 'tool_use', content: usos, usage: { input_tokens: 100, output_tokens: 20 },
});
const contesta = (texto) => ({
  stop_reason: 'end_turn', content: [{ type: 'text', text: texto }], usage: { input_tokens: 150, output_tokens: 40 },
});

/**
 * El resultado de herramienta que se le devolvio al modelo. Se busca por su forma y
 * no por la posicion: `messages` es el mismo array en todas las llamadas y el
 * servicio le sigue añadiendo la respuesta del modelo despues.
 */
const resultadoDeHerramienta = (llamar) =>
  llamar.mock.calls[1][0].messages
    .find((m) => m.role === 'user' && Array.isArray(m.content)).content[0];

/** Un Claude de mentira que va devolviendo respuestas en orden. */
const claudeQue = (...respuestas) => {
  const llamar = vi.fn();
  respuestas.forEach((r) => llamar.mockResolvedValueOnce(r));
  return llamar;
};

beforeEach(() => {
  for (const f of [...Object.values(reportes), ...Object.values(gasto), clave]) f.mockClear();
  gasto.compruebaAntesDeGastar.mockResolvedValue({ permitido: true, motivo: null, estado: {} });
  clave.mockResolvedValue('clave-falsa-de-prueba');
});

const preguntaBase = { pregunta: '¿cuánto se cobró en julio?', alcance: { projectIds: [1, 2] }, userId: 9, hoy: HOY };

describe('el camino bueno', () => {
  it('pide una consulta, la recibe y contesta con el dato y su desglose', async () => {
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general', { from: '2026-07-01', to: '2026-07-31' })),
      contesta('En julio de 2026 se cobraron 12.345,67 € de 120 prospectos.'),
    );
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r.ok).toBe(true);
    expect(r.respuesta).toContain('12.345,67');
    expect(r.verificada).toBe(true);
    expect(r.cifrasSinComprobar).toEqual([]);
    // El desglose lleva los parametros DE VERDAD usados: asi se comprueba a mano.
    expect(r.desglose).toHaveLength(1);
    expect(r.desglose[0]).toMatchObject({
      consulta: 'resumen_general',
      parametros: { from: '2026-07-01', to: '2026-07-31', projectIds: [1, 2] },
    });
    expect(r.desglose[0].datos.cobrado).toBe(12345.67);
  });

  it('apunta el gasto de CADA llamada', async () => {
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general')),
      contesta('Hubo 120 prospectos.'),
    );
    await preguntar({ ...preguntaBase, llamar });
    expect(gasto.registrar).toHaveBeenCalledTimes(2);
    expect(gasto.registrar).toHaveBeenCalledWith(expect.objectContaining({
      origen: 'ia-analisis', userId: 9, entrada: 100, salida: 20,
    }));
  });

  it('devuelve cuanto queda del tope, para poder avisar al acercarse', async () => {
    gasto.estado.mockResolvedValueOnce({ porcentaje: 85, cerca: true, queda: 3, tope: 20, gastado: 17 });
    const llamar = claudeQue(pideHerramienta(usoDe('resumen_general')), contesta('Hubo 120 prospectos.'));
    const r = await preguntar({ ...preguntaBase, llamar });
    expect(r.gasto).toMatchObject({ cerca: true, porcentaje: 85, queda: 3 });
  });
});

describe('regla 1 · el alcance lo pone el servidor', () => {
  it('lo que el modelo diga de proyectos se tira', async () => {
    // Alguien de una empresa pregunta por «los de ICTESS» y el modelo, obediente,
    // pide el proyecto 99. La base recibe los campus de quien pregunta.
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general', { projectId: 99, projectIds: [98, 99], from: '2026-07-01' })),
      contesta('Hubo 120 prospectos.'),
    );
    await preguntar({ ...preguntaBase, llamar });

    const [parametros] = reportes.overview.mock.calls[0];
    expect(parametros.projectIds).toEqual([1, 2]);
    expect(parametros.projectId).toBeUndefined();
    expect(JSON.stringify(parametros)).not.toContain('99');
  });

  it('con un campus suelto, manda ese', async () => {
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general', { projectId: 99 })),
      contesta('Hubo 120 prospectos.'),
    );
    await preguntar({ ...preguntaBase, alcance: { projectId: 3 }, llamar });
    expect(reportes.overview.mock.calls[0][0]).toMatchObject({ projectId: 3 });
  });

  it('el modelo no ve «projectId» entre los parametros de las herramientas', async () => {
    const llamar = claudeQue(contesta('No tengo ese dato.'));
    await preguntar({ ...preguntaBase, llamar });
    const { tools } = llamar.mock.calls[0][0];
    expect(tools.length).toBeGreaterThan(0);
    for (const t of tools) {
      expect(Object.keys(t.input_schema.properties)).not.toContain('projectId');
      expect(Object.keys(t.input_schema.properties)).not.toContain('projectIds');
    }
  });

  it('una consulta que no existe no se ejecuta y el modelo recibe el error', async () => {
    const llamar = claudeQue(
      pideHerramienta(usoDe('borrar_todo')),
      contesta('Hecho.'),
    );
    const r = await preguntar({ ...preguntaBase, llamar });

    const segunda = resultadoDeHerramienta(llamar);
    expect(segunda.is_error).toBe(true);
    expect(segunda.content).toContain('Consulta desconocida');
    expect(reportes.overview).not.toHaveBeenCalled();
    // Y como no hubo ningun dato, lo que diga el modelo no se enseña.
    expect(r.sinDatos).toBe(true);
  });
});

describe('regla 2 · sin datos no hay respuesta', () => {
  it('si contesta sin consultar nada, se tira su texto', async () => {
    const llamar = claudeQue(contesta('En julio se vendieron 5.000 € en total.'));
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r.ok).toBe(true);
    expect(r.respuesta).toBe(SIN_DATO);
    expect(r.respuesta).not.toContain('5.000');
    expect(r.sinDatos).toBe(true);
    expect(r.verificada).toBe(false);
    expect(r.desglose).toEqual([]);
  });

  it('si la consulta falla, tampoco se enseña lo que invente despues', async () => {
    reportes.overview.mockRejectedValueOnce(new Error('relation "x" does not exist'));
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general')),
      contesta('Se cobraron 7.777 € en julio.'),
    );
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r.respuesta).toBe(SIN_DATO);
    // Al modelo no se le cuenta el error interno de la base.
    const resultado = resultadoDeHerramienta(llamar);
    expect(resultado.is_error).toBe(true);
    expect(resultado.content).not.toContain('relation');
  });
});

describe('regla 3 · las cifras se comprueban despues', () => {
  it('una cifra que no sale de los datos se devuelve aparte y la respuesta no queda verificada', async () => {
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general')),
      contesta('Se cobraron 12.345,67 € y se hicieron 4.321 llamadas.'),
    );
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r.ok).toBe(true);
    expect(r.cifrasSinComprobar).toEqual(['4.321']);
    expect(r.verificada).toBe(false);
    // No se esconde la respuesta: se marca. Una suma bien hecha tampoco «sale»
    // tal cual de los datos.
    expect(r.respuesta).toContain('12.345,67');
  });
});

describe('regla 4 · el tope se mira antes de cada llamada', () => {
  it('si ya esta agotado, no se llama a Anthropic', async () => {
    gasto.compruebaAntesDeGastar.mockResolvedValue({ permitido: false, motivo: 'Se alcanzo el tope.', estado: { agotado: true } });
    const llamar = vi.fn();
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r).toMatchObject({ ok: false, codigo: 'TOPE', mensaje: 'Se alcanzo el tope.' });
    expect(llamar).not.toHaveBeenCalled();
  });

  it('y si se agota a mitad de la pregunta, la segunda vuelta no sale', async () => {
    gasto.compruebaAntesDeGastar
      .mockResolvedValueOnce({ permitido: true, motivo: null, estado: {} })
      .mockResolvedValueOnce({ permitido: false, motivo: 'Tope.', estado: {} });
    const llamar = claudeQue(pideHerramienta(usoDe('resumen_general')));
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r.codigo).toBe('TOPE');
    expect(llamar).toHaveBeenCalledTimes(1);
  });

  it('una pregunta no da mas vueltas que MAX_VUELTAS', async () => {
    const llamar = vi.fn(async () => pideHerramienta(usoDe('resumen_general')));
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(llamar).toHaveBeenCalledTimes(MAX_VUELTAS);
    expect(r).toMatchObject({ ok: false, codigo: 'SIN_RESPUESTA' });
  });
});

describe('cuando algo falta o falla', () => {
  it('sin clave de Anthropic no se llama a nadie', async () => {
    clave.mockResolvedValue(null);
    const previa = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    try {
      const llamar = vi.fn();
      const r = await preguntar({ ...preguntaBase, llamar });
      expect(r.codigo).toBe('SIN_CLAVE');
      expect(llamar).not.toHaveBeenCalled();
    } finally {
      if (previa !== undefined) process.env.ANTHROPIC_API_KEY = previa;
    }
  });

  it('si Anthropic falla, se apunta el intento y se contesta con un mensaje limpio', async () => {
    const llamar = vi.fn().mockRejectedValue(new Error('Anthropic 529: overloaded sk-ant-secreto'));
    const r = await preguntar({ ...preguntaBase, llamar });

    expect(r).toMatchObject({ ok: false, codigo: 'IA_NO_RESPONDE' });
    // El mensaje para quien pregunta no arrastra el error de fuera.
    expect(r.mensaje).not.toContain('sk-ant');
    expect(gasto.registrar).toHaveBeenCalledWith(expect.objectContaining({
      origen: 'ia-analisis', fallo: expect.stringContaining('529'),
    }));
  });
});

describe('lo que se le manda al modelo', () => {
  it('la instruccion lleva la fecha de hoy y el catalogo', () => {
    const t = instruccion(HOY);
    expect(t).toContain('2026-08-15');
    expect(t).toContain('resumen_general');
    expect(t).toContain('No tengo ese dato');
  });

  it('las listas largas se recortan y se dice que se recortaron', () => {
    const filas = Array.from({ length: 500 }, (_, i) => ({ id: i }));
    const r = recortar({ ventas: filas }, 60);
    expect(r.ventas).toHaveLength(61);
    expect(r.ventas.at(-1)._aviso).toContain('60 de 500');
  });

  it('al modelo le llegan los parametros usados, no los que pidio', async () => {
    const llamar = claudeQue(
      pideHerramienta(usoDe('resumen_general', { from: 'ayer', to: '2026-07-31' })),
      contesta('Hubo 120 prospectos.'),
    );
    await preguntar({ ...preguntaBase, llamar });
    const resultado = JSON.parse(resultadoDeHerramienta(llamar).content);
    // «ayer» no es una fecha y se descarta: el modelo lo ve y puede decirlo.
    expect(resultado.parametros_usados.from).toBeUndefined();
    expect(resultado.parametros_usados.to).toBe('2026-07-31');
  });
});
