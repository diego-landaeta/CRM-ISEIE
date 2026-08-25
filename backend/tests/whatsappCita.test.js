import { describe, it, expect, vi, beforeEach } from 'vitest';

// Que la CITA salga por el cable con la forma que espera Evolution.
//
// Existe por un fallo que se me escapo dos veces seguidas, y las dos por
// mirar donde no era:
//
//   · La primera, en produccion: `quoted` se mandaba como texto —el
//     identificador suelto— y Evolution espera un objeto. Por dentro hace
//     `quoted.key.fromMe`, recibia una cadena y devolvia 400. Responder a un
//     mensaje fallaba SIEMPRE. Es la tarea #62.
//
//   · La segunda, dandolo por arreglado: comprobe que `responde_a` se guardaba
//     en nuestra base y lo di por bueno. Pero eso solo prueba que el CRM se
//     acuerda de la cita —por eso la pintaba en su propio chat— y no que
//     llegue a WhatsApp. No llegaba: en el movil el mensaje salia suelto.
//
// La leccion es la prueba: lo que hay que comprobar es el CUERPO que sale, no
// lo que queda guardado. Por eso aqui se intercepta la peticion.

const pedir = vi.fn();

// La direccion del servicio se lee al CARGAR el modulo, no al llamarlo, asi que
// tiene que estar puesta antes del import. Poniendola en un `beforeEach` el
// modulo ya estaria cargado sin ella y `enviarTexto` saldria por la rama de
// «no configurado» sin llegar a la red — y la prueba pasaria sin probar nada.
process.env.EVOLUTION_URL = 'http://puente.local';
process.env.EVOLUTION_API_KEY = 'x';

// Se simula la salida a la red al nivel mas bajo: `fetch`. Asi se recorre el
// codigo de verdad de `enviarTexto` en vez de un doble suyo, que es justo lo
// que hacia falta — el fallo estaba en el cuerpo que se arma.
beforeEach(() => {
  pedir.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (url, opciones) => {
    pedir(String(url), JSON.parse(opciones?.body || '{}'));
    return { ok: true, status: 201, json: async () => ({ key: { id: 'WA123' } }), text: async () => '' };
  }));
});

const { enviarTexto } = await import('../src/modules/whatsapp/evolution.client.js');

const cuerpoEnviado = () => pedir.mock.calls.at(-1)?.[1];

describe('la cita, tal como sale hacia Evolution', () => {
  const cita = {
    waId: 'ABC123',
    jid: '34600111222@s.whatsapp.net',
    mio: true,
    texto: 'el mensaje al que se responde',
  };

  it('va como OBJETO, nunca como texto suelto', async () => {
    await enviarTexto('34600111222', 'mi respuesta', 'crm-u3', cita);
    const { quoted } = cuerpoEnviado();
    // Lo que reventaba en produccion: Evolution hace `quoted.key.fromMe` y una
    // cadena no tiene `.key`.
    expect(typeof quoted).toBe('object');
    expect(quoted).not.toBe('ABC123');
  });

  it('lleva la clave entera: identificador, conversacion y de quien era', async () => {
    await enviarTexto('34600111222', 'mi respuesta', 'crm-u3', cita);
    const { quoted } = cuerpoEnviado();
    expect(quoted.key.id).toBe('ABC123');
    // El jid hace falta para que WhatsApp sepa en que conversacion buscarlo.
    expect(quoted.key.remoteJid).toBe('34600111222@s.whatsapp.net');
    // Y esto decide de que lado se pinta la cita.
    expect(quoted.key.fromMe).toBe(true);
  });

  it('lleva el texto citado, que es lo que se ve en la burbuja', async () => {
    await enviarTexto('34600111222', 'mi respuesta', 'crm-u3', cita);
    expect(cuerpoEnviado().quoted.message.conversation).toBe('el mensaje al que se responde');
  });

  it('un mensaje del otro va con fromMe en false', async () => {
    await enviarTexto('34600111222', 'mi respuesta', 'crm-u3', { ...cita, mio: false });
    expect(cuerpoEnviado().quoted.key.fromMe).toBe(false);
  });

  it('sin texto guardado se manda vacio, no undefined', async () => {
    // Del historial viejo se guarda el mensaje pero no siempre su texto. Un
    // `conversation: undefined` desaparece al serializar el JSON y llega una
    // cita sin contenido, que en el movil se ve como un hueco.
    await enviarTexto('34600111222', 'mi respuesta', 'crm-u3', { ...cita, texto: null });
    expect(cuerpoEnviado().quoted.message.conversation).toBe('');
  });

  it('sin cita NO se manda el campo', async () => {
    // Mandar `quoted: null` o `quoted: {}` es peor que no mandarlo: Evolution
    // entra igual por la rama de citar y falla al leer la clave.
    await enviarTexto('34600111222', 'un mensaje suelto', 'crm-u3');
    expect(cuerpoEnviado()).not.toHaveProperty('quoted');
  });

  it('el mensaje sigue llevando numero y texto', async () => {
    // Que no se rompa lo de siempre por arreglar la cita.
    await enviarTexto('34600111222', 'hola', 'crm-u3', cita);
    const cuerpo = cuerpoEnviado();
    expect(cuerpo.number).toBe('34600111222');
    expect(cuerpo.text).toBe('hola');
  });
});
