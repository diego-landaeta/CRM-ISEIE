import { describe, it, expect } from 'vitest';
import { telefonoImposible, telefonoParaWhatsapp } from '@/shared/lib/telefono';

/**
 * Los teléfonos que no pueden ser de nadie (#42).
 *
 * En producción hay doce así. El enlace de WhatsApp abre un chat que no lleva
 * a ninguna parte, no salta ningún error, y la gestora apunta «no contesta» —
 * cuando el número está mal desde que entró por el formulario.
 *
 * Lo que NO hace, y es a propósito: comprobar si el número existe. Eso no se
 * puede saber sin preguntarle a WhatsApp. Solo se marca lo imposible por
 * longitud, que es donde están los doce.
 */

describe('teléfonos imposibles', () => {
  it('los dos ejemplos reales del ticket', () => {
    // «+340»: lo tumba antes el normalizador, así que no hay nada que avisar.
    expect(telefonoParaWhatsapp('+340')).toBeNull();
    // «+5823232»: pasa el filtro de siempre por un dígito, y es el caso que
    // se colaba hasta ahora.
    expect(telefonoImposible('+5823232')).toBe('corto');
  });

  it('un móvil normal no se marca', () => {
    expect(telefonoImposible('+34600123456')).toBeNull();   // España
    expect(telefonoImposible('+573044726552')).toBeNull();  // Colombia
    expect(telefonoImposible('+584121234567')).toBeNull();  // Venezuela
    expect(telefonoImposible('0034600123456')).toBeNull();  // con 00
  });

  it('marca lo que se pasa de largo', () => {
    // E.164 no admite más de 15 dígitos.
    expect(telefonoImposible('+3460012345678901')).toBe('largo');
  });

  it('sin teléfono no hay aviso', () => {
    // No es lo mismo «no hay número» que «el número está mal». El primero ya
    // se dice con un «Sin teléfono» y no necesita un aviso en ámbar.
    expect(telefonoImposible(null)).toBeNull();
    expect(telefonoImposible('')).toBeNull();
    expect(telefonoImposible('No suministrado')).toBeNull();
  });

  it('el número corto sigue estando y el botón también', () => {
    // Se avisa, no se bloquea: la regla es de longitud y hay países que no
    // conocemos. Quitar el botón por una sospecha sería peor.
    expect(telefonoParaWhatsapp('+5823232')).toBe('5823232');
  });
});
