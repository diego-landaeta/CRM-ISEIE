import { describe, it, expect } from 'vitest';
import { correoDe, primerNombre } from '../src/modules/feedback/feedback.service.js';

/**
 * #213. Carlos, 02/10, sobre el correo de «¿por qué has desistido?»: «Que salga
 * el nombre en el asunto».
 *
 * - El nombre va DELANTE, porque el móvil corta los asuntos largos.
 * - Sin nombre (o «Anónimo», o un correo en su lugar), el asunto de siempre.
 * - «manuel» o «MANUEL», como llegan del formulario, salen «Manuel». Lo mezclado
 *   a propósito (McDonald) se respeta.
 */

const datos = (nombre) => ({ nombre, proyecto: 'Psiko Aprende', theme_color: '#c2587b', project_id: null });
const SIN_NOMBRE = '¿Por qué has desistido de saber más sobre nuestro programa?';

describe('el asunto lleva el nombre', () => {
  it('delante, con el resto igual', () => {
    expect(correoDe(datos('Manuel Casas'), 't').asunto)
      .toBe('Manuel, ¿por qué has desistido de saber más sobre nuestro programa?');
  });

  it.each([[''], [null], ['Anónimo'], ['anonimo 12'], ['manuel@correo.com'], ['600123123']])(
    'sin nombre que valga (%s): el de siempre', (nombre) => {
      expect(correoDe(datos(nombre), 't').asunto).toBe(SIN_NOMBRE);
    });

  it('el saludo y el asunto dicen el mismo nombre', () => {
    const { asunto, html } = correoDe(datos('MANUEL'), 't');
    expect(asunto.startsWith('Manuel, ')).toBe(true);
    expect(html).toContain('Hola, Manuel:');
  });
});

describe('el nombre, bien escrito', () => {
  it.each([
    ['manuel', 'Manuel'],
    ['MANUEL GARCÍA', 'Manuel'],
    ['ÁNGELA', 'Ángela'],
    ['josé-luis pérez', 'José-Luis'],
    ['McDonald', 'McDonald'],
    ['DeLuca', 'DeLuca'],
    ['(Prueba) ana', 'Ana'],
  ])('%s → %s', (entra, sale) => {
    expect(primerNombre(entra)).toBe(sale);
  });
});
