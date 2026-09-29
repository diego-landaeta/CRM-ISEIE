import { describe, it, expect } from 'vitest';
import { PREGUNTAS, limpiarRespuestas, lineaDe, textoDeRespuesta, abreEscribir } from '../src/modules/feedback/preguntas.js';

// La encuesta de feedback (#169). El equipo, 29/09: con una nota de Regular
// para abajo, «deja tu comentario»; y al final, «deja tus comentarios».

const nota = PREGUNTAS.find((p) => p.clave === 'nota_atencion');

describe('el comentario tras una nota baja', () => {
  it('se abre con 3, 2 y 1 —la nota llega como número—, no con 4 ni 5', () => {
    expect([3, 2, 1].map((n) => abreEscribir(nota, n))).toEqual([true, true, true]);
    expect([5, 4].map((n) => abreEscribir(nota, n))).toEqual([false, false]);
  });

  it('se guarda solo si la nota es baja', () => {
    expect(limpiarRespuestas({ motivo: 'precio', nota_atencion: '2', nota_atencion_otro: ' no me llamó ' }))
      .toMatchObject({ nota_atencion: 2, nota_atencion_otro: 'no me llamó' });
    // Puso un 2, escribió, y luego cambió a 5: lo escrito ya no vale.
    expect(limpiarRespuestas({ motivo: 'precio', nota_atencion: 5, nota_atencion_otro: 'no me llamó' }))
      .not.toHaveProperty('nota_atencion_otro');
  });

  it('va pegado a la nota en el historial y en el aviso', () => {
    const r = limpiarRespuestas({ motivo: 'precio', nota_atencion: 1, nota_atencion_otro: 'no me llamó' });
    expect(lineaDe(nota, r)).toBe('1/5 · Muy mal: «no me llamó»');
  });

  it('«Otro motivo» sigue igual', () => {
    const r = limpiarRespuestas({ motivo: 'otro', motivo_otro: 'me mudo' });
    expect(textoDeRespuesta('motivo', r.motivo, r.motivo_otro)).toBe('Otro motivo: «me mudo»');
  });
});

describe('«Deja tus comentarios», al final', () => {
  it('es la última pregunta, de texto y opcional', () => {
    const ultima = PREGUNTAS.at(-1);
    expect(ultima).toMatchObject({ clave: 'comentarios', tipo: 'texto' });
    expect(ultima.obligatoria).toBeFalsy();
  });

  it('se guarda recortada, y en blanco no se guarda', () => {
    expect(limpiarRespuestas({ motivo: 'precio', comentarios: '  Gracias  ' }).comentarios).toBe('Gracias');
    expect(limpiarRespuestas({ motivo: 'precio', comentarios: '   ' })).not.toHaveProperty('comentarios');
    expect(limpiarRespuestas({ motivo: 'precio', comentarios: 'x'.repeat(5000) }).comentarios).toHaveLength(2000);
  });

  it('en el historial, entre comillas', () => {
    expect(textoDeRespuesta('comentarios', 'Gracias')).toBe('«Gracias»');
  });
});
