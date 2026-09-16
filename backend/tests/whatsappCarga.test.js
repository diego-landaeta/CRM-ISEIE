import { describe, it, expect, vi, beforeEach } from 'vitest';

// Que diez gestoras a la vez no tumben la maquina — tarea #45.
//
// Cada pantalla abierta pregunta sola, sin que nadie toque nada: la lista y el
// hilo cada cinco segundos, el contador de sincronizacion cada cuatro. Con diez
// pantallas son unas siete peticiones por segundo sostenidas.
//
// Medido con 382.589 mensajes en la base, dos cosas hacian trabajo tirado:
//
//   · el contador escaneaba la tabla ENTERA cada cuatro segundos por pantalla
//   · el hilo marcaba como leido en cada vuelta, aunque no hubiera nada nuevo:
//     tres consultas y una llamada a WhatsApp para no cambiar nada
//
// Esto fija las dos correcciones. Sin ellas vuelve el escaneo por pantalla.

const query = vi.fn();
vi.mock('../src/shared/config/db.js', () => ({ query: (...a) => query(...a) }));

const evolution = await import('../src/modules/whatsapp/evolution.client.js');
const servicio = await import('../src/modules/whatsapp/chat.service.js');

describe('marcar leido solo cuando hay algo sin leer', () => {
  beforeEach(() => { query.mockReset(); });

  it('con cero sin leer no toca la base ni llama a WhatsApp', async () => {
    await servicio.marcarLeida(55, 0);
    expect(query).not.toHaveBeenCalled();
  });

  it('con mensajes sin leer si trabaja', async () => {
    query.mockResolvedValue({ rows: [] });
    await servicio.marcarLeida(55, 3);
    expect(query).toHaveBeenCalled();
  });

  it('sin saber cuantos hay, trabaja — mas vale de mas que de menos', async () => {
    // El valor por defecto es null y no 0 a proposito: quien llame sin pasarlo
    // no debe quedarse sin marcar leido en silencio.
    query.mockResolvedValue({ rows: [] });
    await servicio.marcarLeida(55);
    expect(query).toHaveBeenCalled();
  });
});

describe('el pulso: quien sabe si entra algo es el webhook', () => {
  beforeEach(() => { query.mockReset(); });

  it('una sesion sin actividad no tiene latido', () => {
    expect(servicio.ultimoLatido('crm-u-nadie')).toBeNull();
  });

  it('un mensaje entrante deja latido, sin consultar la base para saberlo', async () => {
    const instancia = evolution.instanciaDe(77);
    // conversacionDe + guardarMensaje: al modelo le da igual que devuelvan poco,
    // lo que se comprueba es el latido.
    query.mockResolvedValue({ rows: [{ id: 1, instancia, jid: 'x@s.whatsapp.net' }] });
    const antes = Date.now();
    await servicio.recibir({
      event: 'messages.upsert',
      instance: instancia,
      data: {
        key: { remoteJid: '34600111222@s.whatsapp.net', id: 'L1', fromMe: false },
        message: { conversation: 'hola' },
        messageTimestamp: String(Math.floor(Date.now() / 1000)),
      },
    });
    const latido = servicio.ultimoLatido(instancia);
    expect(latido).not.toBeNull();
    expect(latido).toBeGreaterThanOrEqual(antes);
  });

  it('cada sesion lleva su propio latido', async () => {
    // Si se compartiera, a una gestora le saldria «sincronizando» porque otra
    // persona esta recibiendo mensajes.
    const a = evolution.instanciaDe(88);
    const b = evolution.instanciaDe(89);
    query.mockResolvedValue({ rows: [{ id: 1, instancia: a, jid: 'x@s.whatsapp.net' }] });
    await servicio.recibir({
      event: 'messages.upsert', instance: a,
      data: {
        key: { remoteJid: '34600111333@s.whatsapp.net', id: 'L2', fromMe: false },
        message: { conversation: 'hola' }, messageTimestamp: '1700000000',
      },
    });
    expect(servicio.ultimoLatido(a)).not.toBeNull();
    expect(servicio.ultimoLatido(b)).toBeNull();
  });

  it('un aviso descartado no cuenta como latido', async () => {
    // Un mensaje sin instancia no se guarda; tampoco puede hacer creer que hay
    // actividad en ninguna sesion.
    const antes = servicio.ultimoLatido(evolution.instanciaDe(90));
    await servicio.recibir({
      event: 'messages.upsert',
      data: {
        key: { remoteJid: '34600111444@s.whatsapp.net', id: 'L3', fromMe: false },
        message: { conversation: 'hola' }, messageTimestamp: '1700000000',
      },
    });
    expect(servicio.ultimoLatido(evolution.instanciaDe(90))).toBe(antes);
  });
});
