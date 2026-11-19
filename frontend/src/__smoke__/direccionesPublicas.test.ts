// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  apiPublicUrl, appPublicUrl, formarApiPublica, formarAppPublica,
} from '@/shared/lib/direccionesPublicas';

/**
 * Las direcciones que el CRM enseña para copiar fuera llevan la base de la
 * compilación (`/crm/`, `/testeo/`, `/`, `/staging/`).
 *
 * Finanzas › Integraciones enseñaba el webhook de Stripe como
 * `https://360crm.tech/api/stripe-webhook/<id>`, que da 404: la buena es
 * `https://360crm.tech/crm/api/stripe-webhook/<id>`. La de PayPal, igual, y el
 * iframe del formulario incrustado apuntaba a `/embed/form/...` sin la base.
 */

const CRM360 = 'https://360crm.tech';
const ISEIE = 'https://crm.iseie.com';

describe('formarApiPublica: la dirección de un punto de la API', () => {
  it('en el 360 (producción, /crm/) lleva /crm', () => {
    expect(formarApiPublica('/stripe-webhook/1', { baseUrl: '/crm/', origin: CRM360 }))
      .toBe('https://360crm.tech/crm/api/stripe-webhook/1');
  });

  it('en /testeo/ lleva /testeo', () => {
    expect(formarApiPublica('/paypal-webhook/7', { baseUrl: '/testeo/', origin: CRM360 }))
      .toBe('https://360crm.tech/testeo/api/paypal-webhook/7');
  });

  it('en ISEIE (raíz) no lleva prefijo ni barras dobles', () => {
    const url = formarApiPublica('/stripe-webhook/1', { baseUrl: '/', origin: ISEIE });
    expect(url).toBe('https://crm.iseie.com/api/stripe-webhook/1');
    expect(url.replace('https://', '')).not.toContain('//');
  });

  it('tolera la ruta sin barra inicial, la base sin barras y el origen con barra final', () => {
    expect(formarApiPublica('stripe-webhook/1', { baseUrl: 'crm', origin: `${CRM360}/` }))
      .toBe('https://360crm.tech/crm/api/stripe-webhook/1');
  });

  it('sin base se queda en la raíz', () => {
    expect(formarApiPublica('/mcp', { origin: ISEIE })).toBe('https://crm.iseie.com/api/mcp');
  });
});

describe('formarAppPublica: la dirección de una pantalla', () => {
  it('el iframe del formulario lleva la base', () => {
    expect(formarAppPublica('/embed/form/abc', { baseUrl: '/crm/', origin: CRM360 }))
      .toBe('https://360crm.tech/crm/embed/form/abc');
    expect(formarAppPublica('/embed/form/abc', { baseUrl: '/', origin: ISEIE }))
      .toBe('https://crm.iseie.com/embed/form/abc');
  });
});

describe('apiPublicUrl / appPublicUrl leen la base de la compilación', () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it('con BASE_URL=/crm/ sale …/crm/api/…', () => {
    vi.stubEnv('BASE_URL', '/crm/');
    expect(apiPublicUrl('/stripe-webhook/1')).toBe(`${window.location.origin}/crm/api/stripe-webhook/1`);
    expect(appPublicUrl('/set-password?token=x')).toBe(`${window.location.origin}/crm/set-password?token=x`);
  });

  it('con BASE_URL=/ sale …/api/…, sin //', () => {
    vi.stubEnv('BASE_URL', '/');
    expect(apiPublicUrl('/stripe-webhook/1')).toBe(`${window.location.origin}/api/stripe-webhook/1`);
  });

  it('no hace caso de VITE_API_URL (en ISEIE trae la de producción también al compilar pruebas)', () => {
    vi.stubEnv('BASE_URL', '/testeo/');
    vi.stubEnv('VITE_API_URL', 'https://otro-sitio.example/api');
    expect(apiPublicUrl('/stripe-webhook/1')).toBe(`${window.location.origin}/testeo/api/stripe-webhook/1`);
  });
});

describe('nadie forma a mano una dirección con window.location.origin', () => {
  const SRC = path.resolve(__dirname, '..');
  // Los únicos que pueden: el propio ayudante, y el aviso al salir de WhatsApp,
  // que compara orígenes y abre una ruta que ya lleva la base.
  const PERMITIDOS = [
    /shared[\\/]lib[\\/]direccionesPublicas\.ts$/,
    /modules[\\/]whatsapp[\\/]components[\\/]AvisoAlSalir\.tsx$/,
  ];

  function codigo(dir: string, salida: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'test' || e.name === '__smoke__' || e.name === '__tests__') continue;
        codigo(p, salida);
      } else if (/\.(jsx?|tsx?)$/.test(e.name) && !/\.test\./.test(e.name)) {
        salida.push(p);
      }
    }
    return salida;
  }

  it('las direcciones públicas pasan por direccionesPublicas', () => {
    const malos: string[] = [];
    for (const f of codigo(SRC)) {
      if (PERMITIDOS.some((r) => r.test(f))) continue;
      const lineas = fs.readFileSync(f, 'utf8').split('\n');
      lineas.forEach((l, i) => {
        if (/window\.location\.origin|import\.meta\.env\.VITE_API_URL/.test(l)) {
          malos.push(`${path.relative(SRC, f)}:${i + 1}: ${l.trim()}`);
        }
      });
    }
    expect(malos).toEqual([]);
  });
});
