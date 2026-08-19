import { describe, it, expect, vi, beforeEach } from 'vitest';

// Sin gestor de salas configurado: asi sala() no llama por red y se queda en la
// sala unica, que es suficiente para comprobar el recorte y que contraseña sale.
// Estas se leen al cargar el modulo, por eso van antes del import.
process.env.WHATSAPP_SALAS_URL = '';
process.env.WHATSAPP_SALAS_TOKEN = '';

const tieneSalaPropia = vi.fn();
const nombreDe = vi.fn(async () => 'Ana Comercial');
vi.mock('../src/modules/whatsapp/whatsapp.model.js', () => ({
  tieneSalaPropia: (...a) => tieneSalaPropia(...a),
  nombreDe: (...a) => nombreDe(...a),
}));

const { sala } = await import('../src/modules/whatsapp/whatsapp.controller.js');

const CLAVE_USUARIO = 'clave-de-gestora';
const CLAVE_ADMIN = 'clave-de-admin';

function fabricarRes() {
  const res = { cuerpo: null };
  res.json = (c) => { res.cuerpo = c; return res; };
  return res;
}
const pedir = (rol, query = {}) => ({ user: { userId: 6, role: rol }, query });

describe('sala()', () => {
  beforeEach(() => {
    tieneSalaPropia.mockReset();
    process.env.WHATSAPP_NEKO_BASE = 'https://ejemplo.test/wa';
    process.env.WHATSAPP_NEKO_USER_PASSWORD = CLAVE_USUARIO;
    process.env.WHATSAPP_NEKO_ADMIN_PASSWORD = CLAVE_ADMIN;
  });

  it('a quien no le toca sala, no se le enciende ninguna', async () => {
    tieneSalaPropia.mockResolvedValue(false);
    const res = fabricarRes();
    await sala(pedir('superadmin'), res, () => {});
    expect(res.cuerpo.data.configurada).toBe(false);
    expect(res.cuerpo.data.motivo).toMatch(/no tienes whatsapp propio/i);
    expect(res.cuerpo.data.url).toBeUndefined();
  });

  it('a una gestora si', async () => {
    tieneSalaPropia.mockResolvedValue(true);
    const res = fabricarRes();
    await sala(pedir('gestor'), res, () => {});
    expect(res.cuerpo.data.configurada).toBe(true);
    expect(res.cuerpo.data.url).toContain('ejemplo.test');
  });

  // Lo importante: la clave viaja DENTRO de la direccion del marco y acaba en
  // la consola del navegador. La de admin abre TODAS las salas.
  it('nunca entrega la clave de admin, ni siendo superadmin', async () => {
    tieneSalaPropia.mockResolvedValue(true);
    const res = fabricarRes();
    await sala(pedir('superadmin'), res, () => {});
    expect(res.cuerpo.data.url).toContain(encodeURIComponent(CLAVE_USUARIO));
    expect(res.cuerpo.data.url).not.toContain(CLAVE_ADMIN);
    expect(res.cuerpo.data.mandaAqui).toBe(false);
  });

  it('comprueba el derecho de la persona cuya sala se pide, no el de quien pregunta', async () => {
    tieneSalaPropia.mockResolvedValue(true);
    await sala(pedir('superadmin', { userId: '11' }), fabricarRes(), () => {});
    expect(tieneSalaPropia).toHaveBeenCalledWith(11);
  });

  it('a una gestora le da la suya aunque pida la de otra', async () => {
    tieneSalaPropia.mockResolvedValue(true);
    await sala(pedir('gestor', { userId: '99' }), fabricarRes(), () => {});
    expect(tieneSalaPropia).toHaveBeenCalledWith(6);
  });
});
