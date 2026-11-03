import { z } from 'zod';

// Una fecha en formato ISO. Se acepta como texto y se deja que Postgres la
// convierta: hacerlo en JS con new Date() mete la zona horaria del servidor y
// una colaboracion que empieza el 1 acaba empezando el 31 del mes anterior.
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha en formato AAAA-MM-DD');

export const altaTutorSchema = z.object({
  nombre: z.string().min(2, 'El nombre es obligatorio'),
  email: z.string().email('Correo no valido'),
  projectIds: z.array(z.number().int()).min(1, 'Elige al menos un proyecto'),
  // Opcional. Si viene, se le pone esa contraseña y entra ya; si no, se le
  // manda el correo de siempre con el enlace para ponersela el.
  //
  // Existe porque en staging no hay Brevo configurado: sin esto, el correo no
  // sale, nadie recibe el enlace y el tutor no puede entrar nunca — asi que no
  // habria forma de probar el modulo.
  password: z.string().min(8, 'Al menos 8 caracteres').optional().nullable(),
  dniNif: z.string().max(32).optional().nullable(),
  iban: z.string().max(40).optional().nullable(),
  banco: z.string().max(120).optional().nullable(),
  telefono: z.string().max(32).optional().nullable(),
  notas: z.string().optional().nullable(),
});

export const perfilSchema = z.object({
  // El nombre vive en `users`, como el correo. Se edita desde aqui porque esta
  // es la unica pantalla del tutor, y hasta hoy no se podia cambiar en ningun
  // sitio: quien entraba mal escrito se quedaba mal escrito. Diego, 14/09:
  // «necesitamos algo visible para poder editar tutores».
  nombre: z.string().trim().min(2, 'El nombre es demasiado corto').max(120).optional(),
  dniNif: z.string().max(32).optional().nullable(),
  iban: z.string().max(40).optional().nullable(),
  banco: z.string().max(120).optional().nullable(),
  telefono: z.string().max(32).optional().nullable(),
  notas: z.string().optional().nullable(),
  // El correo vive en users, no en el perfil, pero se cambia desde aqui porque
  // es la unica pantalla donde se editan los datos de un tutor.
  //
  // Y es la CREDENCIAL: al cambiarlo, quien lo tuviera deja de poder entrar con
  // el viejo. Por eso viene acompañado de `reenviarEnlace`, para mandarle el
  // correo con el enlace de contraseña a la direccion nueva.
  email: z.string().email('Correo no valido').optional().nullable(),
  reenviarEnlace: z.boolean().optional(),
});

export const colaboracionSchema = z.object({
  tutorId: z.number().int(),
  productId: z.number().int(),
  // El porcentaje es obligatorio a proposito, sin valor por defecto silencioso:
  // que alguien se deje el campo y acabe cobrando el 10% sin haberlo decidido
  // es justo el tipo de error que luego cuesta dinero y discusiones.
  pct: z.number().min(0, 'El porcentaje no puede ser negativo').max(100, 'Como mucho el 100%'),
  desde: fecha,
  hasta: fecha.optional().nullable(),
  notas: z.string().optional().nullable(),
  // La formacion es de un campus en el que el tutor no esta (#223). Sin esto
  // se contesta 409 con ese campus, y la pantalla pregunta «¿la añado a este
  // campus?»; con `true`, se le da de alta ahi y se crea la colaboracion, todo
  // de una vez. Solo sobre un campus que vea quien lo pide.
  anadirAlCampus: z.boolean().optional(),
}).refine((d) => !d.hasta || d.hasta >= d.desde, {
  message: 'La fecha de fin no puede ser anterior a la de inicio',
  path: ['hasta'],
});

export const editarColaboracionSchema = z.object({
  pct: z.number().min(0).max(100).optional(),
  desde: fecha.optional(),
  hasta: fecha.optional().nullable(),
  activa: z.boolean().optional(),
  notas: z.string().optional().nullable(),
  // Lo que ha entregado de esa formacion. Son MARCAS, no archivos: el fichero
  // vive donde viva y aqui solo se apunta que llego. Diego, 14/09.
  entregoFoto: z.boolean().optional(),
  entregoVideo: z.boolean().optional(),
  // Los tramos son excluyentes: nadie esta al 25 y al 50 a la vez.
  modulosPct: z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(100)]).optional(),
});

/*
  «Cobra desde» en Editar tutor (Diego, 13/10). Una fecha que pasa a ser el
  inicio de todas sus colaboraciones activas.

  Ademas del formato se exige que la fecha EXISTA: «2026-02-30» pasa la
  expresion regular y Postgres la rechaza con un 500 que no dice nada. Se
  comprueba en UTC para no meter la zona horaria del servidor.
*/
export const cobraDesdeSchema = z.object({
  desde: fecha.refine((s) => {
    const d = new Date(`${s}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, 'Esa fecha no existe'),
});

export const ajustesSchema = z.object({
  aplicaDesde: fecha.optional(),
  pctPorDefecto: z.number().min(0).max(100).optional(),
});

// Recalcular es inofensivo —no puede duplicar— pero se acota igual: pedirlo sin
// fechas repasa TODO el historico y en una base grande eso es un rato de disco.
export const calcularSchema = z.object({
  desde: fecha.optional().nullable(),
  hasta: fecha.optional().nullable(),
  projectId: z.number().int().optional().nullable(),
  // Calcular con una EMPRESA elegida: sus campus de una vez, sin entrar uno a
  // uno. Diego, 14/09: «tenemos que tambien sea generar y poder filtrar por
  // campus».
  projectIds: z.array(z.number().int()).optional().nullable(),
});

export const liquidarSchema = z.object({
  ids: z.array(z.number().int()).optional().nullable(),
  periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Periodo en formato AAAA-MM').optional().nullable(),
  tutorId: z.number().int().optional().nullable(),
});

/*
  Marcar que se busca tutor para una formacion.

  `buscando: false` con un anuncio puesto NO se rechaza: se deja de buscar y se
  guarda con que se estuvo buscando. Borrar el anuncio al desmarcar seria
  perder el unico dato que responde: esto ya lo intentamos.
*/
export const busquedaDeTutorSchema = z.object({
  buscando: z.boolean().optional().default(true),
  // Los identificadores de Meta son numeros larguisimos, pero llegan como texto
  // y como texto se guardan: un 120255671225530569 no cabe en un entero de JS
  // sin perder cifras por el camino.
  adsetId: z.string().trim().max(50).nullable().optional(),
  campaignId: z.string().trim().max(50).nullable().optional(),
  nota: z.string().trim().max(500).nullable().optional(),
});

/*
  Consultas de alumnos, fase 1 (#187): una empresa entera, un campus y
  «No disponible» (vacaciones o baja).
*/
export const empresaDelTutorSchema = z.object({
  issuerId: z.coerce.number({ invalid_type_error: 'Elige una empresa' }).int().positive('Elige una empresa'),
});

export const campusDelTutorSchema = z.object({
  projectId: z.coerce.number({ invalid_type_error: 'Elige un campus' }).int().positive('Elige un campus'),
});

export const disponibleSchema = z.object({
  disponible: z.boolean({ required_error: 'Falta si está disponible o no' }),
  motivo: z.string().trim().max(200, 'El motivo, en 200 caracteres como mucho').nullable().optional(),
});
