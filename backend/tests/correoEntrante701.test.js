import { describe, it, expect } from 'vitest';
import { claveDeEntrada, hayBuzonQueLeer } from '../src/shared/services/correo-entrante.service.js';

/**
 * El correo que entra. Segunda mitad del CRM#146.
 *
 * Angel: «un panel de visualizacion de todo el webmail, para ver mensajes
 * enviados, recibidos etc».
 *
 * Lo que se prueba aqui es lo unico que se puede probar sin un buzon delante:
 * que sin credenciales no se intenta nada, y la regla que evita los duplicados.
 * Lo otro —que Hostinger conteste— se comprueba leyendo el buzon, y asi se hizo:
 * 76 correos la primera vez, 0 nuevos la segunda.
 */

describe('sin buzon configurado', () => {
  it('no se intenta leer nada, y eso NO es un error', () => {
    // En las pruebas no hay IMAP_USER ni SMTP_USER. Un CRM sin buzon funciona
    // igual que antes, solo que sin la pestaña de recibidos.
    expect(hayBuzonQueLeer()).toBe(false);
  });
});

describe('la clave que evita los duplicados', () => {
  /**
   * Es el `Message-ID`, que lo pone quien manda y no cambia nunca. Con el indice
   * unico que ya tiene la columna, releer el buzon no duplica — y eso es lo que
   * permite recuperarse de un corte sin llevar la cuenta por donde se iba.
   */
  it('el mismo correo da la misma clave, leido cuantas veces sea', () => {
    const m = { messageId: '<abc@gmail.com>', de: 'ana@x.com', asunto: 'Hola', fecha: new Date() };
    expect(claveDeEntrada(m)).toBe('entrada:<abc@gmail.com>');
    expect(claveDeEntrada(m)).toBe(claveDeEntrada({ ...m, fecha: new Date(0) }));
  });

  it('va con prefijo, para no chocar con las claves de los envios', () => {
    expect(claveDeEntrada({ messageId: '<a@b>' })).toMatch(/^entrada:/);
  });

  it('dos correos distintos no comparten clave', () => {
    expect(claveDeEntrada({ messageId: '<uno@x>' }))
      .not.toBe(claveDeEntrada({ messageId: '<dos@x>' }));
  });

  it('sin Message-ID se compone uno, que los hay sin el', () => {
    const f = new Date('2026-09-15T10:00:00Z');
    const a = claveDeEntrada({ de: 'ana@x.com', asunto: 'Factura', fecha: f });
    expect(a).toContain('entrada:sin-id:');
    expect(a).toContain('ana@x.com');
    // Mismo remitente, mismo instante y mismo asunto: es el mismo correo.
    expect(a).toBe(claveDeEntrada({ de: 'ana@x.com', asunto: 'Factura', fecha: f }));
    // Distinto asunto, correo distinto.
    expect(a).not.toBe(claveDeEntrada({ de: 'ana@x.com', asunto: 'Otra cosa', fecha: f }));
  });

  it('nunca pasa del limite de la columna', () => {
    const largo = claveDeEntrada({ de: 'x'.repeat(400), asunto: 'y'.repeat(400), fecha: new Date() });
    expect(largo.length).toBeLessThanOrEqual(500);
  });
});
