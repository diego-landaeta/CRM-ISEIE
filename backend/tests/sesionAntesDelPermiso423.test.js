import { describe, it, expect, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import supertest from 'supertest';
import jwt from 'jsonwebtoken';

/**
 * #423, QA de Diego (22/10) · punto 2. `PATCH /api/auth/me/email` llevaba
 * `puede('cuenta.cambiar_correo')` ANTES de `verifyToken`: sin `req.user`
 * todavía, el permiso respondía 401 siempre y el tutor se quedaba sin cambiar
 * su correo (#246). La prueba de guardias no lo vio porque llamaba al guardia
 * con el usuario ya puesto.
 *
 * Aquí, dos cosas:
 *   - la ruta de verdad, con un token de verdad: el tutor entra y la gestora no;
 *   - en TODAS las rutas, la sesión va antes que el permiso.
 */

vi.mock('../src/modules/permissions/permissions.service.js', () => import('./helpers/permisosSinBase.js'));
vi.mock('../src/modules/auth/auth.controller.js', async (original) => ({
  ...(await original()),
  updateMyEmail: (_req, res) => res.json({ success: true, data: { cambiado: true } }),
}));
const { registrar } = await import('./helpers/permisosSinBase.js');
const { default: authRouter } = await import('../src/modules/auth/auth.routes.js');
const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');

const app = express();
app.use(express.json());
app.use('/api/auth', authRouter);
app.use(errorHandler);

const token = (userId, role) => jwt.sign({ userId, role, roles_extra: [] }, process.env.JWT_SECRET, { expiresIn: '5m' });

describe('PATCH /api/auth/me/email (#246, punto 2 del QA de #423)', () => {
  it('el tutor cambia su correo: la sesión se lee antes de mirar el permiso', async () => {
    registrar({ userId: 9101, role: 'tutor' });
    const r = await supertest(app).patch('/api/auth/me/email')
      .set('Authorization', `Bearer ${token(9101, 'tutor')}`).send({ email: 'nuevo@prueba.test' });
    expect(r.status).toBe(200);
  });

  it('una gestora no: 403, no 401', async () => {
    registrar({ userId: 9102, role: 'gestor' });
    const r = await supertest(app).patch('/api/auth/me/email')
      .set('Authorization', `Bearer ${token(9102, 'gestor')}`).send({ email: 'nuevo@prueba.test' });
    expect(r.status).toBe(403);
  });

  it('sin sesión, 401', async () => {
    const r = await supertest(app).patch('/api/auth/me/email').send({ email: 'nuevo@prueba.test' });
    expect(r.status).toBe(401);
  });
});

const MODULOS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/modules');

/** Las reglas de cada ruta, en el orden en que Express las ejecuta. */
async function ordenDeReglas() {
  const salida = [];
  const recorrer = (pila, base, previas) => {
    const delRouter = [...previas];
    for (const capa of pila) {
      if (capa.route) {
        const reglas = [...delRouter, ...capa.route.stack.map((s) => s.handle?.regla?.tipo).filter(Boolean)];
        for (const m of Object.keys(capa.route.methods)) salida.push({ id: `${m.toUpperCase()} ${base}${capa.route.path}`, reglas });
      } else if (capa.handle?.stack) {
        const src = capa.regexp?.source || '';
        const fin = src.indexOf('\/?(?=');
        recorrer(capa.handle.stack, base + (src.startsWith('^') && fin > 0 ? src.slice(1, fin).split('\/').join('/') : ''), delRouter);
      } else if (capa.handle?.regla?.tipo) {
        delRouter.push(capa.handle.regla.tipo);
      }
    }
  };
  for (const d of fs.readdirSync(MODULOS).filter((x) => fs.existsSync(path.join(MODULOS, x, 'index.js')))) {
    const mod = (await import(path.join(MODULOS, d, 'index.js'))).default;
    recorrer(mod.router.stack, mod.prefix, []);
  }
  return salida;
}

describe('en cada ruta, la sesión antes que el permiso (#423)', () => {
  it('ningún `puede` va antes de `verifyToken`', async () => {
    const rutas = await ordenDeReglas();
    expect(rutas.filter((r) => r.reglas.includes('puede')).length).toBeGreaterThan(500);
    const mal = rutas
      .filter((r) => r.reglas.includes('puede'))
      .filter((r) => !r.reglas.includes('token') || r.reglas.indexOf('puede') < r.reglas.indexOf('token'))
      .map((r) => r.id);
    expect(mal).toEqual([]);
  }, 120000);
});
