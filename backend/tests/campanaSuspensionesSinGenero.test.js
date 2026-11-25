import { describe, it, expect } from 'vitest';
import { tituloDeRevisar } from '../src/modules/matricula-moodle/matricula-moodle.service.js';

/**
 * Los avisos de suspensión en Moodle, sin género (QA de /staging, 25/11/2026: decía
 * «María Alumna: suspendido», en masculino para todas). Lo suspendido es la cuenta del
 * campus o la matrícula de un curso, y eso concuerda siempre. Sin base.
 *
 * Aquí, el aviso «para revisar» de la matrícula automática. La campana de suspensiones
 * y reactivaciones que avisa el plugin (CRM#531) está en staging y no en main: su parte
 * de esta prueba llega con ella.
 */

const MASCULINO = /\b(suspendido|reactivado|alumno)\b/i;

describe('matrícula automática «para revisar»: el título, sin género', () => {
  const fila = { alumno_nombre: 'María Alumna', campus_nombre: 'Psiko Aprende' };
  it('cuenta suspendida, matrícula suspendida y rechazada', () => {
    expect(tituloDeRevisar({ tipo: 'suspendido', ambito: 'cuenta' }, fila)).toBe('Cuenta suspendida en Moodle: María Alumna (Psiko Aprende)');
    expect(tituloDeRevisar({ tipo: 'suspendido', ambito: 'curso' }, fila)).toBe('Matrícula suspendida en Moodle: María Alumna (Psiko Aprende)');
    expect(tituloDeRevisar({ tipo: 'rechazada' }, fila)).toBe('Matrícula rechazada por Moodle: María Alumna (Psiko Aprende)');
  });
  it('sin nombre, «sin nombre» (no «alumno»)', () => {
    expect(tituloDeRevisar({ tipo: 'suspendido', ambito: 'cuenta' }, { campus_nombre: 'Psiko Aprende' }))
      .toBe('Cuenta suspendida en Moodle: sin nombre (Psiko Aprende)');
    expect(tituloDeRevisar({ tipo: 'rechazada' }, { campus_nombre: 'X' })).not.toMatch(MASCULINO);
  });
});
