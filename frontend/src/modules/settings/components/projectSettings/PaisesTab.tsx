// #221: el país de entrada de cada prospecto, por el subdominio de la web.
//
// Una tabla por campus: prefijo del subdominio → país (código ISO de dos
// letras). `cl.fonoaprende.com` → `cl` → Chile. El dominio raíz y `www` no
// llevan país. Añadir un país es añadir aquí una fila: el alta de prospectos la
// usa al momento, y para los que ya estaban está
// `backend/scripts/rellenar-pais-origen.mjs`. Lo guarda quien tiene `projects.edit`.

import { useMemo, useState } from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { toast } from '@/shared/hooks/useToast';
import usePermission from '@/shared/hooks/usePermission';
import { nombreDelPais } from '@/shared/lib/paises';
import { inputClass } from '@/shared/lib/ui';

function SectionTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

interface Project {
  id: number;
  nombre?: string;
  paises_por_subdominio?: Record<string, string> | null;
}

interface Props {
  project: Project;
  onSaved?: (next?: Project) => void;
}

interface Fila { prefijo: string; codigo: string }

// Los cuatro que pidió Manuel para Psiko Aprende y Fono Aprende: a un clic.
const SUGERIDOS: Fila[] = [
  { prefijo: 'mx', codigo: 'MX' }, { prefijo: 'co', codigo: 'CO' },
  { prefijo: 'cl', codigo: 'CL' }, { prefijo: 'pe', codigo: 'PE' },
];

const PREFIJO = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const CODIGO = /^[A-Z]{2}$/;

function errorDe(f: Fila, repetidos: Set<string>): string | null {
  if (!f.prefijo && !f.codigo) return null;
  if (!PREFIJO.test(f.prefijo)) return 'Prefijo: letras, números y guiones (cl, mx…)';
  if (f.prefijo === 'www') return '«www» no es un país';
  if (repetidos.has(f.prefijo)) return 'Ese prefijo ya está';
  if (!CODIGO.test(f.codigo)) return 'País: código de dos letras (CL, MX…)';
  return null;
}

export default function PaisesTab({ project, onSaved }: Props) {
  const { can } = usePermission();
  const puede = can('projects.edit');
  const [filas, setFilas] = useState<Fila[]>(() =>
    Object.entries(project.paises_por_subdominio || {}).map(([prefijo, codigo]) => ({ prefijo, codigo })));
  const [saving, setSaving] = useState(false);

  const errores = useMemo(() => {
    const vistos = new Set<string>();
    return filas.map((f) => {
      const repetidos = new Set(vistos);
      vistos.add(f.prefijo);
      return errorDe(f, repetidos);
    });
  }, [filas]);
  const hayErrores = errores.some(Boolean);

  const cambiar = (i: number, campo: keyof Fila, valor: string) => {
    setFilas((fs) => fs.map((f, j) => (j === i
      ? { ...f, [campo]: campo === 'prefijo' ? valor.trim().toLowerCase() : valor.trim().toUpperCase().slice(0, 2) }
      : f)));
  };
  const quitar = (i: number) => setFilas((fs) => fs.filter((_, j) => j !== i));
  const anadir = (f: Fila = { prefijo: '', codigo: '' }) => setFilas((fs) => [...fs, f]);
  const faltan = SUGERIDOS.filter((s) => !filas.some((f) => f.prefijo === s.prefijo));

  async function guardar() {
    const tabla: Record<string, string> = {};
    for (const f of filas) if (f.prefijo && f.codigo) tabla[f.prefijo] = f.codigo;
    setSaving(true);
    try {
      const r = await client.patch(`/projects/${project.id}`, { paises_por_subdominio: tabla }) as { data?: Project };
      toast({ title: 'Países guardados', description: 'Los prospectos que entren desde ahora llevarán su país.' });
      onSaved?.(r?.data);
    } catch (err) {
      const e = err as { data?: { error?: string }; message?: string };
      toast({ title: 'No se pudo guardar', description: e?.data?.error || e?.message, variant: 'destructive' });
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5 max-w-3xl">
      <SectionTitle
        title="País por subdominio"
        subtitle="Cada prospecto que entre desde un subdominio de esta tabla queda con su país: «cl.tuweb.com» → Chile. El dominio raíz y «www» no llevan país, y un prefijo que no esté aquí, tampoco."
      />

      <div className="rounded-md border border-border overflow-hidden">
        <div className="grid grid-cols-[1fr_7rem_1fr_2.5rem] gap-2 px-3 py-2 bg-muted/40 text-xs font-medium text-muted-foreground">
          <span>Prefijo del subdominio</span><span>Código</span><span>País</span><span />
        </div>
        {filas.length === 0 && (
          <p className="px-3 py-4 text-sm text-muted-foreground">
            Sin países: este campus no separa sus prospectos por país.
          </p>
        )}
        {filas.map((f, i) => (
          <div key={i} className="px-3 py-2 border-t border-border">
            <div className="grid grid-cols-[1fr_7rem_1fr_2.5rem] gap-2 items-center">
              <input
                value={f.prefijo}
                onChange={(e) => cambiar(i, 'prefijo', e.target.value)}
                placeholder="cl"
                aria-label="Prefijo del subdominio"
                disabled={!puede}
                className={inputClass}
              />
              <input
                value={f.codigo}
                onChange={(e) => cambiar(i, 'codigo', e.target.value)}
                placeholder="CL"
                aria-label="Código del país"
                disabled={!puede}
                className={inputClass}
              />
              <span className="text-sm truncate" title={f.prefijo ? `${f.prefijo}.dominio → ${nombreDelPais(f.codigo)}` : ''}>
                {CODIGO.test(f.codigo) ? nombreDelPais(f.codigo) : '—'}
              </span>
              <button
                type="button"
                onClick={() => quitar(i)}
                disabled={!puede}
                aria-label={`Quitar ${f.prefijo || 'fila'}`}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-muted text-muted-foreground disabled:opacity-50"
              >
                <Trash size={14} />
              </button>
            </div>
            {errores[i] && <p className="text-xs text-destructive mt-1">{errores[i]}</p>}
          </div>
        ))}
      </div>

      {puede && (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => anadir()}
            className="inline-flex items-center gap-1.5 h-8 px-3 rounded-md border border-border bg-card text-xs font-semibold hover:bg-muted"
          >
            <Plus size={12} weight="bold" /> Añadir país
          </button>
          {faltan.map((s) => (
            <button
              key={s.prefijo}
              type="button"
              onClick={() => anadir(s)}
              className="h-8 px-2.5 rounded-md border border-dashed border-border text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
              title={`${s.prefijo}. → ${nombreDelPais(s.codigo)}`}
            >
              + {nombreDelPais(s.codigo)}
            </button>
          ))}
        </div>
      )}

      <p className="text-xs text-muted-foreground">
        Afecta a los prospectos que entren desde que se guarda. Los que ya estaban se rellenan con
        el guion <code>rellenar-pais-origen.mjs</code> (lo pasa Diego). El código es el ISO de dos
        letras: MX, CO, CL, PE, AR, EC…
      </p>

      {puede ? (
        <div className="flex justify-end pt-2">
          <button
            onClick={guardar}
            disabled={saving || hayErrores}
            className="px-5 py-2.5 rounded-md bg-primary text-primary-foreground text-sm font-semibold hover:bg-primary/90 shadow disabled:opacity-50"
          >
            {saving ? 'Guardando...' : 'Guardar países'}
          </button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Para cambiar esta tabla hace falta el permiso «Configurar proyectos».</p>
      )}
    </div>
  );
}
