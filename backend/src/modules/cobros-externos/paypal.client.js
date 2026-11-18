/**
 * Las llamadas a la API REST de PayPal (#766). Solo LECTURA: no cobra, no
 * devuelve, no crea nada en la cuenta.
 *
 *   token        POST /v1/oauth2/token (client_credentials)
 *   cobros       GET  /v1/reporting/transactions  (la API de informes: trae
 *                el correo y el nombre de quien paga; máximo 31 días por
 *                petición y PayPal la rellena con unas horas de retraso)
 *   pedido       GET  /v2/checkout/orders/:id     (quién pagó, para el webhook)
 *   firma        POST /v1/notifications/verify-webhook-signature
 *
 * La dirección es la de PayPal y nada más: «live» o «sandbox» según la tarjeta
 * del campus. No hay variable de entorno para cambiarla —igual que con Stripe,
 * poder redirigir las llamadas de dinero desde un `.env` es una palanca que no
 * debe existir—. Las pruebas sustituyen `fetch`.
 */
const BASES = {
  live: 'https://api-m.paypal.com',
  sandbox: 'https://api-m.sandbox.paypal.com',
};

export function baseDePaypal(modo) {
  return modo === 'sandbox' ? BASES.sandbox : BASES.live;
}

// El token dura ~9 horas; se guarda en memoria por credencial y se pide otro
// cinco minutos antes de que caduque.
const tokens = new Map();

export function _olvidarTokens() { tokens.clear(); }

export async function pedirToken({ clientId, secret, modo }) {
  const clave = `${modo}:${clientId}`;
  const guardado = tokens.get(clave);
  if (guardado && guardado.caduca > Date.now()) return guardado.token;
  const r = await fetch(`${baseDePaypal(modo)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: 'grant_type=client_credentials',
  });
  if (r.status === 401) throw new Error('PayPal no reconoce el client id o el secreto (401)');
  if (!r.ok) throw new Error(`PayPal token HTTP ${r.status}`);
  const data = await r.json();
  if (!data?.access_token) throw new Error('PayPal no ha devuelto token');
  const segundos = Number(data.expires_in) || 3600;
  tokens.set(clave, { token: data.access_token, caduca: Date.now() + Math.max(60, segundos - 300) * 1000 });
  return data.access_token;
}

async function pedir(cred, ruta, { method = 'GET', body } = {}) {
  const token = await pedirToken(cred);
  const r = await fetch(`${baseDePaypal(cred.modo)}${ruta}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  if (r.status === 401) tokens.delete(`${cred.modo}:${cred.clientId}`);
  if (!r.ok) throw new Error(`PayPal ${ruta.split('?')[0]} HTTP ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}

/** PayPal quiere las fechas como `2026-11-17T10:00:00-0000`, sin milisegundos. */
export function fechaPaypal(d) {
  return new Date(d).toISOString().replace(/\.\d{3}Z$/, '-0000');
}

/**
 * Una página de movimientos entre dos fechas (31 días como mucho).
 * Devuelve `{ transacciones, paginas }`.
 */
export async function transacciones(cred, { desde, hasta, pagina = 1 }) {
  const p = new URLSearchParams({
    start_date: fechaPaypal(desde),
    end_date: fechaPaypal(hasta),
    fields: 'transaction_info,payer_info',
    page_size: '500',
    page: String(pagina),
  });
  const data = await pedir(cred, `/v1/reporting/transactions?${p}`);
  return {
    transacciones: data.transaction_details || [],
    paginas: Number(data.total_pages) || 1,
  };
}

/** Quién pagó un pedido de Checkout (correo y nombre). null si no se puede saber. */
export async function pagadorDelPedido(cred, orderId) {
  if (!orderId || !/^[A-Za-z0-9-]+$/.test(orderId)) return null;
  try {
    const o = await pedir(cred, `/v2/checkout/orders/${orderId}`);
    const nombre = [o?.payer?.name?.given_name, o?.payer?.name?.surname].filter(Boolean).join(' ');
    return { email: o?.payer?.email_address || null, nombre: nombre || null, payerId: o?.payer?.payer_id || null };
  } catch {
    return null;
  }
}

/**
 * ¿El aviso viene de PayPal? Se le pregunta a PayPal con las cabeceras del
 * aviso y el id del webhook del campus. Sin id de webhook, no se acepta nada.
 */
export async function verificarFirma(cred, { webhookId, cabeceras, evento }) {
  const h = (k) => cabeceras[k] || cabeceras[k.toLowerCase()];
  const campos = {
    auth_algo: h('paypal-auth-algo'),
    cert_url: h('paypal-cert-url'),
    transmission_id: h('paypal-transmission-id'),
    transmission_sig: h('paypal-transmission-sig'),
    transmission_time: h('paypal-transmission-time'),
  };
  if (!webhookId || Object.values(campos).some((v) => !v)) return false;
  // El certificado solo puede venir de PayPal: si no, cualquiera firmaría con el suyo.
  try {
    const u = new URL(campos.cert_url);
    if (u.protocol !== 'https:' || !/(^|\.)paypal\.com$/i.test(u.hostname)) return false;
  } catch { return false; }
  const r = await pedir(cred, '/v1/notifications/verify-webhook-signature', {
    method: 'POST',
    body: { ...campos, webhook_id: webhookId, webhook_event: evento },
  });
  return r?.verification_status === 'SUCCESS';
}
