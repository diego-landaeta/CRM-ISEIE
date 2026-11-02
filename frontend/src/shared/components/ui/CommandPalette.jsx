import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MagnifyingGlass, SquaresFour, Users, Package, Receipt, Kanban, UserGear,
  Power, Command, Plus,
} from '@phosphor-icons/react';
import { useAuth } from '@/contexts/AuthContext';
import { useProjectContext } from '@/contexts/ProjectContext';
import { crearCan } from '@/shared/hooks/usePermission';
import { useIdsDelAmbito } from '@/shared/hooks/useAmbito';
import {
  NAV_SECTIONS,
  entradasDeSeccion,
  canSeeItem,
  esSoloColaboraciones,
} from '@/shared/components/layout/Sidebar';
import { isBetaAllowed } from '@/shared/config/betaConfig';
import { rolesDe } from '@/shared/lib/roles';
import client from '@/shared/api/client';

/*
  El buscador (Ctrl K). Gemela de CRM#591 (ISEIE #335), el que hizo Hugo en
  MultiCRM, llevado aquí:

  - Las páginas salen del MENÚ, con su mismo filtro de permisos. Antes era una
    lista fija (`ITEMS`) filtrada por el nombre del rol: no salían Facturas de
    colaboradores, Diplomas, WhatsApp, Mi tablero… y una gestora veía
    Contabilidad o Nóminas.
  - Personas, productos, ventas por número, facturas, tareas y usuarios del
    equipo, cada tipo SOLO con su permiso efectivo (/auth/me). El ámbito (sus
    campus; si es gestora, solo lo suyo) lo pone la ruta del servidor.
  - Sin acentos y el teléfono por cifras: lo hace el servidor (migración 248).

  `includeConverted` no se puede quitar: sin él, /leads añade «status <>
  convertido» y la búsqueda esconde justo a quien ya compró —a quien más se
  busca, para cobrar o facturar—. Es el fallo que Diego encontró el 14/09.
*/

export function sinAcentos(str) {
  return String(str || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Las páginas que encuentra alguien: exactamente las de su menú. */
export function paginasDelBuscador({ user, can }) {
  const soloColab = esSoloColaboraciones(user);
  const roles = rolesDe(user).length ? rolesDe(user) : ['gestor'];
  const abre = (it) => it.to && !it.href && !it.comingSoon && isBetaAllowed(it.to);
  const list = [];
  const seen = new Set();
  const meter = (it, grupo, iconoPadre) => {
    if (!abre(it) || seen.has(it.to)) return;
    seen.add(it.to);
    list.push({ label: it.label, grupo, to: it.to, icon: it.icon || iconoPadre || SquaresFour });
  };
  for (const section of NAV_SECTIONS) {
    for (const item of entradasDeSeccion(section, { user, can, soloColab })) {
      if (Array.isArray(item.children)) {
        item.children
          .filter((c) => canSeeItem(c, roles, soloColab, user, can))
          .forEach((c) => meter(c, item.label, item.icon));
      } else {
        meter(item, section.label);
      }
    }
  }
  return list;
}

/**
 * Qué tipos de resultado busca alguien: los permisos que protegen su pantalla,
 * los efectivos (con sus excepciones). Quien es SOLO tutor no busca personas
 * ni productos (decisión de Diego, 02/11): el catálogo le da `leads.view` y
 * `products.view`, pero su menú no tiene ninguna de las dos.
 */
export function queBusca({ user, can }) {
  const tiene = (p) => typeof can === 'function' && can(p) === true;
  const roles = rolesDe(user);
  const soloTutor = roles.length === 1 && roles[0] === 'tutor';
  const personas = !soloTutor && tiene('leads.view');
  const productos = !soloTutor && tiene('products.view');
  return {
    personas,
    clientes: personas && tiene('clients.view'),
    productos,
    crearProspecto: personas && tiene('leads.create'),
    crearProducto: productos && tiene('products.create'),
    ventas: !soloTutor && tiene('conversions.view'),
    facturas: !soloTutor && tiene('facturas.view'),
    tareas: tiene('tasks.view_own') || tiene('tasks.view_all'),
    usuarios: tiene('users.view'),
  };
}

/** A dónde lleva cada resultado. Rutas de App.jsx (lo comprueba la prueba). */
export const destinoDePersona = (l) => (l.status === 'convertido' ? `/clients/${l.id}` : `/leads/${l.id}`);
export const destinoDeProducto = (p) => `/products/${p.id}`;
export const destinoDeVenta = (v) => `/ventas/${v.id}`;
// Una factura no tiene ficha propia: se abre la venta de la que cuelga, o la lista.
export const destinoDeFactura = (f) => (f.conversion_id ? `/ventas/${f.conversion_id}` : '/accounting/facturas');
export const destinoDeTarea = (t) => `/tareas?id=${t.id}`;
// La lista de usuarios de Configuración no tiene buscador: se abre la pestaña.
export const destinoDeUsuario = () => '/configuracion';

/** «1234» o «#1234»: el número de una venta. */
export const numeroDeVenta = (q) => (/^#?\d{1,9}$/.test(q.trim()) ? q.trim().replace('#', '') : null);
/** «F-2026/0641» se guarda como «2026/0641»: se quita la «F-» de delante. */
export const terminoDeFactura = (q) => q.trim().replace(/^f\s*-?\s*(?=\d)/i, '');
/** Letras a partir de las que se pregunta al servidor. */
export const MIN_SERVIDOR = 2;

const VACIO = { personas: [], productos: [], ventas: [], facturas: [], tareas: [], usuarios: [] };

export default function CommandPalette() {
  const { user, logout, permissions } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  // La misma `can` por usuario y mapa de permisos: una nueva en cada render
  // relanzaba la búsqueda en bucle (lo vio Hugo en MultiCRM: 75 peticiones).
  const can = useMemo(() => crearCan(user, permissions), [user, permissions]);
  const { activeProject } = useProjectContext() || {};
  const idsDelAmbito = useIdsDelAmbito();
  const pages = useMemo(() => paginasDelBuscador({ user, can }), [user, can]);
  const busca = useMemo(() => queBusca({ user, can }), [user, can]);
  const [res, setRes] = useState(VACIO);
  const [buscando, setBuscando] = useState(false);
  const catalogos = useRef(new Map());
  const ultima = useRef(0);

  // Atajo global Ctrl+K / Cmd+K
  useEffect(() => {
    function onKey(e) {
      const isCmdK = (e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey);
      if (isCmdK) {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  useEffect(() => {
    if (open) {
      setQ('');
      setActiveIdx(0);
      setRes(VACIO);
      catalogos.current = new Map();
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  const search = useCallback(async (texto) => {
    const turno = ++ultima.current;
    const vigente = () => turno === ultima.current;
    const vaciar = () => { setRes(VACIO); setBuscando(false); };
    if (!texto || (texto.length < MIN_SERVIDOR && !numeroDeVenta(texto))) return vaciar();

    // Un campus, o los del ámbito: el servidor exige projectId o projectIds y
    // los recorta a los de la persona.
    const unCampus = activeProject?.id && activeProject.id > 0;
    const campus = unCampus ? [activeProject.id] : idsDelAmbito;
    const b = texto.length < MIN_SERVIDOR ? { ventas: busca.ventas } : busca;
    if (!campus.length || !Object.values(b).some(Boolean)) return vaciar();
    const ambito = unCampus ? `projectId=${activeProject.id}` : `projectIds=${campus.join(',')}`;
    const pedir = (url) => client.get(url).catch(() => ({ success: false }));
    const lista = (r) => (r?.success && Array.isArray(r.data) ? r.data.slice(0, 5) : []);
    const t = encodeURIComponent(texto);
    const numero = numeroDeVenta(texto);
    const catalogoDe = (pid) => {
      if (!catalogos.current.has(pid)) {
        catalogos.current.set(pid, client.get(`/products?projectId=${pid}`)
          .then((r) => (r.success && Array.isArray(r.data) ? r.data : []))
          .catch(() => []));
      }
      return catalogos.current.get(pid);
    };

    setBuscando(true);
    try {
      const [personas, catalogo, venta, facturas, tareas, usuarios] = await Promise.all([
        b.personas ? pedir(`/leads?${ambito}&search=${t}&limit=5${b.clientes ? '&includeConverted=1' : ''}`) : null,
        b.productos
          ? Promise.all(campus.map(catalogoDe)).then((ls) => { const vistos = new Set(); return ls.flat().filter((p) => !vistos.has(p.id) && vistos.add(p.id)); })
          : [],
        b.ventas && numero ? pedir(`/conversions/${numero}`) : null,
        // `GET /invoices` entiende un campus cada vez: facturas, solo con un campus arriba.
        b.facturas && unCampus ? pedir(`/invoices?projectId=${activeProject.id}&search=${encodeURIComponent(terminoDeFactura(texto))}&limit=5`) : null,
        b.tareas ? pedir(`/tasks?search=${t}`) : null,
        b.usuarios ? pedir(`/users/buscar?q=${t}${unCampus ? `&projectIds=${activeProject.id}` : ''}`) : null,
      ]);
      if (!vigente()) return;
      const normQ = sinAcentos(texto);
      setRes({
        personas: lista(personas),
        productos: catalogo.filter((p) => sinAcentos(p.nombre).includes(normQ) || sinAcentos(p.codigo || p.sku).includes(normQ)).slice(0, 5),
        ventas: venta?.success && venta.data?.id ? [venta.data] : [],
        facturas: lista(facturas),
        tareas: lista(tareas),
        usuarios: lista(usuarios),
      });
    } catch {
      if (vigente()) vaciar();
    } finally {
      if (vigente()) setBuscando(false);
    }
  }, [activeProject?.id, idsDelAmbito, busca]);

  useEffect(() => {
    if (!open) return undefined;
    const texto = q.trim();
    if (texto.length >= MIN_SERVIDOR || numeroDeVenta(texto)) setBuscando(true);
    const timer = setTimeout(() => search(texto), 250);
    return () => clearTimeout(timer);
  }, [open, q, search]);

  const filtered = useMemo(() => {
    const acciones = [
      busca.crearProspecto && pages.some((p) => p.to === '/leads')
        && { id: '__new-lead', label: 'Crear nuevo prospecto', icon: Plus, group: 'Acciones', to: '/leads?new=1' },
      busca.crearProducto && pages.some((p) => p.to === '/products')
        && { id: '__new-product', label: 'Crear nuevo producto', icon: Plus, group: 'Acciones', to: '/products' },
      { id: '__logout', label: 'Cerrar sesión', icon: Power, group: 'Acciones', action: 'logout' },
    ].filter(Boolean);
    const paginas = pages.map((p, i) => ({ id: `pag-${i}`, label: p.label, sublabel: p.grupo, to: p.to, icon: p.icon, group: 'Ir a' }));
    const texto = q.trim();
    if (!texto) return paginas.slice(0, 8).concat(acciones);
    const needle = sinAcentos(texto);
    const casa = (it) => sinAcentos(`${it.label} ${it.sublabel || ''}`).includes(needle);
    const euros = (n) => (n != null && n !== '' ? `${Number(n).toLocaleString('es-ES', { maximumFractionDigits: 2 })} €` : '');
    // Las personas van DELANTE: quien escribe un nombre o un correo busca a
    // alguien, no una pantalla.
    return [
      ...res.personas.map((l) => ({
        id: `lead-${l.id}`, label: l.nombre || `#${l.id}`, icon: Users, group: 'Personas', to: destinoDePersona(l),
        // Se dice si ya compró: un cliente y un prospecto vivo no son lo mismo.
        sublabel: (l.email || l.telefono || `#${l.id}`) + (l.status === 'convertido' ? ' · cliente' : ''),
      })),
      ...res.productos.map((p) => ({ id: `prod-${p.id}`, label: p.nombre, sublabel: p.codigo || '', icon: Package, group: 'Productos', to: destinoDeProducto(p) })),
      ...res.ventas.map((v) => ({
        id: `venta-${v.id}`, label: `Venta ${v.id}`, icon: Receipt, group: 'Ventas', to: destinoDeVenta(v),
        sublabel: [v.lead_nombre, v.producto_contratado, euros(v.importe_total)].filter(Boolean).join(' · '),
      })),
      ...res.facturas.map((f) => ({
        id: `fact-${f.id}`, label: `${f.tipo === 'proforma' ? 'Proforma' : 'Factura'} ${f.codigo || f.numero}`, icon: Receipt, group: 'Facturas', to: destinoDeFactura(f),
        sublabel: [f.cliente_nombre, euros(f.total)].filter(Boolean).join(' · '),
      })),
      ...res.tareas.map((tk) => ({ id: `tarea-${tk.id}`, label: tk.title, icon: Kanban, group: 'Tareas', to: destinoDeTarea(tk) })),
      ...res.usuarios.map((u) => ({
        id: `user-${u.id}`, label: u.nombre, icon: UserGear, group: 'Usuarios', to: destinoDeUsuario(u),
        sublabel: [u.email, u.active === false ? 'Inactivo' : ''].filter(Boolean).join(' · '),
      })),
      ...paginas.filter(casa),
      ...acciones.filter(casa),
    ];
  }, [q, pages, busca, res]);

  const grouped = useMemo(() => {
    const map = new Map();
    filtered.forEach((it) => {
      const arr = map.get(it.group) || [];
      arr.push(it);
      map.set(it.group, arr);
    });
    return Array.from(map.entries());
  }, [filtered]);

  // El orden de las flechas es el de los grupos tal como se pintan.
  const flat = useMemo(() => grouped.flatMap(([, items]) => items), [grouped]);

  useEffect(() => {
    if (activeIdx >= flat.length) setActiveIdx(0);
  }, [flat.length, activeIdx]);

  // Scroll del item activo a la vista
  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx, open]);

  async function runItem(it) {
    if (!it) return;
    setOpen(false);
    if (it.action === 'logout') {
      try { await logout(); } catch {}
      navigate('/login');
      return;
    }
    if (it.to) navigate(it.to);
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx((i) => Math.min(flat.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      runItem(flat[activeIdx]);
    }
  }

  if (!open) return null;

  let runningIdx = 0;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-20 px-4 bg-black/60 backdrop-blur-sm"
      onClick={() => setOpen(false)}
    >
      <div
        role="dialog"
        aria-label="Búsqueda rápida"
        className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <MagnifyingGlass size={16} weight="bold" className="text-muted-foreground flex-shrink-0" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => { setQ(e.target.value); setActiveIdx(0); }}
            onKeyDown={onKeyDown}
            placeholder="Buscar personas, ventas, facturas, páginas…"
            className="flex-1 min-w-0 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
          />
          {buscando && <span className="hidden sm:inline text-[10px] text-muted-foreground font-mono animate-pulse flex-shrink-0">buscando…</span>}
          <kbd className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded border border-border bg-muted text-muted-foreground">
            Esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto">
          {flat.length === 0 ? (
            <div className="px-4 py-10 text-center text-sm text-muted-foreground" role="status">
              {buscando ? 'Buscando…' : `Sin coincidencias para "${q}"`}
            </div>
          ) : (
            grouped.map(([groupLabel, items]) => (
              <div key={groupLabel} className="py-1">
                <div className="px-4 pt-2 pb-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground/70">
                  {groupLabel}
                </div>
                {items.map((it) => {
                  const idx = runningIdx++;
                  const isActive = idx === activeIdx;
                  const Icon = it.icon || SquaresFour;
                  return (
                    <button
                      key={it.id}
                      data-idx={idx}
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => runItem(it)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-sm text-left transition-colors ${
                        isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted/60'
                      }`}
                    >
                      <Icon size={16} weight={isActive ? 'duotone' : 'regular'} className="flex-shrink-0" />
                      <span className="flex-1 min-w-0 truncate">
                        {it.label}
                        {/* El correo o el teléfono debajo: dos «Maria Garcia» son
                            indistinguibles sin esto. */}
                        {it.sublabel && (
                          <span className="block truncate text-[11px] font-normal text-muted-foreground">
                            {it.sublabel}
                          </span>
                        )}
                      </span>
                      {isActive && (
                        <kbd className="text-[9px] font-mono font-semibold px-1 py-0.5 rounded border border-primary/30 bg-primary/10">
                          ↵
                        </kbd>
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="border-t border-border px-4 py-2 flex items-center justify-between text-[10px] text-muted-foreground/70 bg-muted/30">
          <span className="inline-flex items-center gap-1.5">
            <Command size={10} /> + K  para abrir/cerrar
          </span>
          <span className="hidden sm:inline-flex items-center gap-2">
            <span>↑ ↓ navegar</span>
            <span>↵ seleccionar</span>
          </span>
        </div>
      </div>
    </div>
  );
}
