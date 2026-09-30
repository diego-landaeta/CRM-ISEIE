import { useState } from 'react';
import { Robot, Warning, X } from '@phosphor-icons/react';
import Portal from '@/shared/components/ui/portal';
import Field from '@/shared/components/ui/Field';
import Select from '@/shared/components/ui/Select';
import { inputClass } from '@/shared/lib/ui';
import { toast } from '@/shared/hooks/useToast';
import {
  conectoresApi, opcionesDeAlcance, type AlcanceConector, type Campus, type Conector,
} from '@/modules/connectors/api/connectors.api';

/**
 * Alta y cambio de una conexión de Claude.
 *
 * Diego, 29/09: «lo de Claude MCP, ese formulario pasa a esa parte de MCP en
 * conexión». Antes era un tipo más de «Nuevo conector», en Captación. Por
 * dentro sigue siendo un conector de tipo `mcp` —mismo alcance, mismas reglas
 * en el servidor—, pero se crea, se ve y se gestiona aquí.
 *
 * Solo pide dos cosas: qué podrá consultar Claude y un nombre. No trae datos a
 * ninguna parte, así que ni destino ni campus por defecto.
 */

interface Props {
  /** `null` = alta. Una conexión = cambio. */
  conexion: Conector | null;
  /** El campus o la empresa puestos arriba, para proponerlos. */
  projectId: number | null;
  issuerId: number | null;
  /** Todos los campus de la persona, con su empresa. */
  proyectos: Campus[];
  esSuperadmin: boolean;
  onCerrar: () => void;
  /** En un alta trae la URL (`mcp.token`), que solo se ve esta vez. */
  onGuardado: (datos: Conector & { mcp?: { token: string } }) => void;
}

export default function DialogoConexionClaude({
  conexion, projectId, issuerId, proyectos, esSuperadmin, onCerrar, onGuardado,
}: Props) {
  const esAlta = conexion === null;
  const [para, setPara] = useState<string>(() => {
    if (conexion?.alcance === 'sistema') return 'sistema';
    if (conexion?.alcance === 'empresa' && conexion.issuer_id) return `e:${conexion.issuer_id}`;
    if (conexion) return `c:${conexion.project_id}`;
    if (issuerId) return `e:${issuerId}`;
    return projectId ? `c:${projectId}` : '';
  });
  const [nombre, setNombre] = useState(conexion?.label || '');
  const [guardando, setGuardando] = useState(false);

  const alcance: AlcanceConector = para === 'sistema' ? 'sistema' : para.startsWith('e:') ? 'empresa' : 'campus';
  const empresaId = alcance === 'empresa' ? Number(para.slice(2)) : null;
  // El conector necesita un campus aunque Claude no traiga nada: en uno de
  // empresa o de sistema se pone uno de los suyos, y no se enseña.
  const campus = alcance === 'campus'
    ? (para ? Number(para.slice(2)) : null)
    : (alcance === 'empresa'
      ? proyectos.find((p) => Number(p.sociedad_emisora_id) === empresaId)?.id
      : proyectos[0]?.id) ?? null;

  async function guardar() {
    if (!nombre.trim() || !para || !campus) return;
    setGuardando(true);
    try {
      const deQuien = { project_id: campus, alcance, issuer_id: empresaId };
      const r = esAlta
        ? await conectoresApi.crear({ ...deQuien, type: 'mcp', label: nombre.trim(), destination: 'product' })
        : await conectoresApi.cambiar(conexion!.id, { ...deQuien, label: nombre.trim() });
      if (!r.success) throw new Error((r as { error?: string }).error || 'no se pudo guardar');
      toast({ title: esAlta ? 'Conexión creada' : 'Conexión guardada' });
      onGuardado(r.data);
    } catch (e) {
      toast({ title: 'No se pudo guardar', description: (e as Error).message, variant: 'destructive' });
    } finally { setGuardando(false); }
  }

  return (
    <Portal>
      <div className="fixed inset-0 z-50 grid place-items-center p-4 bg-black/60" onClick={onCerrar}>
        <div role="dialog" aria-modal="true" aria-label={esAlta ? 'Nueva conexión con Claude' : 'Editar conexión con Claude'}
          className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-md border border-border bg-card shadow-sm"
          onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-5 py-3 border-b border-border">
            <h2 className="flex items-center gap-2 font-semibold">
              <Robot size={16} /> {esAlta ? 'Nueva conexión con Claude' : 'Editar conexión con Claude'}
            </h2>
            <button type="button" onClick={onCerrar} aria-label="Cerrar"
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"><X size={16} /></button>
          </div>

          <div className="p-5 space-y-3">
            <Field label="Qué podrá consultar Claude" required
              hint="Un campus, una empresa entera o, si eres super admin, todo el sistema. Cada persona que saque su URL verá solo lo suyo dentro de esto.">
              <Select
                value={para}
                onChange={setPara}
                options={[{ value: '', label: 'Elige campus, empresa o todo el sistema' }, ...opcionesDeAlcance(proyectos, esSuperadmin)]}
                ariaLabel="Qué podrá consultar Claude"
              />
            </Field>
            <Field label="Nombre" required hint="Para reconocerla en la lista." htmlFor="conexion-nombre">
              <input id="conexion-nombre" value={nombre} onChange={(e) => setNombre(e.target.value)}
                maxLength={150} placeholder="Claude de CEDIA" className={inputClass} />
            </Field>
            <p className="flex items-start gap-2 text-[11px] text-muted-foreground bg-muted rounded-md p-2.5">
              <Warning size={13} className="mt-0.5 shrink-0" />
              <span>
                Claude solo <strong>consulta</strong> —prospectos, ventas, facturas, cobros e informes— y solo lo que
                cada persona ya ve dentro de lo elegido arriba; una gestora, solo lo suyo. Cada consulta queda registrada.
                {esAlta && ' Al crearla te damos tu URL; se enseña una vez.'}
              </span>
            </p>
          </div>

          <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
            <button type="button" onClick={onCerrar}
              className="inline-flex h-8 items-center rounded-md border border-border px-3 text-xs font-bold hover:bg-muted">
              Cancelar
            </button>
            <button type="button" onClick={guardar} disabled={guardando || !nombre.trim() || !para || !campus}
              className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-bold text-primary-foreground hover:opacity-90 disabled:opacity-50">
              {guardando ? 'Guardando…' : esAlta ? 'Crear y ver mi URL' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>
    </Portal>
  );
}
