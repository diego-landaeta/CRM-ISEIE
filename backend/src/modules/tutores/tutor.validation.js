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
});

export const liquidarSchema = z.object({
  ids: z.array(z.number().int()).optional().nullable(),
  periodo: z.string().regex(/^\d{4}-\d{2}$/, 'Periodo en formato AAAA-MM').optional().nullable(),
  tutorId: z.number().int().optional().nullable(),
});
