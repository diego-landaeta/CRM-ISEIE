import { describe, it, expect } from 'vitest';
import { tituloDelCambio } from '../src/modules/consultas/consultas.estadoAlumno.js';
import { tituloDeRevisar } from '../src/modules/matricula-moodle/matricula-moodle.service.js';
import { TIPOS } from '../src/modules/notifications/tipos.js';

/**
 * La campana de suspensiones de Moodle, sin género (QA de /staging, 25/11/2026: decía
 * «María Alumna: suspendido», en masculino para todas). Lo que se suspende o se reactiva
 * es la cuenta del campus o la matrícula de un curso, y eso concuerda siempre.
 * Sin base: son las funciones que escriben el título.
 */

const MASCULINO = /\b(suspendido|reactivado|alumno)\b/i;

describe('campana de suspensiones de Moodle: el título, sin género', () => {
  it('cuenta y matrícula, suspendida y reactivada', () => {
    expect(tituloDelCambio({ quien: 'María Alumna', suspendido: true, enCurso: false })).toBe('María Alumna: cuenta suspendida en Moodle');
    expect(tituloDelCambio({ quien: 'María Alumna', suspendido: true, enCurso: true })).toBe('María Alumna: matrícula suspendida en Moodle');
    expect(tituloDelCambio({ quien: 'María Alumna', suspendido: false, enCurso: false })).toBe('María Alumna: cuenta reactivada en Moodle');
    expect(tituloDelCambio({ quien: 'María Alumna', suspendido: false, enCurso: true })).toBe('María Alumna: matrícula reactivada en Moodle');
  });

  it('sin nombre: la frase sola, sin «Un alumno»', () => {
    expect(tituloDelCambio({ quien: null, suspendido: true, enCurso: false })).toBe('Cuenta suspendida en Moodle');
    expect(tituloDelCambio({ quien: '  ', suspendido: false, enCurso: true })).toBe('Matrícula reactivada en Moodle');
  });

  it('ningún caso dice «suspendido», «reactivado» ni «alumno»', () => {
    for (const suspendido of [true, false]) {
      for (const enCurso of [true, false]) {
        for (const quien of ['Pedro Prueba', null]) {
          expect(tituloDelCambio({ quien, suspendido, enCurso })).not.toMatch(MASCULINO);
        }
      }
    }
  });

  it('el nombre de los tipos en las preferencias de avisos, también', () => {
    expect(TIPOS.moodle_alumno_suspendido.etiqueta).toBe('Suspensión en Moodle');
    expect(TIPOS.moodle_alumno_reactivado.etiqueta).toBe('Reactivación en Moodle');
    for (const t of ['moodle_alumno_suspendido', 'moodle_alumno_reactivado']) {
      expect(TIPOS[t].etiqueta).not.toMatch(MASCULINO);
      // «Se ha suspendido» es invariable; lo que no vale es «un alumno tuyo».
      expect(TIPOS[t].descripcion).not.toMatch(/(alumno|tuyo)/i);
    }
  });
});

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
