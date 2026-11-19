import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cuanto se escribe y cuanto se manda en nota de voz (#180, gemela de CRM#128, punto 4).
//
// Diego: «en los canales de ventas hay que diferenciar cuanto es escrito, por
// voz en el caso de WhatsApp, si envian audios o no». Y el documento comercial
// dice que el saludo del dia 1 «funciona mejor en nota de voz: sube mucho la
// tasa de respuesta» — hasta ahora eso se repetia de oidas porque no habia
// forma de contarlo.
//
// El dato ya estaba guardado: `wa_mensajes.tipo`. No hace falta migracion; lo
// que faltaba era preguntarlo.

const consultas = [];
let fallaLaDeWhatsapp = false;

vi.mock('../src/shared/config/db.js', () => ({
  query: vi.fn(async (sql, params) => {
    consultas.push({ sql, params });
    if (/FROM wa_mensajes/.test(sql)) {
      if (fallaLaDeWhatsapp) {
        throw Object.assign(new Error('relation "wa_mensajes" does not exist'), { code: '42P01' });
      }
      return { rows: [{ escrito: 30, voz: 10, adjunto: 4 }] };
    }
    return { rows: [{ entraron: 0, toques: 0, personas: 0, whatsapp: 0, llamada: 0, email: 0, nota: 0 }] };
  }),
}));

const { seguimientoYTiempos } = await import('../src/modules/reports/report.model.js');

describe('escrito contra voz', () => {
  beforeEach(() => { consultas.length = 0; fallaLaDeWhatsapp = false; });

  it('sale de wa_mensajes y no de lead_interactions', async () => {
    // La interaccion apunta que hubo un WhatsApp, pero no de que tipo: contarlo
    // desde ahi obligaria a una migracion para un dato que ya esta guardado.
    await seguimientoYTiempos({ from: '2026-09-01', to: '2026-09-30' });
    const q = consultas.find((c) => /FROM wa_mensajes/.test(c.sql));
    expect(q).toBeTruthy();
    expect(q.sql).toMatch(/tipo = 'audio'/);
    expect(q.sql).toMatch(/tipo = 'texto'/);
  });

  it('solo cuenta lo que SALE', async () => {
    // Contar los audios que recibe una gestora diria que trabaja mas quien
    // tiene clientes habladores.
    await seguimientoYTiempos({});
    const q = consultas.find((c) => /FROM wa_mensajes/.test(c.sql));
    expect(q.sql).toMatch(/direccion = 'saliente'/);
  });

  it('respeta el proyecto y la asesora del informe', async () => {
    // Si no, el bloque diria una cosa y el resto del informe otra.
    await seguimientoYTiempos({ projectId: 3, asesoraId: 9 });
    const q = consultas.find((c) => /FROM wa_mensajes/.test(c.sql));
    expect(q.sql).toMatch(/JOIN leads l/);
    expect(q.sql).toMatch(/l\.responsable_id/);
    expect(q.sql).toMatch(/l\.project_id/);
  });

  it('el porcentaje se calcula sobre escrito + voz, no sobre el total', async () => {
    // 10 de voz sobre 40 mensajes de conversacion = 25 %. Metiendo los 4
    // adjuntos en el divisor saldria 22,7 %: mandar el dossier haria bajar el
    // numero, o sea que trabajar bien penalizaria.
    const r = await seguimientoYTiempos({});
    expect(r.actividad.whatsapp_saliente).toEqual({
      escrito: 30, voz: 10, adjunto: 4, pct_voz: 25,
    });
  });

  it('un CRM sin WhatsApp instalado no tumba el informe entero', async () => {
    // Las tablas de WhatsApp pueden no existir. Que falte un bloque no puede
    // dejar sin informe a quien no usa el modulo.
    fallaLaDeWhatsapp = true;
    const r = await seguimientoYTiempos({});
    expect(r.actividad.whatsapp_saliente).toEqual({
      escrito: 0, voz: 0, adjunto: 0, pct_voz: 0,
    });
    // Y el resto del informe sigue ahi.
    expect(r.actividad).toHaveProperty('toques');
  });

  it('los demas errores SI suben', async () => {
    // Tragarselos todos esconderia una base caida o una consulta mal escrita.
    const mod = await import('../src/shared/config/db.js');
    mod.query.mockImplementationOnce(async () => { throw new Error('nada'); });
    // La primera consulta del informe revienta y el error tiene que subir.
    await expect(seguimientoYTiempos({})).rejects.toThrow();
  });
});
