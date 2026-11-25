import type { DatosFormacion, Formacion, TipoFormacion } from '../api/formaciones.api';

/**
 * El formulario de una formación (CRM#1113), sin pintar nada: de lo que dice el
 * servidor a lo que se escribe, y de lo escrito a lo que se guarda. Aparte para
 * poder probarlo sin montar la pantalla.
 */

/** `dias`: «Se desbloquea a los … días» en Moodle (CRM#1124); vacío = desde el principio. */
export type ModuloForm = { clave: string; id?: number; titulo: string; horas: string; descripcion: string; dias: string };

export type FormacionForm = {
  nombre: string;
  tipo: TipoFormacion | '';
  horas: string;
  precio: string;
  moneda: string;
  modalidad: string;
  fecha_inicio: string;
  fecha_fin: string;
  modulos: ModuloForm[];
};

let siguiente = 0;
/** Una clave para React que no cambia al reordenar (el id no vale: los nuevos no lo tienen). */
export const nuevaClave = () => `m${++siguiente}`;

export const moduloVacio = (): ModuloForm => ({ clave: nuevaClave(), titulo: '', horas: '', descripcion: '', dias: '' });

/** El mismo tope que el servidor y el plugin de Moodle: diez años. */
export const MAX_DIAS_DESBLOQUEO = 3650;

const txt = (v: unknown) => (v == null ? '' : String(v));

export function formDesde(f?: Formacion | null): FormacionForm {
  if (!f) {
    return { nombre: '', tipo: '', horas: '', precio: '', moneda: 'EUR', modalidad: 'Online', fecha_inicio: '', fecha_fin: '', modulos: [] };
  }
  return {
    nombre: f.nombre,
    tipo: f.tipo_formacion ?? f.tipo_por_nombre ?? '',
    horas: txt(f.horas_totales),
    precio: txt(f.precio),
    moneda: f.moneda || 'EUR',
    modalidad: f.modalidad || '',
    fecha_inicio: f.fecha_inicio || '',
    fecha_fin: f.fecha_fin || '',
    modulos: f.modulos.map((m) => ({
      clave: nuevaClave(), id: m.id, titulo: m.titulo, horas: txt(m.horas), descripcion: m.descripcion || '',
      dias: txt(m.dias_desbloqueo),
    })),
  };
}

const entero = (s: string) => (s.trim() === '' ? null : Math.round(Number(s.replace(',', '.'))));
const numero = (s: string) => (s.trim() === '' ? null : Number(s.replace(',', '.')));
const nulo = (s: string) => (s.trim() === '' ? null : s.trim());

/**
 * `conDesbloqueo`: «Se desbloquea a los … días» solo se manda con la fase 2 de Moodle
 * encendida (CRM#1124), que es cuando se ve el campo; sin él, el servidor deja lo guardado.
 */
export function datosDeForm(form: FormacionForm, { conDesbloqueo = false }: { conDesbloqueo?: boolean } = {}): DatosFormacion {
  return {
    nombre: form.nombre.trim(),
    tipo_formacion: form.tipo || null,
    horas_totales: entero(form.horas),
    precio: numero(form.precio),
    moneda: nulo(form.moneda)?.toUpperCase() ?? null,
    modalidad: nulo(form.modalidad),
    fecha_inicio: nulo(form.fecha_inicio),
    fecha_fin: nulo(form.fecha_fin),
    modulos: form.modulos.map((m) => ({
      ...(m.id ? { id: m.id } : {}),
      titulo: m.titulo.trim(),
      horas: entero(m.horas),
      descripcion: nulo(m.descripcion),
      // 0 es lo mismo que vacío: desde el principio.
      ...(conDesbloqueo ? { dias_desbloqueo: entero(m.dias) || null } : {}),
    })),
  };
}

export const sumaDeHoras = (modulos: ModuloForm[]) =>
  modulos.reduce((s, m) => s + (Number(m.horas.replace(',', '.')) || 0), 0);

/** Lo que impide guardar, dicho para quien lo escribe; null si se puede. */
export function problemaDelForm(form: FormacionForm): string | null {
  if (!form.nombre.trim()) return 'Falta el nombre de la formación.';
  const sinTitulo = form.modulos.findIndex((m) => !m.titulo.trim());
  if (sinTitulo >= 0) return `El módulo ${sinTitulo + 1} no tiene título.`;
  if (form.fecha_inicio && form.fecha_fin && form.fecha_fin < form.fecha_inicio) {
    return 'La fecha de fin es anterior a la de inicio.';
  }
  if (form.horas.trim() && !(Number(form.horas.replace(',', '.')) >= 1)) return 'Las horas tienen que ser un número.';
  const diasMal = form.modulos.findIndex((m) => {
    const d = m.dias.trim();
    return d !== '' && (!/^\d+$/.test(d) || Number(d) > MAX_DIAS_DESBLOQUEO);
  });
  if (diasMal >= 0) return `Los días del módulo ${diasMal + 1} van sin decimales, de 1 a ${MAX_DIAS_DESBLOQUEO} (vacío: desde el principio).`;
  if (form.precio.trim() && !(Number(form.precio.replace(',', '.')) >= 0)) return 'El precio tiene que ser un número.';
  return null;
}

/** La lista con el módulo `i` movido `delta` puestos (sin salirse). */
export function moverModulo<T>(lista: T[], i: number, delta: number): T[] {
  const j = i + delta;
  if (i < 0 || i >= lista.length || j < 0 || j >= lista.length) return lista;
  const otra = [...lista];
  [otra[i], otra[j]] = [otra[j], otra[i]];
  return otra;
}
