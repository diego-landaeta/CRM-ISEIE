/**
 * Las direcciones COMPLETAS que el CRM enseña para copiar y pegar fuera: los
 * webhooks de Stripe y PayPal, los de Make, admisión y prospectos, el MCP, el
 * widget, el enlace de invitación, el formulario incrustado...
 *
 * El CRM no vive siempre en la raíz del dominio: en el 360 cuelga de `/crm/`
 * (producción) y de `/testeo/` (pruebas); ISEIE, de `/` y de `/staging/`. La
 * pantalla de Integraciones formaba la del webhook con
 * `window.location.origin + '/api'`, se comía el `/crm` y daba un 404.
 *
 * Por eso la base sale de `import.meta.env.BASE_URL`, que es la misma de la que
 * sale `API_BASE_URL` (shared/api/client.js): la dirección que se enseña es la
 * misma que usa el propio CRM para hablar con su API. No se lee
 * `VITE_API_URL`: el cliente no la usa, y en ISEIE el `.env.production` la trae
 * fija a producción, así que una compilación de pruebas enseñaría la de
 * producción.
 *
 * La prueba `direccionesPublicas` impide volver a formar a mano una dirección
 * con `window.location.origin`.
 */

export interface EntornoDireccion {
  /** `import.meta.env.BASE_URL`: '/', '/crm/', '/testeo/'... */
  baseUrl?: string;
  /** `window.location.origin`: 'https://360crm.tech' */
  origin?: string;
}

const sinBarraFinal = (s: string): string => s.replace(/\/+$/, '');
const conBarraInicial = (s: string): string => (s === '' || s.startsWith('/') ? s : `/${s}`);

/** La raíz de la aplicación sin barra final: 'https://360crm.tech/crm' o 'https://crm.iseie.com'. */
export function raizPublica({ baseUrl, origin }: EntornoDireccion): string {
  const base = sinBarraFinal(conBarraInicial(String(baseUrl || '/').trim()));
  return `${sinBarraFinal(String(origin || ''))}${base}`;
}

/** Una pantalla del CRM, completa: `formarAppPublica('/set-password?token=x', e)`. */
export function formarAppPublica(ruta: string, entorno: EntornoDireccion): string {
  return `${raizPublica(entorno)}${conBarraInicial(ruta)}`;
}

/** Un punto de la API, completo: `formarApiPublica('/stripe-webhook/1', e)`. */
export function formarApiPublica(ruta: string, entorno: EntornoDireccion): string {
  return `${raizPublica(entorno)}/api${conBarraInicial(ruta)}`;
}

function entornoActual(): EntornoDireccion {
  return {
    baseUrl: import.meta.env.BASE_URL,
    origin: typeof window !== 'undefined' ? window.location.origin : '',
  };
}

/** `apiPublicUrl('/stripe-webhook/1')` → 'https://360crm.tech/crm/api/stripe-webhook/1' */
export function apiPublicUrl(ruta: string): string {
  return formarApiPublica(ruta, entornoActual());
}

/** `appPublicUrl('/embed/form/abc')` → 'https://360crm.tech/crm/embed/form/abc' */
export function appPublicUrl(ruta: string): string {
  return formarAppPublica(ruta, entornoActual());
}
