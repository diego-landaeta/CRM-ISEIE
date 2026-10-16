// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { AvisoCasiListo } from '@/modules/certifex/components/piezas';

/*
  Certificaciones sube a producción «casi listo» (Diego, 16/10), igual que en MultiCRM:
  funciona, pero los diplomas aún no llevan la firma del alumno sobre «El interesado»
  (#349 de MultiCRM). Las dos pantallas que emiten lo dicen arriba.
*/
afterEach(cleanup);

describe('aviso «casi listo» de Certifex', () => {
  it('dice que falta la firma del alumno y de dónde saldrá', () => {
    render(<AvisoCasiListo />);
    const aviso = screen.getByRole('note');
    expect(aviso.textContent).toContain('Casi listo');
    expect(aviso.textContent).toContain('sin la firma del alumno');
    expect(aviso.textContent).toContain('solicitud de admisión');
    expect(aviso.textContent).toContain('«El interesado»');
  });
});
