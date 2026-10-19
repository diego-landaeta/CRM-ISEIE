// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
  «Campos personalizados» con las piezas comunes (#106), como en MultiCRM: el
  campo tal como sale en los formularios (CustomFieldRenderer) tenía su copia
  de la clase de los campos —40 px y otro fondo—, la etiqueta a mano con un
  rojo suelto y «Si» sin tilde. En la pantalla donde se definen faltaban
  tildes y los avisos no decían dónde estaba el problema.
*/

import CustomFieldRenderer from '@/modules/field-definitions/components/CustomFieldRenderer';

const campo = (type, extra = {}) => ({ id: 1, field_key: 'k', label: 'Mi campo', type, required: true, ...extra });

describe('Campos personalizados (#106)', () => {
  afterEach(() => cleanup());

  it('el campo, con el Field y la clase comunes (la copia era de 40 px)', () => {
    render(<CustomFieldRenderer field={campo('text')} value="" />);
    const c = screen.getByLabelText(/^Mi campo/);
    expect(c.className).toMatch(/h-9/);
    expect(c.className).toMatch(/bg-muted\/50/);
    expect(screen.getByText('(obligatorio)')).toBeInTheDocument();
  });

  it('el área de texto con la clase común', () => {
    render(<CustomFieldRenderer field={campo('textarea')} value="" />);
    expect(screen.getByLabelText(/^Mi campo/).className).toMatch(/h-9 .*h-auto/);
  });

  it('el sí/no dice «Sí», con tilde', () => {
    render(<CustomFieldRenderer field={campo('boolean', { required: false })} value />);
    expect(screen.getByText('Sí')).toBeInTheDocument();
  });

  it('la pantalla de definir campos, con tildes y avisos que dicen dónde', () => {
    const texto = readFileSync(resolve(__dirname, '../modules/field-definitions/pages/FieldDefinitionsPage.tsx'), 'utf8');
    for (const viejo of ["'Numero'", "'Si/No'", 'Clave invalida', 'minuscula', 'especificos', 'Asi se veran']) {
      expect(texto).not.toContain(viejo);
    }
    expect(texto).toContain('En «Clave interna»');
    expect(texto).toContain('Escríbela en «Etiqueta visible»');
  });
});
