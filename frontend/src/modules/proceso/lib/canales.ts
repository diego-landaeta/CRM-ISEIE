import { Phone, WhatsappLogo, EnvelopeSimple, PaperPlaneTilt } from '@phosphor-icons/react';
import type { ComponentType } from 'react';
import type { IconProps } from '@phosphor-icons/react';

/**
 * Por dónde se contacta en cada paso del proceso.
 *
 * Son cuatro y las decide el servidor: `llamada | whatsapp | email | wasapi`.
 * No se confunden con los de `ChannelBadge`, que son de dónde VINO el
 * prospecto (Meta, Google, TikTok…); estos son por dónde se le habla.
 *
 * EL ORDEN SIGNIFICA ALGO. El primero es con el que se arranca: «se arranca
 * con llamada por centralita virtual; si falla, WhatsApp». Por eso la pantalla
 * deja moverlos dentro del paso y no los ordena ella sola.
 */

export type Canal = 'llamada' | 'whatsapp' | 'email' | 'wasapi';

export const CANALES: Array<{
  clave: Canal;
  nombre: string;
  icon: ComponentType<IconProps>;
}> = [
  { clave: 'llamada', nombre: 'Llamada', icon: Phone },
  { clave: 'whatsapp', nombre: 'WhatsApp', icon: WhatsappLogo },
  { clave: 'email', nombre: 'Email', icon: EnvelopeSimple },
  { clave: 'wasapi', nombre: 'Wasapi', icon: PaperPlaneTilt },
];

const POR_CLAVE = new Map(CANALES.map((c) => [c.clave, c]));

/** El nombre de un canal. Si llega uno que no conocemos, se enseña tal cual
    en vez de esconderlo: es mejor ver «telegram» que ver un hueco. */
export function nombreDeCanal(clave: string): string {
  return POR_CLAVE.get(clave as Canal)?.nombre ?? clave;
}

export function iconoDeCanal(clave: string): ComponentType<IconProps> | null {
  return POR_CLAVE.get(clave as Canal)?.icon ?? null;
}
