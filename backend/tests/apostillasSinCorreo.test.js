import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

/**
 * NINGÚN CAMINO DE LAS APOSTILLAS ESCRIBE AL ALUMNO (CRM#1130 / CRM-ISEIE#786).
 *
 * Diego, 25/11/2026: «NUNCA se manda un correo automático al alumno o prospecto
 * por la apostilla, ni al cambiar de estado ni por atasco». Los avisos son la
 * campana del CRM, a su gestora o a los admins.
 *
 * Sin base: se recorre todo lo que importan los ficheros de apostillas y su
 * tarea programada —también lo que importa lo importado, y los `import()`
 * dinámicos— y no puede aparecer nada que mande correos (Brevo, plantillas de
 * correo, buzones, WhatsApp…). El único camino que sí toca código de otros es
 * el del cobro de un link de Stripe (`createSale`), y ese no está en el módulo:
 * lo llama Links de pago, como cualquier otra venta.
 */

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(AQUI, '..', 'src');
const MODULO = path.join(SRC, 'modules', 'apostillas');
const ENTRADAS = [
  ...fs.readdirSync(MODULO).filter((f) => f.endsWith('.js')).map((f) => path.join(MODULO, f)),
  path.join(SRC, 'jobs', 'apostillasScheduler.js'),
];

// Lo que manda correos o mensajes a fuera.
const PROHIBIDO = /(brevo|correo|email|mail|smtp|whatsapp|plantilla|sendEmail|enviarCorreo)/i;
// Lo que el módulo NO recorre por dentro: lo llama solo `ventaDeApostillaDelCargo`,
// desde Links de pago, y no es un aviso de apostilla.
const FUERA = [path.join(SRC, 'modules', 'sales', 'sales.service.js')];

function importsDe(fichero) {
  const s = fs.readFileSync(fichero, 'utf8');
  const out = [];
  for (const m of s.matchAll(/(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of s.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

function recorrer() {
  const vistos = new Set();
  const pendientes = [...ENTRADAS];
  const malos = [];
  while (pendientes.length) {
    const f = pendientes.pop();
    if (vistos.has(f)) continue;
    vistos.add(f);
    for (const imp of importsDe(f)) {
      if (!imp.startsWith('.')) continue; // paquetes de npm: ninguno manda correo por sí solo
      const destino = path.resolve(path.dirname(f), imp);
      if (FUERA.includes(destino)) continue;
      if (PROHIBIDO.test(path.basename(destino))) malos.push(`${path.relative(SRC, f)} → ${imp}`);
      if (fs.existsSync(destino)) pendientes.push(destino);
    }
  }
  return { vistos, malos };
}

describe('apostillas: sin correos al alumno', () => {
  it('ningún fichero de apostillas ni nada de lo que importa manda correos', () => {
    const { vistos, malos } = recorrer();
    expect(vistos.size).toBeGreaterThan(ENTRADAS.length);
    expect(malos).toEqual([]);
  });

  it('los avisos salen solo por la campana (notifyUsers)', () => {
    const avisos = fs.readFileSync(path.join(MODULO, 'apostillas.avisos.js'), 'utf8');
    expect(avisos).toMatch(/notifyUsers\(/);
    expect(avisos).not.toMatch(/sendEmail|enviarCorreo|sendTransac/);
  });

  it('la prueba sabe ver un correo: un import de Brevo la haría fallar', () => {
    expect(PROHIBIDO.test('brevo.service.js')).toBe(true);
    expect(PROHIBIDO.test('email-plantilla.service.js')).toBe(true);
    expect(PROHIBIDO.test('notifications.service.js')).toBe(false);
  });
});
