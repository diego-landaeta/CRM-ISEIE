// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { useState } from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import EnvioFacturaCampos, {
  aEnvioFactura, envioInicial, faltaConfirmar, NOTA_LA_ENVIA_LA_GESTORA, type EnvioEnEdicion,
} from './EnvioFacturaCampos';

/*
  CRM#764 (gemela CRM-ISEIE#452), 24/11 · «Enviar factura automáticamente: Sí / No»
  y «Enviar a este correo», con «Confirmar» o «Editar».
*/

function Montado({ emailFicha, inicial }: { emailFicha: string | null; inicial?: Partial<EnvioEnEdicion> }) {
  const [v, setV] = useState<EnvioEnEdicion>(() => envioInicial(emailFicha, inicial));
  return (
    <>
      <EnvioFacturaCampos value={v} onChange={setV} emailFicha={emailFicha} />
      <pre data-testid="valor">{JSON.stringify(aEnvioFactura(v, emailFicha))}</pre>
      <span data-testid="falta">{String(faltaConfirmar(v, emailFicha))}</span>
    </>
  );
}

// Sin jest-dom y limpiando a mano: la misma prueba en los dos CRM.
afterEach(() => cleanup());

describe('Enviar factura automáticamente', () => {
  it('de serie, Sí y el correo de la ficha, sin confirmar todavía', () => {
    render(<Montado emailFicha="ana@example.com" />);
    expect(screen.getByRole('radio', { name: 'Sí' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('ana@example.com')).toBeTruthy();
    expect(screen.getByTestId('falta').textContent).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(screen.getByText('Confirmado')).toBeTruthy();
    expect(screen.getByTestId('falta').textContent).toBe('false');
    expect(JSON.parse(screen.getByTestId('valor').textContent || '{}')).toEqual({ auto: true, email: 'ana@example.com' });
  });

  it('con No, la coletilla: la factura se emite igual y la envía la gestora', () => {
    render(<Montado emailFicha="ana@example.com" />);
    fireEvent.click(screen.getByRole('radio', { name: 'No' }));
    expect(screen.getByText(`${NOTA_LA_ENVIA_LA_GESTORA}.`)).toBeTruthy();
    expect(JSON.parse(screen.getByTestId('valor').textContent || '{}').auto).toBe(false);
  });

  it('Editar deja escribir otro; un correo mal escrito no se confirma', () => {
    render(<Montado emailFicha="ana@example.com" />);
    fireEvent.click(screen.getByRole('button', { name: /Editar/ }));
    const campo = screen.getByLabelText(/Enviar a este correo/);
    fireEvent.change(campo, { target: { value: 'esto no' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(screen.getByRole('alert').textContent).toMatch(/correo válido/);
    expect(screen.getByTestId('falta').textContent).toBe('true');
    fireEvent.change(campo, { target: { value: 'Facturas.Ana@Example.com' } });
    fireEvent.click(screen.getByRole('button', { name: /Confirmar/ }));
    expect(JSON.parse(screen.getByTestId('valor').textContent || '{}').email).toBe('facturas.ana@example.com');
    expect(screen.getByTestId('falta').textContent).toBe('false');
  });

  it('sin correo en la ficha se abre para escribirlo; con «sin correo vale», se puede seguir', () => {
    render(<Montado emailFicha={null} />);
    expect(screen.getByLabelText(/Enviar a este correo/)).toBeTruthy();
    const v = envioInicial(null);
    expect(faltaConfirmar(v, null)).toBe(true);
    expect(faltaConfirmar(v, null, true)).toBe(false);
    expect(aEnvioFactura(v, null)).toEqual({ auto: true, email: null });
  });
});
