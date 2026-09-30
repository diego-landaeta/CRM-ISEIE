import { useState } from 'react';
import {
  X, Warning, ShoppingBag, Receipt, Article, Code, BracketsCurly, ArrowLeft,
  type Icon,
} from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { cn } from '@/shared/lib/utils';
import { toast } from '@/shared/hooks/useToast';
import {
  conectoresApi, TIPOS, DESTINOS, CAMPOS_POR_TIPO, opcionesDeAlcance,
  type Conector, type TipoConector, type DestinoConector, type AlcanceConector, type Campus,
} from '../api/connectors.api';

/**
 * El primer paso de «Nuevo conector»: cuál. Diego, 29/09: «es mejor que
 * separemos: nuevo conector, y antes salga su formulario preguntando cuál es,
 * y cuando lo selecciones sea personalizado».
 *
 * Claude ya no está aquí: desde el 29/09 tiene su propio formulario en
 * Conexión → MCP («lo de Claude MCP, ese formulario pasa a esa parte de MCP en
 * conexión»). Aquí solo queda traer datos de fuera.
 */
const TIPOS_DE_DATOS: Array<{ id: TipoConector; icono: Icon; que: string }> = [
  { id: 'woocommerce_products', icono: ShoppingBag, que: 'Los cursos de una tienda WooCommerce, al catálogo.' },
  { id: 'woocommerce_orders', icono: Receipt, que: 'Los pedidos de una tienda WooCommerce.' },
  { id: 'wp_rest', icono: Article, que: 'Entradas o páginas de un WordPress, por su API.' },
  { id: 'acf', icono: BracketsCurly, que: 'Lo mismo, con los campos personalizados de ACF.' },
  { id: 'custom_api', icono: Code, que: 'Cualquier dirección que devuelva una lista en JSON.' },
];
const nombreDelTipo = (t: TipoConector) => TIPOS.find((x) => x.id === t)?.label || t;

/**
 * Alta y cambio de un conector (#6).
 *
 * LOS SECRETOS SE ESCRIBEN, NO SE LEEN
 *
 * `consumer_secret`, la contrasena de aplicacion y el token no vuelven nunca del
 * servidor — se tapan en el controlador. Asi que al editar salen VACIOS con la
 * nota de que ya hay uno guardado: dejarlo en blanco no lo cambia.
 *
 * Rellenarlos obligaria a traer el secreto entero al navegador solo por abrir un
 * dialogo, que es justo lo que se quito.
 */

/**
 * Lo que hay que advertir al elegir el tipo (#131).
 *
 * Dos de los cinco tipos —los de WooCommerce— hacen algo que ya tiene su propia
 * pantalla en Catálogo, y esa hace más: sincroniza sola cada X minutos y saca el
 * temario de la ficha del curso. Un conector no. Elegir aquí uno de esos sin
 * saberlo es montar la mitad de algo que ya existe entero.
 *
 * No se quitan de la lista: el servidor los admite y siguen siendo útiles para
 * una tienda que no es la del proyecto. Pero se dice.
 */
function avisoDelTipo(tipo: TipoConector): string | undefined {
  if (tipo === 'woocommerce_products' || tipo === 'woocommerce_orders') {
    return 'La tienda del proyecto ya tiene su pantalla en Catálogo → WooCommerce, y esa además sincroniza sola. Esto es para una tienda distinta.';
  }
  return undefined;
}

interface Props {
  /** `null` = alta. Un conector = cambio. */
  conector: Conector | null;
  /** El campus puesto arriba (si hay uno). */
  projectId: number | null;
  /** La empresa puesta arriba (si hay una). */
  issuerId?: number | null;
  /** Todos los campus de la persona, con su empresa. */
  proyectos?: Campus[];
  esSuperadmin?: boolean;
  onCerrar: () => void;
  onGuardado: (datos?: Conector) => void;
}

export default function DialogoConector({
  conector, projectId, issuerId = null, proyectos = [], esSuperadmin = false, onCerrar, onGuardado,
}: Props) {
  const esAlta = conector === null;

  // «Para quién»: `sistema`, `e:<empresa>` o `c:<campus>`. Al abrir, lo que
  // está puesto arriba —o lo que ya tenía el conector—.
  const [para, setPara] = useState<string>(() => {
    if (conector?.alcance === 'sistema') return 'sistema';
    if (conector?.alcance === 'empresa' && conector.issuer_id) return `e:${conector.issuer_id}`;
    if (conector) return `c:${conector.project_id}`;
    if (issuerId) return `e:${issuerId}`;
    return projectId ? `c:${projectId}` : '';
  });
  const alcance: AlcanceConector = para === 'sistema' ? 'sistema' : para.startsWith('e:') ? 'empresa' : 'campus';
  const empresaId = alcance === 'empresa' ? Number(para.slice(2)) : null;
  // Los campus donde puede caer lo importado. El «por defecto» recibe lo que no
  // diga su campus; si el conector es de un campus, es ese.
  const campusDelAlcance = alcance === 'sistema' ? proyectos
    : alcance === 'empresa' ? proyectos.filter((p) => Number(p.sociedad_emisora_id) === empresaId) : [];
  const [porDefecto, setPorDefecto] = useState<number | null>(conector && conector.alcance !== 'campus' ? conector.project_id : null);
  const defectoValido = porDefecto && campusDelAlcance.some((p) => p.id === porDefecto)
    ? porDefecto
    : (campusDelAlcance.find((p) => p.id === projectId)?.id ?? campusDelAlcance[0]?.id ?? null);
  const proyecto = alcance === 'campus' ? (para ? Number(para.slice(2)) : null) : defectoValido;


  // Sin tipo todavía = el primer paso, elegir cuál. Al editar ya viene y no se cambia.
  const [tipo, setTipo] = useState<TipoConector | null>(conector?.type ?? null);
  const [destino, setDestino] = useState<DestinoConector>(conector?.destination || 'product');
  const [etiqueta, setEtiqueta] = useState(conector?.label || '');
  // Solo lo que NO es secreto viene relleno: es lo unico que el servidor manda.
  const [campos, setCampos] = useState<Record<string, string>>({ ...(conector?.config || {}) });
  const [guardando, setGuardando] = useState(false);

  const definicion = tipo ? CAMPOS_POR_TIPO[tipo] || [] : [];
  const yaGuardado = conector?.secretos_guardados || {};

  // Al cambiar de tipo en un alta, los campos del anterior no valen.
  const elegirTipo = (t: TipoConector | null) => {
    setTipo(t);
    if (esAlta) setCampos({});
  };

  const falta = !tipo || !proyecto || definicion.some((c) => {
    if (!c.requerido) return false;
    if (c.secreto) return esAlta ? !campos[c.clave] : !(campos[c.clave] || yaGuardado[c.clave]);
    return !campos[c.clave];
  });

  async function guardar() {
    if (!etiqueta.trim()) { toast({ title: 'Ponle un nombre', variant: 'destructive' }); return; }
    setGuardando(true);
    try {
      // Los secretos en blanco NO se mandan: el servidor fusiona, así que no
      // mandarlos deja el que había. Mandar '' lo borraría.
      const config: Record<string, string> = {};
      for (const c of definicion) {
        const v = (campos[c.clave] ?? '').trim();
        if (c.secreto && !v) continue;
        if (v) config[c.clave] = v;
      }

      const deQuien = { project_id: proyecto!, alcance, issuer_id: empresaId };
      const r = esAlta
        ? await conectoresApi.crear({ ...deQuien, type: tipo!, label: etiqueta.trim(), destination: destino, config })
        : await conectoresApi.cambiar(conector!.id, { ...deQuien, label: etiqueta.trim(), destination: destino, config });

      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo guardar');
      toast({
        title: esAlta ? 'Conector creado' : 'Conector guardado',
        description: esAlta ? 'Ahora puedes probar la conexión y ver qué trae.' : undefined,
      });
      onGuardado(r.data);
    } catch (e: any) {
      toast({ title: 'No se pudo guardar', description: e?.message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60" onClick={onCerrar}>
        <div
          role="dialog" aria-modal="true" aria-label={esAlta ? 'Nuevo conector' : 'Editar conector'}
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-md border border-border bg-card shadow-sm"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="flex items-center gap-2 font-semibold">
              {esAlta && tipo && (
                <button type="button" onClick={() => elegirTipo(null)} aria-label="Elegir otro tipo" title="Elegir otro tipo"
                  className="p-1 -ml-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
                  <ArrowLeft size={15} />
                </button>
              )}
              {!tipo ? 'Nuevo conector · ¿cuál quieres crear?' : `${esAlta ? 'Nuevo' : 'Editar'} · ${nombreDelTipo(tipo)}`}
            </h2>
            <button type="button" onClick={onCerrar} aria-label="Cerrar"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted">
              <X size={16} />
            </button>
          </div>

          {/* `space-y-3`, que es lo que usan los demas dialogos ya convertidos
              —FiscalDataDialog, LeadFormDialog—. La gracia del #106 es que se
              parezcan, asi que el espaciado se copia en vez de elegirse. */}
          {/* PASO 1 · cuál. */}
          {!tipo && (
            <div className="p-5 space-y-2">
              <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Traer datos de fuera al CRM</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {TIPOS_DE_DATOS.map(({ id, icono: Icono, que }) => (
                  <button key={id} type="button" onClick={() => elegirTipo(id)}
                    className="flex items-start gap-3 rounded-md border border-border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-muted">
                    <Icono size={20} weight="duotone" className="mt-0.5 shrink-0 text-primary" />
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold">{nombreDelTipo(id)}</span>
                      <span className="block text-xs text-muted-foreground">{que}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground pt-1">
                Para consultar el CRM desde Claude, ve a <strong>Conexión → MCP</strong>.
              </p>
            </div>
          )}

          {/* PASO 2 · el formulario de ese tipo, y solo lo suyo. */}
          {tipo && (
          <div className="p-5 space-y-3">
            {tipo && avisoDelTipo(tipo) && esAlta && (
              <p className="text-xs text-muted-foreground">{avisoDelTipo(tipo)}</p>
            )}
            <Field label="Para quién" required
              hint={alcance === 'campus'
                ? 'Trae los datos a este campus.'
                : 'Un solo conector para todos sus campus: cada dato va al campus que diga (campo «Campus» al mapear).'}>
              <Select
                value={para}
                onChange={setPara}
                options={[{ value: '', label: 'Elige campus, empresa o todo el sistema' }, ...opcionesDeAlcance(proyectos, esSuperadmin)]}
                ariaLabel="Para quién"
              />
            </Field>
            {alcance !== 'campus' && (
              <Field label="Campus por defecto" required hint="Adónde va lo que no diga de qué campus es.">
                <Select
                  value={proyecto ? String(proyecto) : ''}
                  onChange={(v: string) => setPorDefecto(v ? Number(v) : null)}
                  options={campusDelAlcance.map((p) => ({ value: String(p.id), label: p.nombre }))}
                  ariaLabel="Campus por defecto"
                />
              </Field>
            )}
            <Field label="Nombre" required hint="Para reconocerlo en la lista." htmlFor="conector-nombre">
              <input
                id="conector-nombre"
                value={etiqueta}
                onChange={(e) => setEtiqueta(e.target.value)}
                placeholder="Tienda de Psiko Aprende"
                className={inputClass}
              />
            </Field>

            {/* El tipo ya se eligió en el primer paso (y al editar no se cambia). */}
            <Field label="Dónde acaba" hint="A qué parte del CRM van los datos.">
              <Select
                value={destino}
                onChange={setDestino}
                options={DESTINOS.map((d) => ({ value: d.id as DestinoConector, label: d.label }))}
                ariaLabel="Dónde acaba"
              />
            </Field>

            <div className="space-y-3">
              {definicion.map((c) => (
                <Field
                  key={c.clave}
                  label={c.label}
                  required={c.requerido}
                  htmlFor={`conector-${c.clave}`}
                  // Un secreto ya guardado manda sobre la ayuda: es lo único que
                  // hay que saber en ese momento —que dejarlo vacío no lo borra—.
                  hint={c.secreto && yaGuardado[c.clave]
                    ? 'Ya hay uno guardado. Déjalo vacío para no cambiarlo.'
                    : c.ayuda}
                >
                  <input
                    id={`conector-${c.clave}`}
                    type={c.secreto ? 'password' : 'text'}
                    value={campos[c.clave] ?? ''}
                    onChange={(e) => setCampos((p) => ({ ...p, [c.clave]: e.target.value }))}
                    // La ayuda va debajo, en el Field, y no tambien aqui: antes
                    // salia dos veces —«https://mitienda.com» de marcador y otra
                    // vez de pista— y leer lo mismo dos veces hace dudar de si
                    // dicen cosas distintas. El marcador se guarda para lo unico
                    // que la pista no puede decir: que ya hay un secreto puesto.
                    placeholder={c.secreto && yaGuardado[c.clave] ? '•••••••• guardado' : ''}
                    autoComplete="off"
                    // Una dirección o una clave se leen carácter a carácter: un
                    // ck_ de un c k _ mal copiado no se ve en tipografía normal.
                    className={cn(inputClass, 'font-mono')}
                  />
                </Field>
              ))}
            </div>

            {/* El texto va en su propio <span>: si se deja suelto, el <strong>
                pasa a ser OTRO hijo del flex y se va a una columna aparte. */}
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted rounded-md p-2.5">
              <Warning size={13} className="mt-0.5 shrink-0" />
              <span>
                Las claves se guardan en el servidor y no se vuelven a mostrar. Este conector
                solo <strong>lee</strong>: el CRM nunca escribe en el sitio de origen.
              </span>
            </p>
          </div>
          )}

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
            <button type="button" onClick={onCerrar}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-bold hover:bg-muted">
              Cancelar
            </button>
            {tipo && (
              <button type="button" onClick={guardar} disabled={guardando || falta || !etiqueta.trim()}
                title={falta ? 'Faltan campos obligatorios' : undefined}
                className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
                {guardando ? 'Guardando…' : esAlta ? 'Crear' : 'Guardar'}
              </button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
