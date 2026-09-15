import { describe, it, expect, vi, beforeEach } from 'vitest';

// Se simula la base: lo que se prueba aqui es el CRITERIO con el que se lee un
// aviso de llamada, no que Postgres sepa insertar. Asi corre sin contenedor.
const guardarMensaje = vi.fn();
const conversacionDe = vi.fn();
const apuntarInteraccion = vi.fn();

vi.mock('../src/modules/whatsapp/chat.model.js', () => ({
  guardarMensaje: (...a) => guardarMensaje(...a),
  conversacionDe: (...a) => conversacionDe(...a),
  actualizarEstado: vi.fn(),
  hayConversaciones: vi.fn().mockResolvedValue(false),
  apuntarInteraccion: (...a) => apuntarInteraccion(...a),
}));
vi.mock('../src/modules/whatsapp/evolution.client.js', () => ({
  instanciaDe: (id) => `crm-u${id}`,
  // Se copia el comportamiento real, no un null fijo: con un null a secas este
  // fichero estaria comprobando el simulacro en vez del codigo, y la prueba de
  // a nombre de quien queda la llamada no probaria nada.
  usuarioDeInstancia: (inst) => {
    const m = /-u(\d+)$/.exec(String(inst || ''));
    return m ? parseInt(m[1], 10) : null;
  },
}));
vi.mock('../src/modules/whatsapp/media.service.js', () => ({
  esRuido: () => false, tipoDeMensaje: () => ({ tipo: 'texto' }), textoDe: () => '',
  mereceDescarga: () => false, encolar: vi.fn(),
}));

const { recibir, llamadaSonando } = await import('../src/modules/whatsapp/chat.service.js');

const aviso = (data) => ({ event: 'call', instance: 'crm-u3', data });

describe('llamadas entrantes', () => {
  beforeEach(() => {
    guardarMensaje.mockReset();
    conversacionDe.mockReset().mockResolvedValue({ id: 7 });
    guardarMensaje.mockResolvedValue({ id: 99, ts: new Date() });
  });

  it('no guarda nada mientras la llamada esta en curso', async () => {
    // Evolution manda un aviso por CADA cambio de estado. Si se guardaran
    // todos, una sola llamada dejaria cinco lineas en el chat.
    //
    // `offer` es distinto de los demas: tampoco se guarda, pero SI enciende el
    // aviso de «te estan llamando». Los otros son cocina del protocolo y no
    // significan nada para nadie.
    const r = await recibir(aviso({ id: 'A', from: '34600000001@s.whatsapp.net', status: 'offer' }));
    expect(r.sonando).toBe(true);
    for (const status of ['ringing', 'preaccept', 'transport', 'relaylatency']) {
      const otro = await recibir(aviso({ id: 'A', from: '34600000001@s.whatsapp.net', status }));
      expect(otro.ignorado).toMatch(/en curso/);
    }
    expect(guardarMensaje).not.toHaveBeenCalled();
  });

  it('guarda el desenlace, y lo dice en seco', async () => {
    const casos = { timeout: 'perdida', reject: 'rechazada', accept: 'contestada' };
    for (const [status, esperado] of Object.entries(casos)) {
      guardarMensaje.mockClear();
      await recibir(aviso({ id: 'B', from: '34600000001@s.whatsapp.net', status }));
      const [args] = guardarMensaje.mock.calls;
      expect(args[0].tipo).toBe('llamada');
      // El desenlace en seco, no la frase: la pantalla decide como se dice, y
      // asi se puede filtrar por perdidas sin buscar dentro de un texto.
      expect(args[0].texto).toBe(esperado);
      expect(args[0].direccion).toBe('entrante');
    }
  });

  it('el identificador lleva el prefijo call:, que es lo que evita el duplicado', async () => {
    await recibir(aviso({ id: 'XYZ', from: '34600000001@s.whatsapp.net', status: 'timeout' }));
    expect(guardarMensaje.mock.calls[0][0].waId).toBe('call:XYZ');
  });

  it('con @lid usa el telefono que viene aparte, no el identificador', async () => {
    // Un @lid identifica a la persona sin dar su numero. Atarlo a ese
    // identificador crearia una conversacion suelta que no es de nadie.
    await recibir(aviso({
      id: 'C', from: '98765432109876@lid', callerPn: '34600000004@s.whatsapp.net', status: 'reject',
    }));
    expect(conversacionDe.mock.calls[0][0].jid).toBe('34600000004@s.whatsapp.net');
  });

  it('distingue la videollamada', async () => {
    await recibir(aviso({ id: 'D', from: '34600000001@s.whatsapp.net', status: 'timeout', isVideo: true }));
    expect(guardarMensaje.mock.calls[0][0].mediaMime).toBe('video');
  });

  it('sin instancia no se guarda: no se sabe de quien es esa llamada', async () => {
    // Sin esto acabaria en una sesion generica que nadie mira, y encima
    // ensuciaria la base de otra gestora.
    const r = await recibir({ event: 'call', data: { id: 'E', from: '34600000001@s.whatsapp.net', status: 'timeout' } });
    expect(r.ignorado).toMatch(/sin instancia/);
    expect(guardarMensaje).not.toHaveBeenCalled();
  });

  it('sin origen tampoco', async () => {
    const r = await recibir(aviso({ id: 'F', status: 'timeout' }));
    expect(r.ignorado).toMatch(/sin origen/);
  });

  it('en grupo, la conversacion es el grupo y no quien llamo', async () => {
    await recibir(aviso({
      id: 'G', from: '34600000001@s.whatsapp.net', chatId: '120363000000000001@g.us',
      isGroup: true, status: 'timeout',
    }));
    expect(conversacionDe.mock.calls[0][0].jid).toBe('120363000000000001@g.us');
  });
});

describe('el aviso mientras la llamada suena', () => {
  beforeEach(() => {
    guardarMensaje.mockReset().mockResolvedValue({ id: 99, ts: new Date() });
    conversacionDe.mockReset().mockResolvedValue({
      id: 4, telefono: '34600000004', nombre_push: 'Ana Gil (prueba)',
    });
  });

  it('un offer avisa pero NO guarda nada: todavia no es un hecho', async () => {
    const r = await recibir(aviso({ id: 'R1', from: '34600000004@s.whatsapp.net', status: 'offer' }));
    expect(r.sonando).toBe(true);
    expect(guardarMensaje).not.toHaveBeenCalled();
    expect(llamadaSonando('crm-u3')).toMatchObject({
      id: 'R1', telefono: '34600000004', nombre: 'Ana Gil (prueba)', conversacionId: 4,
    });
  });

  it('el aviso se quita en cuanto la llamada acaba, acabe como acabe', async () => {
    for (const fin of ['timeout', 'reject', 'accept']) {
      await recibir(aviso({ id: 'R2', from: '34600000004@s.whatsapp.net', status: 'offer' }));
      expect(llamadaSonando('crm-u3')).not.toBeNull();
      await recibir(aviso({ id: 'R2', from: '34600000004@s.whatsapp.net', status: fin }));
      expect(llamadaSonando('crm-u3')).toBeNull();
    }
  });

  it('caduca solo si el aviso de que termino no llega nunca', async () => {
    // Un webhook que se pierde o el contenedor reiniciandose dejarian el cartel
    // puesto para siempre, y habria que recargar la pagina para quitarlo.
    vi.useFakeTimers();
    try {
      await recibir(aviso({ id: 'R3', from: '34600000004@s.whatsapp.net', status: 'offer' }));
      vi.advanceTimersByTime(44000);
      expect(llamadaSonando('crm-u3')).not.toBeNull();   // a los 44s aun suena
      vi.advanceTimersByTime(2000);
      expect(llamadaSonando('crm-u3')).toBeNull();       // a los 46s ya no
    } finally { vi.useRealTimers(); }
  });

  it('la llamada de una gestora no le salta a otra', async () => {
    await recibir({
      event: 'call', instance: 'crm-u5',
      data: { id: 'R4', from: '34600000004@s.whatsapp.net', status: 'offer' },
    });
    expect(llamadaSonando('crm-u5')).not.toBeNull();
    expect(llamadaSonando('crm-u3')).toBeNull();
  });
});

describe('la hora de la llamada, venga como venga', () => {
  beforeEach(() => {
    guardarMensaje.mockReset().mockResolvedValue({ id: 99, ts: new Date() });
    conversacionDe.mockReset().mockResolvedValue({ id: 7, telefono: '34600000001', nombre_push: null });
  });

  const cuando = async (date) => {
    await recibir(aviso({ id: 'T' + Math.random(), from: '34600000001@s.whatsapp.net', status: 'timeout', date }));
    return guardarMensaje.mock.calls.at(-1)[0].ts;
  };

  it('acepta el texto ISO, que es lo que manda Baileys', async () => {
    const ts = await cuando('2026-08-21T09:40:25.000Z');
    expect(ts.toISOString()).toBe('2026-08-21T09:40:25.000Z');
  });

  it('acepta milisegundos', async () => {
    const ts = await cuando(1755769225000);
    expect(ts.getTime()).toBe(1755769225000);
  });

  it('acepta segundos sin fecharlo en 1970', async () => {
    // Es como llega `messageTimestamp` en los mensajes. Si se tomara por
    // milisegundos, la llamada saldria fechada en enero de 1970.
    const ts = await cuando(1755769225);
    expect(ts.getUTCFullYear()).toBe(2025);
  });

  it('con una fecha rota usa la de ahora en vez de perder la llamada', async () => {
    // Un «Invalid Date» hace que Postgres rechace la fila entera: la llamada se
    // perderia sin que nadie se entere. Mejor un segundo de desfase.
    const ts = await cuando('esto-no-es-una-fecha');
    expect(Number.isNaN(ts.getTime())).toBe(false);
    expect(Math.abs(Date.now() - ts.getTime())).toBeLessThan(5000);
  });

  it('sin fecha, tambien la de ahora', async () => {
    const ts = await cuando(undefined);
    expect(Number.isNaN(ts.getTime())).toBe(false);
  });
});

describe('terminate', () => {
  beforeEach(() => {
    guardarMensaje.mockReset().mockResolvedValue({ id: 99, ts: new Date() });
    conversacionDe.mockReset().mockResolvedValue({ id: 7, telefono: '34600000001', nombre_push: null });
  });

  it('apaga el cartel sin inventarse un desenlace', async () => {
    await recibir(aviso({ id: 'TERM', from: '34600000001@s.whatsapp.net', status: 'offer' }));
    expect(llamadaSonando('crm-u3')).not.toBeNull();
    const r = await recibir(aviso({ id: 'TERM', from: '34600000001@s.whatsapp.net', status: 'terminate' }));
    expect(llamadaSonando('crm-u3')).toBeNull();
    // No se guarda nada: `terminate` no dice si la cogieron o no.
    expect(guardarMensaje).not.toHaveBeenCalled();
    expect(r.ignorado).toMatch(/terminada/);
  });
});

describe('la llamada en la ficha del prospecto', () => {
  beforeEach(() => {
    guardarMensaje.mockReset().mockResolvedValue({ id: 99, ts: new Date('2026-08-21T10:00:00Z') });
    apuntarInteraccion.mockReset().mockResolvedValue({ id: 5 });
    conversacionDe.mockReset().mockResolvedValue({
      id: 4, telefono: '34622222222', nombre_push: null, lead_id: 2,
    });
  });

  it('una llamada perdida queda en el historial de contactos', async () => {
    // Quien abre un prospecto para ver por donde va no entra en WhatsApp: mira
    // su lista de contactos. Sin esto, las llamadas no estaban ahi.
    await recibir(aviso({ id: 'F1', from: '34622222222@s.whatsapp.net', status: 'timeout' }));
    expect(apuntarInteraccion).toHaveBeenCalledWith(expect.objectContaining({
      leadId: 2, nota: 'Llamada perdida por WhatsApp',
    }));
  });

  it('se apunta a nombre de la gestora cuya linea la recibio', async () => {
    // `created_by` es NOT NULL y quien llama no es usuario del CRM. La gestora
    // de esa linea es quien de verdad tuvo el contacto.
    await recibir(aviso({ id: 'F2', from: '34622222222@s.whatsapp.net', status: 'timeout' }));
    expect(apuntarInteraccion.mock.calls[0][0].userId).toBe(3);   // crm-u3
  });

  it('dice videollamada entera, sin pegar Video delante', async () => {
    await recibir(aviso({ id: 'F3', from: '34622222222@s.whatsapp.net', status: 'reject', isVideo: true }));
    expect(apuntarInteraccion.mock.calls[0][0].nota).toBe('Videollamada rechazada por WhatsApp');
  });

  it('el reintento de Evolution NO la apunta dos veces', async () => {
    // Sin esto la misma llamada saldria dos y tres veces en el historial.
    guardarMensaje.mockResolvedValueOnce(null);   // ya estaba: ON CONFLICT DO NOTHING
    await recibir(aviso({ id: 'F4', from: '34622222222@s.whatsapp.net', status: 'timeout' }));
    expect(apuntarInteraccion).not.toHaveBeenCalled();
  });

  it('sin prospecto atado no se apunta en ninguna ficha', async () => {
    conversacionDe.mockResolvedValue({ id: 9, telefono: '34600000099', nombre_push: null, lead_id: null });
    await recibir(aviso({ id: 'F5', from: '34600000099@s.whatsapp.net', status: 'timeout' }));
    expect(apuntarInteraccion).not.toHaveBeenCalled();
  });

  it('si la ficha falla, la llamada se guarda igual', async () => {
    // La llamada YA esta en el chat: eso es lo que no se puede perder.
    apuntarInteraccion.mockRejectedValue(new Error('base caida'));
    const r = await recibir(aviso({ id: 'F6', from: '34622222222@s.whatsapp.net', status: 'timeout' }));
    expect(r.guardado).toBe(true);
  });
});
