import express from 'express';
import jwt from 'jsonwebtoken';
import { registrar } from './helpers/permisosSinBase.js';

/*
  Facturas de colaboradores (#202) · lo común de las pruebas: la API del módulo
  montada en una app pequeña (como egresosParidad.test.js), el reparto de
  empresas, campus y personas, y el token de cada una.

  Las simulaciones (`vi.mock`) van en cada fichero de pruebas, que es donde
  vitest las sube arriba: aquí solo se importa lo que ya está simulado.
*/

export const API = '/api/facturas-colaborador';

/** La API del módulo, con el manejador de errores del CRM. */
export async function montarApp() {
  const { default: modulo } = await import('../src/modules/facturas-colaborador/index.js');
  const { errorHandler } = await import('../src/shared/middleware/errorHandler.js');
  const app = express();
  app.use(express.json());
  app.use(modulo.prefix, modulo.router);
  app.use(errorHandler);
  return app;
}

/*
  Dos empresas del grupo (A y B), un campus de cada una (y un campus de pruebas
  en A, que nunca sale para elegir) y una persona de cada rol. El admin de A
  solo lleva el campus de A; el de B, el de B.
*/
export const E = { A: 1, B: 2 };
export const P = { A: 10, B: 20, A2: 11, PRUEBAS: 19 };
export const U = { super: 1, adminA: 2, gestora: 3, colaborador: 4, adminB: 5, colaborador2: 6 };

export function sembrar(base) {
  base.vaciar();
  base.empresa(E.A, 'Alfa Formación SL', { direccion: 'Calle Mayor 1', cp: '28001', ciudad: 'Madrid', pais: 'España' });
  base.empresa(E.B, 'Beta Consultoría SL');
  base.campus(P.A, 'Campus Alfa', E.A, { remitente_no_contestar: 'no-contestar@alfa.test' });
  base.campus(P.A2, 'Campus Alfa Online', E.A);
  base.campus(P.PRUEBAS, 'Campus de pruebas', E.A, { es_prueba: true });
  base.campus(P.B, 'Campus Beta', E.B);
  base.persona(U.super, { nombre: 'Super Admin', role: 'superadmin' });
  base.persona(U.adminA, { nombre: 'Admin de Alfa', role: 'admin', campus: [P.A] });
  base.persona(U.gestora, { nombre: 'Gestora', role: 'gestor', campus: [P.A] });
  base.persona(U.colaborador, { nombre: 'Laura Usuario', role: 'colaborador' });
  base.persona(U.adminB, { nombre: 'Admin de Beta', role: 'admin', campus: [P.B] });
  base.persona(U.colaborador2, { nombre: 'Otro Colaborador', role: 'colaborador' });
}

const ROL = Object.fromEntries([
  [U.super, 'superadmin'], [U.adminA, 'admin'], [U.gestora, 'gestor'],
  [U.colaborador, 'colaborador'], [U.adminB, 'admin'], [U.colaborador2, 'colaborador'],
]);

export function token(userId) {
  // Los permisos salen del catálogo (#230, gemela de CRM#423): sin base, el
  // resolver de verdad con la persona que firma el token (helpers/permisosSinBase.js).
  registrar({ userId, role: ROL[userId] });
  return jwt.sign(
    { userId, email: `p${userId}@test.local`, role: ROL[userId], roles_extra: [], customRoleId: null },
    process.env.JWT_SECRET,
    { expiresIn: '1h' },
  );
}

/** La cabecera de sesión de esa persona: `.set(como('adminA'))`. */
export const como = (clave) => ({ Authorization: `Bearer ${token(U[clave])}` });

/** Un PDF mínimo (los primeros bytes son los que miran el tipo de verdad). */
export const PDF = Buffer.from('%PDF-1.4\n% factura de prueba\n');

/** El código del enlace que va en el correo, sacado de la llamada a Brevo (o del HTML). */
export function enlaceDelCorreo(html) {
  const m = String(html).match(/factura-colaborador\/([A-Za-z0-9_-]{40,60})/);
  return m ? m[1] : null;
}
