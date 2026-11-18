// Pedir acceso o permiso (CRM#820).
//
// «Dale acceso a X», «se me cerró Claude», «necesito permisos de tutor»: le
// llegaban a Diego por chat. Ahora se piden desde el CRM —el menú de usuario o
// la pantalla de «No tienes acceso»— y entran como un ticket de Soporte del
// tipo «acceso», en la misma bandeja que el resto de tickets.
//
// NO crea usuarios ni da permisos: solo deja la petición apuntada para que
// soporte la prepare y la confirme quien pueda.

import client from '@/shared/api/client';

export type TipoDeAcceso = 'alta' | 'permiso' | 'campus' | 'claude' | 'otro';

export const TIPOS_DE_ACCESO: ReadonlyArray<{ value: TipoDeAcceso; label: string; ayuda: string }> = [
  { value: 'permiso', label: 'Un permiso', ayuda: 'Algo que no te deja hacer o ver el CRM.' },
  { value: 'alta', label: 'Dar de alta a una persona', ayuda: 'Alguien nuevo que necesita entrar al CRM.' },
  { value: 'campus', label: 'Acceso a un campus', ayuda: 'Un campus o una empresa que no te sale.' },
  { value: 'claude', label: 'Acceso a Claude / MCP', ayuda: 'Conectar Claude al CRM, o se te ha cerrado.' },
  { value: 'otro', label: 'Otra cosa', ayuda: 'Cuéntalo en la explicación.' },
];

/** Lo que llega al abrir el formulario: desde «No tienes acceso», el permiso que falta. */
export interface PeticionInicial {
  tipo?: TipoDeAcceso;
  permiso?: string | null;
}

export interface FormularioDeAcceso {
  tipo: TipoDeAcceso | '';
  permiso: string;
  nombre: string;
  correo: string;
  /** Un campus suyo de la lista, o '' si es otro (va escrito en `campus`). */
  projectId: string;
  campus: string;
  explicacion: string;
}

export function formularioVacio(inicial: PeticionInicial = {}): FormularioDeAcceso {
  return {
    tipo: inicial.tipo || (inicial.permiso ? 'permiso' : ''),
    permiso: inicial.permiso || '',
    nombre: '',
    correo: '',
    projectId: '',
    campus: '',
    explicacion: '',
  };
}

const CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CLAVE = /^[a-z][a-z0-9_-]*\.[a-z][a-z0-9_]*$/;

/**
 * Lo que falta o está mal, campo por campo. Son las mismas reglas que mira el
 * servidor (`pedirAccesoSchema`): aquí solo sirven para decirlo antes de enviar.
 */
export function erroresDe(f: FormularioDeAcceso): Partial<Record<keyof FormularioDeAcceso, string>> {
  const e: Partial<Record<keyof FormularioDeAcceso, string>> = {};
  if (!f.tipo) e.tipo = 'Elige qué necesitas';
  if (f.tipo === 'alta') {
    if (!f.nombre.trim()) e.nombre = 'Falta el nombre de la persona';
    if (!f.correo.trim()) e.correo = 'Falta el correo de la persona';
    else if (!CORREO.test(f.correo.trim())) e.correo = 'El correo no es válido';
  }
  if (f.permiso.trim() && !CLAVE.test(f.permiso.trim())) e.permiso = 'La clave tiene la forma «recurso.acción», como leads.view';
  if (f.explicacion.trim().length < 5) e.explicacion = 'Explica un poco más qué necesitas';
  return e;
}

/** El cuerpo de `POST /soporte/accesos`: solo lo que toca a lo que se pide. */
export function cuerpoDePeticion(f: FormularioDeAcceso, url: string) {
  const cuerpo: Record<string, unknown> = {
    tipo: f.tipo,
    explicacion: f.explicacion.trim(),
    url,
  };
  if (f.permiso.trim()) cuerpo.permiso = f.permiso.trim();
  if (f.tipo === 'alta') {
    cuerpo.nombre = f.nombre.trim();
    cuerpo.correo = f.correo.trim();
  }
  if (f.projectId) cuerpo.projectId = Number(f.projectId);
  else if (f.campus.trim()) cuerpo.campus = f.campus.trim();
  return cuerpo;
}

export async function pedirAcceso(cuerpo: Record<string, unknown>) {
  const r = await client.post('/soporte/accesos', cuerpo);
  // La bandeja de tickets se recarga sola con este evento.
  window.dispatchEvent(new Event('crm:tickets-changed'));
  return r;
}

/** Mover una petición (en preparación, hecha, cerrada), con una nota opcional para quien la pidió. */
export async function moverPeticion(id: string, status: string, nota?: string) {
  const r = await client.patch(`/soporte/accesos/${id}`, nota ? { status, nota } : { status });
  window.dispatchEvent(new Event('crm:tickets-changed'));
  return r;
}

/** El evento que abre el formulario desde cualquier sitio del CRM. */
export const EVENTO_PEDIR_ACCESO = 'crm:pedir-acceso';

export function abrirPedirAcceso(inicial: PeticionInicial = {}) {
  window.dispatchEvent(new CustomEvent<PeticionInicial>(EVENTO_PEDIR_ACCESO, { detail: inicial }));
}

/** Para la tarjeta del ticket: qué se pidió, en una línea. */
export function resumenDeAcceso(acceso: { tipo?: string; permiso?: string; persona?: { nombre?: string | null; correo?: string | null }; campus?: string } | null | undefined): string[] {
  if (!acceso) return [];
  const lineas: string[] = [];
  const tipo = TIPOS_DE_ACCESO.find((t) => t.value === acceso.tipo);
  if (tipo) lineas.push(tipo.label);
  if (acceso.permiso) lineas.push(`Permiso: ${acceso.permiso}`);
  if (acceso.persona?.nombre || acceso.persona?.correo) {
    lineas.push(`Para: ${[acceso.persona.nombre, acceso.persona.correo].filter(Boolean).join(' · ')}`);
  }
  if (acceso.campus) lineas.push(`Campus: ${acceso.campus}`);
  return lineas;
}
