import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import {
  SquaresFour, Users, UserCheck, Package, ChartLineUp, Gear, SignOut,
  Moon, Sun, CaretLeft, CaretRight, UserCircle,
  CaretUp, CaretDown, Bell, Pulse, Calculator, Envelope, Globe,
  FilePdf, ShieldCheck, MagnifyingGlass, Headset, BookOpen, Sliders,
  Megaphone, Robot, Sparkle, PlugsConnected, CreditCard, WarningCircle, WhatsappLogo,
  ChatText,
  Receipt, Coins, Wrench, ShoppingBag, ChatCircleText, Wallet, Bank, Shuffle, Clock, GitMerge, CopySimple,
  UsersThree, CloudArrowDown,
  GraduationCap, Warning, Certificate, ClipboardText, ChatsCircle, Kanban, CheckSquare, SlidersHorizontal } from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { rolesDe } from '@/shared/lib/roles';
import usePermission from '@/shared/hooks/usePermission';
import { useTheme } from '@/contexts/ThemeContext';
import { cn } from '@/shared/lib/utils';
import client from '@/shared/api/client';
import NotificationsBell from './NotificationsBell';
import { isBetaAllowed, BETA_MODE, BETA_VERSION } from '@/shared/config/betaConfig';
import { PROCESO_EN_PRUEBAS } from '@/shared/lib/enPruebas';
import { CERTIFEX_PANEL } from '@/shared/lib/certifexPanel';

const ROLE_LABELS = { superadmin: 'Superadmin', admin: 'Admin', gestor: 'Gestor', soporte: 'Soporte', tutor: 'Tutor', colaborador: 'Colaborador' };

// Quién tiene tablero de tareas: el mismo `ROLES_TAREAS` que el backend (#210).
const ROLES_TAREAS = ['superadmin', 'admin', 'colaborador'];

// NAV_SECTIONS: agrupaciones del sidebar. Las "secciones" (Prospectos,
// Captación, Productos, Contabilidad) son ahora una sola entrada en el
// sidebar que navega al primer hijo; los hijos viven como tabs horizontales
// dentro de la página (ver shared/lib/sections.js + SectionTabs.jsx).
//
// Ninguna entrada puede llevar a «Página no encontrada» (#226). Diego, 10/10:
// «Las entradas del menú que NO existen en ISEIE se marcan "Próximamente" (sin
// enlace). Las que SÍ existen en algún CRM se hacen funcionar donde falten».
// Lo vigila `__smoke__/menuSinRutasRotas.test.jsx`: cada `to` tiene su <Route> en
// App.jsx, o lleva `comingSoon: true`.
export const NAV_SECTIONS = [
  {
    label: 'Principal',
    items: [
      { to: '/dashboard',  label: 'Dashboard',  icon: SquaresFour, end: true },
      // Prospectos cuelga de si mismo, como WhatsApp: la lista, la cola del dia
      // y el proceso que la cola aplica son el mismo sitio.
      {
        label: 'Prospectos',
        icon: Users,
        defaultOpen: true,
        children: [
          { to: '/leads', label: 'Lista', end: true, sectionPrefixes: ['/leads'], permiso: 'leads.view' },
          { to: '/leads/cola', label: 'La cola del día', permiso: 'proceso.view' },
          // El quinto paso no cabe en la cola: es toda la base que no compro.
          // Solo en pruebas hasta que se apruebe: ver shared/lib/enPruebas.js.
          ...(PROCESO_EN_PRUEBAS ? [{ to: '/leads/seguimiento', label: 'Seguimiento de fin de mes', permiso: 'proceso.view' }] : []),
          { to: '/leads/proceso', label: 'Proceso comercial', permiso: 'proceso.view' },
          // Las becas y su embudo (#86): a quién se le ofrecieron y en qué acabaron.
          // Sin aprobar para producción (07/10): solo en /staging.
          { to: '/leads/convocatorias', label: 'Convocatorias', permiso: 'convocatorias.view' },
        ],
      },
      // WhatsApp cuelga de su propia entrada, con lo suyo escalonado debajo: son
      // tres pantallas del mismo sitio, no tres apartados sueltos del menu.
      {
        label: 'WhatsApp',
        icon: WhatsappLogo,
        apagable: 'whatsapp',
        children: [
          // Un solo sitio: el Chat. «Mi WhatsApp» y el panel del equipo eran del
          // metodo viejo —cada gestora en un navegador remoto— y tener los dos a la
          // vez es lo que confunde: dos pantallas que parecen lo mismo y no lo son.
          // Abierto a todo el equipo por decision del owner. El aviso previo —lo
          // que puede pasarle a su numero -- sigue pendiente en la tarea #45.
          { to: '/whatsapp/chat', label: 'Chat', permiso: 'whatsapp.usar' },
          // Sin recorte por rol: cada gestora enlaza SU numero, y el servidor solo
          // la deja tocar el suyo.
          { to: '/whatsapp/conexion', label: 'Conexión', permiso: 'whatsapp.usar' },
          { to: '/whatsapp/plantillas', label: 'Plantillas', permiso: 'whatsapp.plantillas' },
          { to: '/whatsapp/banco', label: 'Banco de mensajes' },
          // Si cada gestora responde y lo que apunta (Diego, 30/10). Para quien ve Reportes.
          { to: '/whatsapp/actividad', label: 'Actividad', permiso: 'reports.view' },
          { to: '/whatsapp/ayuda', label: 'Cómo se usa' },
          // Solo para quien manda: entrar en el WhatsApp de cada gestora.
          // Fuera del menu: usaba el navegador remoto, que se ha retirado.
          // Vuelve cuando se rehaga sobre el chat nuevo.
        ],
      },
      // Ventas vive en Principal (flujo diario) y también en Finanzas. Clientes
      // y Revisión duplicados pasan a la sección Clientes al final.
      { to: '/ventas',      label: 'Ventas',     icon: Receipt, permiso: 'ventas.view' },
    ],
  },
  // El tablero del equipo (#210, como en MultiCRM). Es lo único que ve quien es
  // solo colaborador. «Por revisar» y «Configurar tablero» se enseñan por
  // permiso (`permiso`), no por rol: lo que se cambie en Configuración › Roles
  // manda también aquí. Aprobada para producción en la 2.2.0 (Diego, 16/10).
  {
    label: 'Equipo de Desarrollo',
    items: [
      { to: '/tareas', label: 'Mi tablero', icon: Kanban, roles: ROLES_TAREAS, end: true, permiso: 'tasks.view_own', oPermiso: 'tasks.view_own' },
      { to: '/tareas/revisar', label: 'Por revisar', icon: CheckSquare, roles: ROLES_TAREAS, permiso: 'tasks.close', oPermiso: 'tasks.close' },
      { to: '/tareas/configurar', label: 'Configurar tablero', icon: SlidersHorizontal, roles: ROLES_TAREAS, permiso: 'tasks.manage', oPermiso: 'tasks.manage' },
      // «Mi factura» (#202): el colaborador con usuario sube aquí su factura del mes.
      // Aquí, junto a su tablero, como en MultiCRM: es lo otro que ve un colaborador.
      { to: '/mi-factura', label: 'Mi factura', icon: Receipt, roles: ['colaborador'], permiso: 'facturas_colaborador.subir' },
    ],
  },
  {
    label: 'Captación',
    items: [
      { to: '/secuencias-email', label: 'Email',     icon: Envelope, roles: ['admin', 'superadmin'], sectionPrefixes: ['/secuencias-email', '/email-templates'], permiso: 'email_sequences.view' },
      { to: '/forms',           label: 'Formularios', icon: Globe,  roles: ['admin', 'superadmin'], sectionPrefixes: ['/forms'], permiso: 'forms.view' },
      { to: '/make-webhooks',   label: 'Make',      icon: PlugsConnected, roles: ['admin', 'superadmin'], permiso: 'make.view' },
      // Llevaba a la pantalla de Make (una redirección): dos entradas para lo
      // mismo. Desde el #226 es la de Webhooks, traída de MultiCRM.
      { to: '/webhooks',        label: 'Webhooks',  icon: PlugsConnected, roles: ['admin', 'superadmin'], permiso: 'webhooks.view' },
      { to: '/captacion/whatsapp', label: 'Widget web', icon: WhatsappLogo, roles: ['admin', 'superadmin', 'soporte'], permiso: 'widget.view' },
      // Próximamente (#226): no hay pantalla en ISEIE. La de MultiCRM enseña
      // datos INVENTADOS —sus llamadas a Meta y Google van con `USE_MOCKS =
      // true`— y traer cifras falsas a un CRM con dinero real es peor que no
      // tenerla. Vuelve cuando haya datos de verdad detrás.
      { to: '/campaigns',       label: 'Campañas',  icon: Megaphone, roles: ['admin', 'superadmin'], comingSoon: true },
      // Lleva a «Aún no conectado» (#216): enseñaba datos de ejemplo de Search Console.
      { to: '/seo',             label: 'Tráfico orgánico', icon: MagnifyingGlass, roles: ['admin', 'superadmin'] },
    ],
  },
  {
    label: 'Publicidad',
    items: [
      // Meta Ads: administración por su rol; y en solo lectura a quien se le da
      // `meta_ads.view` (26/10/2026: Jonathan, Gustavo, Ruth, Julián, Jesús), también si es solo colaborador.
      { to: '/meta-ads',   label: 'Meta Ads',   icon: ChartLineUp, roles: ['admin', 'superadmin'], permiso: 'meta_ads.view', oPermiso: 'meta_ads.view', colaboradorConPermiso: 'meta_ads.view' },
      { to: '/google-ads', label: 'Google Ads', icon: ChartLineUp, roles: ['admin', 'superadmin'], comingSoon: true },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { to: '/products',   label: 'Productos',  icon: Package, sectionPrefixes: ['/products'], permiso: 'products.view' },
      { to: '/products/pending', label: 'Cursos pendientes', icon: Clock, roles: ['admin', 'superadmin'], permiso: 'products.view' },
      { to: '/woocommerce', label: 'WooCommerce', icon: ShoppingBag, roles: ['admin', 'superadmin'], permiso: 'woocommerce.view' },
      { to: '/configuracion/categorias-arbol', label: 'Árbol de categorías', icon: Sliders, roles: ['admin', 'superadmin'], permiso: 'products.categorias' },
      // «Certificados» (/documentos) fuera del menú: estaba vacío, y los títulos
      // ahora los emite Certifex desde Matrículas → Certificaciones (Diego, 30/09).
    ],
  },
  {
    label: 'Tutores',
    items: [
      { to: '/tutores', label: 'Tutores', icon: GraduationCap, roles: ['admin', 'superadmin'], sectionPrefixes: ['/tutores'], permiso: 'tutores.gestionar', oPermiso: 'tutores.gestionar' },
      // Lo unico que ve un tutor: sus cursos y lo que le corresponde.
      { to: '/mis-cursos', label: 'Mis cursos', icon: GraduationCap, roles: ['tutor'], permiso: 'tutores.mis_cursos' },
      { to: '/tutores/sin-tutor', label: 'Sin tutor', icon: Warning, roles: ['admin', 'superadmin'], permiso: 'tutores.gestionar', oPermiso: 'tutores.gestionar' },
      { to: '/tutores/comisiones', label: 'Comisiones', icon: Coins, roles: ['admin', 'superadmin'], permiso: 'tutores.gestionar', oPermiso: 'tutores.gestionar' },
    ],
  },
  {
    label: 'Finanzas',
    items: [
      // El dashboard de finanzas, el mismo que MultiCRM abre en /finanzas. Llevaba
      // a /ventas, igual que la entrada de debajo: dos entradas para una sola
      // pantalla (#234). `end` para que no se encienda en /accounting/income.
      { to: '/accounting',            label: 'Dashboard',          icon: Calculator, roles: ['admin', 'superadmin'], statusTag: 'Pruebas', end: true, permiso: 'accounting.view' },
      { to: '/ventas',                label: 'Ventas',             icon: Receipt, statusTag: 'Pruebas', permiso: 'ventas.view' },
      { to: '/accounting/income',    label: 'Ingresos',           icon: Coins,      roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'conversions.view' },
      { to: '/revenue',              label: 'Conversiones',       icon: ChartLineUp, roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'conversions.view' },
      { to: '/expenses',             label: 'Egresos',            icon: Receipt,    roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'expenses.view' },
      { to: '/accounting/receivable', label: 'Cuentas por cobrar', icon: Wallet,    roles: ['admin', 'superadmin', 'soporte', 'gestor'], permiso: 'accounting.por_cobrar' },
      { to: '/accounting/payable',   label: 'Cuentas por pagar',  icon: Wallet,     roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'accounts_payable.view' },
      { to: '/commissions',          label: 'Comisiones',         icon: Bank,  roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'commissions.view' },
      { to: '/payroll',              label: 'Nóminas',            icon: Coins,      roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'payroll.view' },
      { to: '/accounting/pendiente-facturar', label: 'Pendientes de facturar', icon: WarningCircle, roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'facturas.view' },
      { to: '/accounting/pagos-stripe', label: 'Pagos Stripe',    icon: PlugsConnected, roles: ['admin', 'superadmin'], permiso: 'stripe.view' },
      { to: '/accounting/facturas', label: 'Facturación', icon: FilePdf, roles: ['admin', 'superadmin', 'soporte', 'gestor'], sectionPrefixes: ['/accounting/facturas'], permiso: ['facturas.emitir', 'facturas.configurar'], oPermiso: 'facturas.emitir' },
      // Facturas de colaboradores (#202): en evaluación, solo en /staging y en local.
      { to: '/accounting/facturas-colaboradores', label: 'Facturas de colaboradores', icon: Receipt, roles: ['admin', 'superadmin'], permiso: 'facturas_colaborador.ver_todas' },
      { to: '/accounting/integrations', label: 'Integraciones',   icon: PlugsConnected, roles: ['admin', 'superadmin'], statusTag: 'Pruebas', permiso: 'integrations.view' },
    ],
  },
  {
    label: 'Análisis',
    items: [
      { to: '/informes',     label: 'Reportes',      icon: ChartLineUp, sectionPrefixes: ['/informes', '/activity'] },
      // Por que no compran (#170). Fuera de produccion hasta aprobarlo.
      ...(PROCESO_EN_PRUEBAS ? [{ to: '/informes/feedback', label: 'Feedback', icon: ChatCircleText, roles: ['admin', 'superadmin'], permiso: 'feedback.view' }] : []),
      // Próximamente (#226): en MultiCRM la pantalla existe pero está aparcada
      // —fuera de su menú hasta la fase 5— y depende de la API de Claude, cuya
      // clave y cuyo módulo (`claude-chat`) ISEIE no tiene.
      { to: '/chat-ia',     label: 'Chat IA',       icon: ChatCircleText, roles: ['admin', 'superadmin'], comingSoon: true },
    ],
  },
  {
    // Clientes = consulta de datos de clientes (no ventas). Va al final.
    label: 'Clientes',
    items: [
      { to: '/clients',    label: 'Clientes',   icon: UserCheck, sectionPrefixes: ['/clients'], permiso: 'clients.view' },
      { to: '/leads/revision-duplicados', label: 'Revisión duplicados', icon: GitMerge, roles: ['admin', 'superadmin'], permiso: 'leads.duplicados' },
      { to: '/leads/duplicados', label: 'Buscar duplicados', icon: CopySimple, roles: ['admin', 'superadmin'], permiso: 'leads.duplicados' },
      { to: '/matriculas', label: 'Matrículas', icon: UserCheck, permiso: 'matriculas.view' },
      // Diplomas de Certifex (#272): lo que piden los alumnos desde Moodle, aprobarlo,
      // enviarlo y revocarlo. Administración, como en MultiCRM, y además, para VERLO en
      // solo lectura, quien tenga `diplomas.view` (#223, `oPermiso`), y para emitir,
      // quien tenga `diplomas.emit` (Diego, 22/10/2026: «que Dayana pueda emitir»). Se
      // enciende por configuración, como Certificaciones (VITE_CERTIFEX_PANEL).
      ...(CERTIFEX_PANEL ? [{ to: '/matriculas/diplomas', label: 'Diplomas', icon: Certificate, roles: ['superadmin', 'admin'], permiso: ['diplomas.view', 'diplomas.emit'], oPermiso: ['diplomas.view', 'diplomas.emit'] }] : []),
    ],
  },
  {
    // Conexión: el MCP de Claude y los Conectores (WordPress, tiendas, APIs), como en
    // MultiCRM. Diego, 30/09: «en iseie no puedo ver el status de conectores de mcp,
    // no está ese apartado, tiene que ponerlos como en el 360».
    // `accesoMcp` y no `roles`: soporte se salta los roles, y aquí no puede. Es la
    // misma regla que el servidor (`puedeUsarMcp` en mcp.acceso.js).
    label: 'Conexión',
    items: [
      { to: '/conexion/mcp', label: 'MCP', icon: Robot, accesoMcp: true },
      { to: '/conexion/conectores', label: 'Conectores', icon: CloudArrowDown, roles: ['admin', 'superadmin'], permiso: 'connectors.view' },
      // Diego, 15/10: «un apartado en Conexión para enviar esos datos ÚNICAMENTE
      // CUANDO SE PONGA DATOS POR TRANSFERENCIA BANCARIA / DEPÓSITO BANCARIO».
      { to: '/conexion/webhook-transferencias', label: 'Webhook de transferencias', icon: Bank, roles: ['admin', 'superadmin'], permiso: 'webhooks_salientes.view' },
      { to: '/conexion/asignacion-leads', label: 'Asignación de leads', icon: Shuffle, roles: ['admin', 'superadmin'], permiso: 'webhooks_salientes.view' },
    ],
  },
  {
    label: 'Sistema',
    items: [
      // Lo que trae cada versión (Diego, 28/09). La 2.0.0 cuenta lo que aún está
      // en pruebas: sale con ello.
      ...(PROCESO_EN_PRUEBAS ? [{ to: '/novedades', label: 'Novedades', icon: Sparkle, roles: ['superadmin', 'admin', 'gestor', 'soporte'], permiso: 'novedades.view' }] : []),
      // El chat interno del equipo, como en MultiCRM.
      { to: '/mensajes', label: 'Mensajes', icon: ChatsCircle, permiso: 'mensajes.usar' },
      { to: '/solicitudes-cambio', label: 'Solicitudes de cambio', icon: GitMerge, permiso: 'change_requests.view' },
      { to: '/notificaciones', label: 'Notificaciones',   icon: Bell },
      // El tutor entra aqui: es donde cambia su contraseña.
      { to: '/preferencias',    label: 'Mis preferencias', icon: Sliders, roles: ['superadmin', 'admin', 'gestor', 'tutor', 'colaborador'] },
      { to: '/soporte',        label: 'Soporte',          icon: Headset },
      { to: '/manual',         label: 'Manual del CRM',   icon: BookOpen },
      { to: '/status',         label: 'Status',           icon: Pulse },
      // El registro (#111), como en MultiCRM: quién hizo qué y, en «todos», los sucesos
      // del sistema. Los mismos roles que exige el servidor.
      { to: '/registro',       label: 'Registro',         icon: ClipboardText, roles: ['superadmin', 'admin'], permiso: 'registro.view' },
    ],
  },
];

// Interruptor de compilacion para dejar una parte fuera de una instalacion sin
// borrar su codigo. Se usa con WhatsApp, que en produccion todavia no se enciende
// —esta en revision— pero viaja en el mismo build que el resto.
const APAGADOS = String(import.meta.env.VITE_MODULOS_APAGADOS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);

/**
 * Que entradas del menu ve alguien.
 *
 * Recibe TODOS sus roles, no uno: desde que se puede tener mas de uno, «es
 * gestor» dejo de ser una pregunta de igualdad.
 */
// Espejo de `puedeUsarMcp` (backend/src/modules/mcp/mcp.acceso.js). Con el rol
// PRINCIPAL, como el servidor: un rol añadido no da el MCP.
export function tieneAccesoMcp(can) {
  // «Usar el MCP» del catálogo (#230, gemela de CRM#423), como el servidor (`puedeUsarMcp`).
  return typeof can === 'function' && can('mcp.usar') === true;
}

//
// `can` es el de usePermission: lo usa `oPermiso`, una entrada que se ve por su rol
// O por un permiso del sistema de Roles (Diplomas, #223), como en MultiCRM.
export function canSeeItem(item, role, soloColaboraciones, permisos, can) {
  const roles = Array.isArray(role) ? role.filter(Boolean) : [role].filter(Boolean);
  const es = (...r) => r.some((x) => roles.includes(x));
  // «Por su rol o porque se le ha dado»: quien tiene el permiso la ve aunque su rol
  // no esté en `roles`. Lo que ve dentro lo recorta la pantalla (y la API).
  // `oPermiso` puede ser una lista: basta con uno (Diplomas: ver O emitir).
  const porPermiso = Boolean(item.oPermiso && typeof can === 'function'
    && [].concat(item.oPermiso).some((p) => can(p) === true));
  if (item.apagable && APAGADOS.includes(item.apagable)) return false;
  // El permiso de la pantalla (#230, gemela de CRM#423): sin él no sale, sea quien
  // sea. Es el mismo mapa que mira el servidor; quitarle a alguien «Ver
  // prospectos» le quita también la entrada. Los `roles` de cada entrada siguen
  // diciendo a quién se le enseña de serie. `permiso` puede ser una lista: basta
  // con uno (Diplomas: ver O emitir).
  if (item.permiso && !(typeof can === 'function' && [].concat(item.permiso).some((p) => can(p) === true))) return false;
  // MCP de Claude: «Usar el MCP» del catálogo, como el servidor.
  // Va ANTES del atajo de soporte y del recorte del tutor: «roles únicamente».
  if (item.accesoMcp) return tieneAccesoMcp(can);
  // Un tutor solo ve lo suyo: lo que no le nombre expresamente queda fuera.
  // Al reves —listar lo prohibido— se olvida siempre algo, y lo que se olvida
  // es un tutor paseandose por Prospectos o por Finanzas.
  // El recorte del tutor es para quien es SOLO tutor.
  if (roles.length === 1 && roles[0] === 'tutor') {
    return Array.isArray(item.roles) && item.roles.includes('tutor');
  }
  // Lo mismo para quien es SOLO colaborador (#210, fase 5): Tareas y sus
  // preferencias. El servidor le responde 403 en todo lo demas.
  if (roles.length > 0 && roles.every((r) => r === 'colaborador')) {
    // Lo que no es de su rol, solo si se le ha dado a propósito para él (Meta
    // Ads, 26/10/2026). `oPermiso` a secas no basta: Diplomas no es para un colaborador.
    if (item.colaboradorConPermiso) return typeof can === 'function' && can(item.colaboradorConPermiso) === true;
    // «Por revisar» y «Configurar tablero», solo con su clave (como en MultiCRM).
    if (item.permiso && String(item.permiso).includes('.') && !(typeof can === 'function' && can(item.permiso) === true)) return false;
    return Array.isArray(item.roles) && item.roles.includes('colaborador');
  }
  // Un gestor de colaboraciones se dedica SOLO a los tutores: no lleva
  // prospectos, ni ventas, ni finanzas. Se declara lo que puede ver, igual que
  // con el tutor — enumerar lo prohibido deja fuera siempre la pantalla nueva.
  if (soloColaboraciones) {
    // «Sin tutor» faltaba, y era un olvido de la lista, no una decisión: el
    // servidor ya la dejaba entrar —`formacionesSinTutor` pasa por
    // `exigirGestion`, que acepta la casilla de colaboraciones— y era la
    // pantalla la que se la escondía. Y es justo la que dice qué formaciones
    // están sin cubrir, o sea el trabajo de quien lleva las colaboraciones.
    //
    // Van las TRES del apartado. «Mis cursos» no: esa es la de un tutor
    // mirando lo suyo, no la de quien los organiza.
    // Y lo que se le haya dado a propósito (`oPermiso`, #223).
    return ['/tutores', '/tutores/sin-tutor', '/tutores/comisiones', '/preferencias']
      .includes(item.to) || porPermiso;
  }

  // La entrada de Facturación la ve quien PUEDE facturar o configura la facturación (soporte):
  // la casilla de antes es ahora una excepción de la persona (migración 239) y la
  // mira el `permiso` de arriba, como el resto.

  if (!item.roles) return true;
  if (es('superadmin', 'soporte')) return true;
  return item.roles.some((r) => roles.includes(r)) || porPermiso;
}

/** Vanessa y quien lleve las colaboraciones: solo tutores. Un admin con la casilla NO se recorta. */
export function esSoloColaboraciones(user) {
  return user?.gestor_colaboraciones === true
    && !['superadmin', 'admin', 'soporte'].includes(user?.role);
}

/**
 * Las entradas de una sección que ve alguien (#230, gemela de CRM#423: sacado del
 * componente para poder probar qué menú ve cada perfil sin montarlo). Los hijos de
 * un grupo se filtran luego en `NavGroup`, con `canSeeItem`.
 */
export function entradasDeSeccion(section, { user, can, soloColab }) {
  const role = rolesDe(user).length ? rolesDe(user) : ['gestor'];
  return section.items
    .map((it) => {
      if (it.sectionPrefixes?.includes('/informes') && it.sectionPrefixes?.includes('/activity')) {
        // Tal cual estaba en el componente (`role` es la lista de roles).
        const isAdmin = role === 'admin' || role === 'superadmin' || role === 'soporte';
        return { ...it, to: isAdmin ? '/informes' : '/activity' };
      }
      return it;
    })
    .filter((it) => canSeeItem(it, role, soloColab, user, can));
}

/**
 * Una entrada del menú que todavía no lleva a ninguna parte (#226).
 *
 * Diego, 10/10: «Las entradas del menú que NO existen en ISEIE se marcan
 * "Próximamente" (sin enlace)». Es un <div> y no un enlace: no navega, el
 * tabulador no se para en ella y no hay forma de acabar en «Página no
 * encontrada». La etiqueta dice siempre «Próximamente» —antes unas ponían
 * «Próx.» y otras «Pruebas», y «Pruebas» es otra cosa: esa SÍ se abre—.
 *
 * El mismo aspecto que en MultiCRM: entrada atenuada y la etiqueta a la derecha.
 */
export function EntradaProximamente({ label, icon: Icon, collapsed = false }) {
  return (
    <div
      aria-disabled="true"
      data-proximamente=""
      title={`${label} — Próximamente`}
      className={cn(
        'relative flex items-center rounded-md text-[13px] text-muted-foreground/45 cursor-not-allowed select-none',
        collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-1.5'
      )}
    >
      {Icon && <Icon size={18} weight="regular" />}
      {!collapsed && <span className="truncate">{label}</span>}
      {!collapsed && (
        <span className="ml-auto text-[9px] uppercase tracking-wider bg-muted/60 text-muted-foreground/70 px-1.5 py-0.5 rounded">
          Próximamente
        </span>
      )}
    </div>
  );
}

// Exportada para la prueba del menú (#226): una entrada marcada no puede ser un enlace.
export function NavItem({ to, label, icon: Icon, end, comingSoon, collapsed, onClick, sectionPrefixes }) {
  const location = useLocation();
  if (comingSoon) return <EntradaProximamente label={label} icon={Icon} collapsed={collapsed} />;

  // Para items con `sectionPrefixes`, NavLink no detecta como activo cuando
  // el usuario está en una ruta hermana (ej. /leads/pipeline cuando to=/leads).
  // Calculamos manualmente con prefix match.
  const isPrefixActive = sectionPrefixes
    ? sectionPrefixes.some((p) => location.pathname === p || location.pathname.startsWith(p + '/'))
    : false;

  return (
    <NavLink
      to={to}
      end={end}
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={({ isActive }) => {
        const active = isActive || isPrefixActive;
        return cn(
          'relative flex items-center rounded-md text-[13px] transition-colors',
          collapsed ? 'justify-center h-10' : 'gap-3 px-3 py-1.5',
          active
            ? 'bg-primary/10 text-primary font-semibold'
            : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        );
      }}
    >
      {({ isActive }) => {
        const active = isActive || isPrefixActive;
        return (
          <>
            {active && !collapsed && (
              <span aria-hidden="true" className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-r-full bg-primary" />
            )}
            <Icon size={18} weight={active ? 'duotone' : 'regular'} />
            {!collapsed && <span className="truncate">{label}</span>}
          </>
        );
      }}
    </NavLink>
  );
}


// Una entrada con lo suyo escalonado debajo. Se abre y se cierra, y lo de
// dentro se sangra con una guia a la izquierda para que se vea de un vistazo
// que pertenece a ella.
function NavGroup({ label, icon: Icon, items, defaultOpen, role, soloColab, permisos, can, collapsed, onNavigate, onExpandSidebar }) {
  const location = useLocation();
  const visible = items
    .filter((c) => canSeeItem(c, role, soloColab, permisos, can))
    .map((c) => ({ ...c, comingSoon: c.comingSoon || !isBetaAllowed(c.to) }));
  const hasActiveChild = visible.some(
    (c) => !c.comingSoon && (location.pathname === c.to || location.pathname.startsWith(c.to + '/'))
  );
  const [open, setOpen] = useState(hasActiveChild || !!defaultOpen);
  // Si se llega desde fuera a una pantalla de dentro, el grupo se abre solo:
  // si no, el apartado marcado como activo quedaria escondido.
  useEffect(() => { if (hasActiveChild) setOpen(true); }, [hasActiveChild]);
  if (!visible.length) return null;

  // Colapsado (sidebar mini) solo cabe el icono: al pulsarlo se despliega la
  // barra y se abre el grupo, en vez de dejar al usuario sin salida.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => { onExpandSidebar?.(); setOpen(true); }}
        title={label}
        aria-label={label}
        className={cn(
          'w-full flex items-center justify-center h-10 rounded-md transition-colors',
          hasActiveChild ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        )}
      >
        <Icon size={18} weight={hasActiveChild ? 'duotone' : 'regular'} />
      </button>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className={cn(
          'w-full flex items-center gap-3 px-3 py-1.5 rounded-md text-[13px] transition-colors',
          hasActiveChild ? 'text-foreground font-semibold' : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground'
        )}
      >
        <Icon size={18} weight={hasActiveChild ? 'duotone' : 'regular'} />
        <span className="truncate">{label}</span>
        <CaretRight size={12} weight="bold" className={cn('ml-auto transition-transform', open && 'rotate-90')} />
      </button>
      {open && (
        <div className="ml-4 mt-0.5 pl-3 border-l border-border/60 space-y-0.5">
          {visible.map((child) => (
            <NavItem
              key={child.to}
              to={child.to}
              label={child.label}
              icon={child.icon || Icon}
              end={child.end}
              comingSoon={child.comingSoon}
              statusTag={child.statusTag}
              onClick={onNavigate}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// Decide qué sección debe estar abierta por defecto: Principal (siempre) +
// la que contenga la ruta actual. Devuelve un map { [section.label]: boolean }.
function defaultOpenSections(sections, pathname) {
  const out = {};
  for (const s of sections) {
    const containsActive = s.items.some((it) => {
      // Una entrada con hijos no tiene ruta propia: cuenta lo de dentro.
      if (it.children) {
        return it.children.some((c) => pathname === c.to || (c.to && pathname.startsWith(c.to + '/')));
      }
      if (pathname === it.to) return true;
      if (it.sectionPrefixes?.some((p) => pathname === p || pathname.startsWith(p + '/'))) return true;
      if (it.to && it.to !== '/' && pathname.startsWith(it.to + '/')) return true;
      return false;
    });
    out[s.label] = s.label === 'Principal' || containsActive;
  }
  return out;
}

function CollapsibleNav({ sections, role, soloColab, permisos, can, collapsed, onNavigate, onExpandSidebar }) {
  const location = useLocation();
  const STORAGE_KEY = 'crm-sidebar-sections-v1';
  const [openMap, setOpenMap] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) return { ...defaultOpenSections(sections, location.pathname), ...JSON.parse(stored) };
    } catch { /* ignore */ }
    return defaultOpenSections(sections, location.pathname);
  });

  // Cuando cambia la ruta, NO sobrescribimos las preferencias del usuario
  // (esto sería molesto). Solo abrimos la sección activa si estaba cerrada.
  useEffect(() => {
    const auto = defaultOpenSections(sections, location.pathname);
    setOpenMap((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(auto)) {
        if (auto[k] && !next[k]) next[k] = true;
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  function toggle(label) {
    setOpenMap((prev) => {
      const next = { ...prev, [label]: !prev[label] };
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  }

  return (
    <nav className="flex-1 overflow-y-auto -mx-2 px-2 space-y-2">
      {sections.map((section) => {
        const items = entradasDeSeccion(section, { user: permisos, can, soloColab })
          // Una entrada con hijos no tiene ruta que mirar: lo de BETA lo decide
          // cada hijo por su cuenta, dentro de NavGroup.
          .map((it) => (it.children ? it : { ...it, comingSoon: it.comingSoon || !isBetaAllowed(it.to) }));
        if (!items.length) return null;

        const pintar = (item) => (item.children ? (
          <NavGroup
            key={'g|' + item.label}
            label={item.label}
            icon={item.icon}
            items={item.children}
            defaultOpen={item.defaultOpen}
            soloColab={soloColab}
            permisos={permisos}
            can={can}
            role={role}
            collapsed={collapsed}
            onNavigate={onNavigate}
            onExpandSidebar={onExpandSidebar}
          />
        ) : (
          <NavItem
            key={item.to + '|' + item.label}
            to={item.to}
            label={item.label}
            icon={item.icon}
            end={item.end}
            comingSoon={item.comingSoon}
            statusTag={item.statusTag}
            collapsed={collapsed}
            onClick={onNavigate}
            sectionPrefixes={item.sectionPrefixes}
          />
        ));

        // En modo colapsado (sidebar mini) no mostramos headers ni colapso —
        // todos los items se ven como iconos en línea.
        if (collapsed) {
          return (
            <div key={section.label} className="space-y-0.5">
              {items.map(pintar)}
            </div>
          );
        }

        const open = !!openMap[section.label];
        return (
          <div key={section.label}>
            <button
              type="button"
              onClick={() => toggle(section.label)}
              aria-expanded={open}
              className="w-full flex items-center justify-between px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70 hover:text-foreground hover:bg-secondary/40 transition-colors select-none"
            >
              <span>{section.label}</span>
              <CaretDown
                size={10}
                weight="bold"
                className={cn('transition-transform duration-150', open ? '' : '-rotate-90')}
              />
            </button>
            {open && (
              <div className="space-y-0.5 mt-0.5 ml-1 pl-2 border-l border-border/50">
                {items.map(pintar)}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}

export default function Sidebar({ collapsed = false, onToggleCollapsed, onNavigate }) {
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDoc = (e) => { if (!userMenuRef.current?.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [userMenuOpen]);

  async function handleLogout() {
    setUserMenuOpen(false);
    await logout();
    navigate('/login');
  }

  // Todos sus roles, no solo el principal: el menu suma lo de cada uno.
  const role = rolesDe(user).length ? rolesDe(user) : ['gestor'];
  // Cada entrada con `permiso` la mira `canSeeItem` contra el mapa del servidor
  // (#230, gemela de CRM#423): lo que se cambia en Configuración › Roles manda aquí.
  const { can } = usePermission();
  const secciones = NAV_SECTIONS;
  const initials = user?.nombre?.split(' ').map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '??';
  // Quien lleva las colaboraciones no es una gestora: se la llama por su trabajo,
  // que es dar de alta profesores y ajustarles el porcentaje.
  const rolLabel = user?.gestor_colaboraciones ? 'Colaboraciones' : (ROLE_LABELS[role] || '');

  return (
    <aside
      role="navigation"
      aria-label="Menu principal"
      className={cn(
        'border-r bg-card h-screen flex flex-col z-40 transition-[width] duration-200',
        'lg:fixed lg:left-0 lg:top-0',
        collapsed ? 'w-16 p-2' : 'w-60 lg:w-64 p-4'
      )}
    >
      {/* Logo + badge BETA + toggle */}
      <div className={cn('flex items-center mb-4', collapsed ? 'flex-col gap-2' : 'gap-2 px-2')}>
        {collapsed ? (
          <img src="/iseie-icon-192.png" alt="ISEIE" className="w-8 h-8 object-contain flex-shrink-0" />
        ) : (
          <>
            <div className="flex-1 min-w-0 flex items-center gap-1.5">
              <img src="/iseie-logo-color.png" alt="ISEIE" className="h-7 w-auto object-contain object-left dark:hidden" />
              <img src="/iseie-logo.png"       alt="ISEIE" className="h-7 w-auto object-contain object-left hidden dark:block" />
              {/* La versión, como en MultiCRM (Diego, 19/10: «actualiza producción a la 2.2.0»). */}
              <span
                title={`Versión ${BETA_VERSION} — beta`}
                className="inline-flex items-center px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[9px] font-bold uppercase tracking-wider self-start"
              >
                Beta {BETA_VERSION}
              </span>
            </div>
          </>
        )}
        {onToggleCollapsed && (
          <button
            onClick={onToggleCollapsed}
            title={collapsed ? 'Expandir' : 'Colapsar'}
            aria-label={collapsed ? 'Expandir sidebar' : 'Colapsar sidebar'}
            className="hidden lg:flex p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-secondary/60 transition-colors flex-shrink-0"
          >
            {collapsed ? <CaretRight size={14} weight="bold" /> : <CaretLeft size={14} weight="bold" />}
          </button>
        )}
      </div>


      {/* Trigger del CommandPalette (atajo Ctrl/Cmd + K). El render del modal
          vive en AppLayout; aquí solo disparamos el evento keydown sintético. */}
      {!collapsed && (
        <button
          type="button"
          onClick={() => {
            const ev = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true });
            window.dispatchEvent(ev);
          }}
          className="mb-3 relative w-full h-8 pl-8 pr-12 rounded-md bg-secondary/40 border border-border text-[12px] text-left text-muted-foreground/80 hover:bg-secondary/60 hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring/30 transition-colors"
          aria-label="Abrir búsqueda global"
        >
          <MagnifyingGlass size={13} weight="bold" className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground/60 pointer-events-none" />
          Buscar…
          <kbd className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border bg-card text-muted-foreground">
            Ctrl K
          </kbd>
        </button>
      )}

      {/* Nav — secciones colapsables. El estado se persiste en localStorage por
          sección. Por defecto se abre la sección que contiene la ruta activa
          (más "Principal" siempre como ancla). El usuario puede plegar/expandir
          libremente con click en el header de sección. */}
      <CollapsibleNav
        sections={secciones}
        role={role}
        soloColab={esSoloColaboraciones(user)}
        permisos={user}
        can={can}
        collapsed={collapsed}
        onNavigate={onNavigate}
        onExpandSidebar={onToggleCollapsed}
      />

      {/* User menu + notification bell */}
      <div className="mt-4 pt-4 border-t border-border relative" ref={userMenuRef}>
        <div className={cn('flex items-center', collapsed ? 'flex-col gap-1' : 'gap-1')}>
          <button
            onClick={() => setUserMenuOpen((v) => !v)}
            className={cn(
              'flex items-center rounded-md transition-colors hover:bg-secondary/60 flex-1 min-w-0',
              collapsed ? 'justify-center p-1.5 w-full' : 'gap-2.5 p-2'
            )}
          >
            <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xs font-semibold flex-shrink-0">
              {initials}
            </div>
            {!collapsed && (
              <>
                <div className="min-w-0 flex-1 text-left">
                  <div className="text-[13px] font-semibold truncate">{user?.nombre || 'Sin sesión'}</div>
                  <div className="text-[10px] text-muted-foreground truncate">{rolLabel}</div>
                </div>
                {userMenuOpen ? <CaretDown size={12} weight="bold" className="text-muted-foreground flex-shrink-0" /> : <CaretUp size={12} weight="bold" className="text-muted-foreground flex-shrink-0" />}
              </>
            )}
          </button>
          <NotificationsBell collapsed={collapsed} />
        </div>

        {userMenuOpen && (
          <div className={cn(
            'absolute bottom-full mb-2 bg-card border border-border rounded-lg shadow-xl py-1 z-50',
            collapsed ? 'left-full ml-2 w-48' : 'left-0 right-0'
          )}>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/perfil'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <UserCircle size={15} />
              Mi cuenta
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/configuracion'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <Gear size={15} />
              Configuración
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/manual'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <BookOpen size={15} />
              Manual del CRM
            </button>
            <button
              onClick={() => { setUserMenuOpen(false); navigate('/soporte'); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <Headset size={15} />
              Soporte
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={() => { setUserMenuOpen(false); toggleTheme(); }}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
              {theme === 'dark' ? 'Tema claro' : 'Tema oscuro'}
            </button>
            <div className="my-1 border-t border-border" />
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-2.5 px-3 py-2 text-[13px] hover:bg-secondary/60 text-foreground"
            >
              <SignOut size={15} />
              Cerrar sesión
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
