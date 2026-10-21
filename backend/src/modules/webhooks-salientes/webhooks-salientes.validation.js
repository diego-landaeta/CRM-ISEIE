import net from 'node:net';
import { z } from 'zod';

/*
  WEBHOOK DE TRANSFERENCIAS (Diego, 15/10).

  «Enviar esos datos ÚNICAMENTE CUANDO SE PONGA DATOS POR TRANSFERENCIA
  BANCARIA / DEPÓSITO BANCARIO». Por eso aquí solo se pueden elegir esas dos
  formas de cobro: con tarjeta, Stripe, efectivo, Bizum o PayPal no sale nada, y
  no hay forma de configurarlo para que salga. La base dice lo mismo (CHECK de
  la migración 206).
*/
export const METODOS_QUE_DISPARAN = ['transferencia', 'deposito'];
export const AMBITOS = ['todas', 'empresa', 'campus'];

/** El evento que lleva cada forma de cobro (cabecera `X-CRM-Evento` y campo `evento`). */
export const EVENTO_DE = { transferencia: 'cobro.transferencia', deposito: 'cobro.deposito' };

/**
 * ¿Es esta IP de una red interna?
 *
 * Un webhook manda datos de clientes a la URL que alguien escribe. Si esa URL
 * pudiera ser `https://127.0.0.1:3001/...` o la 169.254.169.254 de los
 * metadatos del VPS, el formulario de Conexión serviría para que el propio
 * servidor llamara a sus puertas de dentro (SSRF). Se cortan las privadas, las
 * de bucle, las de enlace local, las de pruebas y las de multidifusión.
 */
export function esIpPrivada(ip) {
  const tipo = net.isIP(ip);
  if (tipo === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127
      || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19))
      || a >= 224;
  }
  if (tipo === 6) {
    const x = ip.toLowerCase();
    if (x === '::' || x === '::1') return true;
    // ::ffff:10.0.0.1 — una IPv4 disfrazada de IPv6.
    const v4 = x.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (v4) return esIpPrivada(v4[1]);
    return /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff');
  }
  return false;
}

/**
 * Qué le pasa a una URL de webhook, o `null` si vale.
 *
 * https obligatoria (el payload lleva nombre, correo, teléfono y DNI del
 * cliente: por http viajaría en claro), sin usuario:contraseña dentro, y que no
 * apunte a una máquina de dentro. La comprobación de DNS —que un nombre público
 * no resuelva a una IP privada— se hace al enviar (`webhooks-salientes.red.js`).
 */
export function revisarUrl(texto) {
  let u;
  try { u = new URL(String(texto || '').trim()); } catch { return 'La URL no es válida'; }
  if (u.protocol !== 'https:') return 'La URL tiene que empezar por https://';
  if (u.username || u.password) return 'La URL no puede llevar usuario ni contraseña dentro';
  const host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host) return 'La URL no tiene servidor';
  if (host === 'localhost' || /\.(localhost|local|internal|lan|home)$/.test(host)) {
    return 'La URL apunta a una máquina de la red interna';
  }
  if (net.isIP(host) && esIpPrivada(host)) return 'La URL apunta a una dirección de la red interna';
  return null;
}

const urlDelWebhook = z.string().trim().min(1, 'Falta la URL').max(2000)
  .superRefine((v, ctx) => {
    const problema = revisarUrl(v);
    if (problema) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problema });
  });

const metodos = z.array(z.enum(METODOS_QUE_DISPARAN, {
  errorMap: () => ({ message: 'Solo se puede elegir transferencia bancaria o depósito bancario' }),
})).min(1, 'Elige al menos una forma de cobro').max(2)
  .transform((l) => [...new Set(l)]);

// El secreto pegado a mano: lo bastante largo para que no se adivine.
const secreto = z.string().trim().min(16, 'El secreto tiene que tener al menos 16 caracteres').max(200);

export const crearWebhookSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre').max(150),
  url: urlDelWebhook,
  ambito: z.enum(AMBITOS).default('campus'),
  issuer_id: z.number().int().positive().nullable().optional(),
  project_id: z.number().int().positive().nullable().optional(),
  metodos: metodos.default(METODOS_QUE_DISPARAN),
  activo: z.boolean().default(true),
  // Sin secreto, se genera uno.
  secreto: secreto.optional(),
});

export const cambiarWebhookSchema = z.object({
  nombre: z.string().trim().min(1, 'Ponle un nombre').max(150).optional(),
  url: urlDelWebhook.optional(),
  ambito: z.enum(AMBITOS).optional(),
  issuer_id: z.number().int().positive().nullable().optional(),
  project_id: z.number().int().positive().nullable().optional(),
  metodos: metodos.optional(),
  activo: z.boolean().optional(),
  // O se pega uno nuevo, o se pide que se genere. Las dos cosas a la vez, no.
  secreto: secreto.optional(),
  regenerar_secreto: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: 'No hay nada que cambiar' })
  .refine((d) => !(d.secreto && d.regenerar_secreto), { message: 'O pegas un secreto o lo generas, no las dos cosas' });

export const listarEnviosSchema = z.object({
  webhookId: z.coerce.number().int().positive().optional(),
  // El ámbito elegido arriba (21/10): los envíos de una empresa no se ven desde otra.
  projectId: z.coerce.number().int().positive().optional(),
  issuerId: z.coerce.number().int().positive().optional(),
  estado: z.enum(['pendiente', 'enviando', 'enviado', 'fallido']).optional(),
  limit: z.coerce.number().int().positive().max(200).default(50),
});
