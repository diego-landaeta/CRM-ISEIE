import { useState } from 'react';
import { X, Plus } from '@phosphor-icons/react';
import PromptDialog from '@/shared/components/ui/PromptDialog';
import type { WebhookDestination, WebhookFieldMapping, WebhookTarget } from '../lib/types';

const TARGETS_BY_DEST: Record<WebhookDestination, WebhookTarget[]> = {
  lead: [
    { key: 'nombre', label: 'Nombre', required: true },
    { key: 'email', label: 'Email', required: true },
    { key: 'telefono', label: 'Teléfono' },
    { key: 'pais', label: 'País' },
    { key: 'notas', label: 'Notas' },
    { key: 'producto_interes_id', label: 'Producto interés (id)' },
    { key: 'utm_source', label: 'UTM source' },
    { key: 'utm_campaign', label: 'UTM campaign' },
  ],
  matricula: [
    { key: 'dni', label: 'DNI / Identificación', required: true },
    { key: 'titulo', label: 'Título / Programa' },
    { key: 'email', label: 'Email' },
    { key: 'notas', label: 'Notas' },
  ],
};

const MAX_DEPTH = 6;
const MAX_OBJECT_KEYS = 50;
const MAX_ARRAY_ITEMS = 5;

// Devuelve los paths como array para cualquier formato del mapping
function pathsOf(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  if (value && typeof value === 'object' && Array.isArray((value as any).sources)) {
    return (value as any).sources.filter((v: any): v is string => typeof v === 'string');
  }
  return [];
}

// Busca a qué target del CRM se mapeó un path dado (puede estar en string o array)
function findTargetUsing(path: string, mapping: WebhookFieldMapping): string | null {
  for (const [target, value] of Object.entries(mapping)) {
    if (pathsOf(value).includes(path)) return target;
  }
  return null;
}

interface PayloadTreeProps {
  obj: unknown;
  path?: string;
  onSelect: (path: string) => void;
  mapping?: WebhookFieldMapping;
  depth?: number;
}

function PayloadTree({ obj, path = '', onSelect, mapping, depth = 0 }: PayloadTreeProps) {
  if (obj === null || obj === undefined) return <span className="text-muted-foreground italic">null</span>;
  if (typeof obj !== 'object') {
    const usedAs = mapping ? findTargetUsing(path, mapping) : null;
    return (
      <button
        type="button"
        onClick={() => onSelect(path)}
        className={`text-left px-1.5 py-0.5 rounded text-[11px] font-mono hover:bg-primary/10 ${usedAs ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300' : ''}`}
        title={usedAs ? `Mapeado a: ${usedAs}` : 'Click para mapear'}
      >
        {String(obj).slice(0, 80)}{usedAs && ` ← ${usedAs}`}
      </button>
    );
  }
  if (depth >= MAX_DEPTH) {
    return <span className="text-[10px] text-muted-foreground italic">… (profundidad máx)</span>;
  }
  if (Array.isArray(obj)) {
    return (
      <ul className="ml-3 space-y-0.5">
        {obj.slice(0, MAX_ARRAY_ITEMS).map((v, i) => (
          <li key={i} className="text-[11px]">
            <span className="text-muted-foreground">[{i}]:</span>{' '}
            <PayloadTree obj={v} path={`${path}.${i}`.replace(/^\./, '')} onSelect={onSelect} mapping={mapping} depth={depth + 1} />
          </li>
        ))}
        {obj.length > MAX_ARRAY_ITEMS && <li className="text-[10px] text-muted-foreground italic">... +{obj.length - MAX_ARRAY_ITEMS} más</li>}
      </ul>
    );
  }
  const entries = Object.entries(obj);
  const visible = entries.slice(0, MAX_OBJECT_KEYS);
  return (
    <ul className="space-y-0.5">
      {visible.map(([k, v]) => {
        const childPath = path ? `${path}.${k}` : k;
        return (
          <li key={k} className="text-[11px]">
            <span className="font-bold text-foreground">{k}:</span>{' '}
            <PayloadTree obj={v} path={childPath} onSelect={onSelect} mapping={mapping} depth={depth + 1} />
          </li>
        );
      })}
      {entries.length > MAX_OBJECT_KEYS && (
        <li className="text-[10px] text-muted-foreground italic">... +{entries.length - MAX_OBJECT_KEYS} keys más</li>
      )}
    </ul>
  );
}

interface PayloadMapperProps {
  payload: unknown;
  mapping: WebhookFieldMapping;
  destination?: WebhookDestination;
  onChange: (next: WebhookFieldMapping) => void;
}

export default function PayloadMapper({ payload, mapping, destination = 'lead', onChange }: PayloadMapperProps) {
  const targets = TARGETS_BY_DEST[destination] || TARGETS_BY_DEST.lead;
  const [mapPath, setMapPath] = useState<string | null>(null);

  // Añade un path al target. Si ya tenía un path, convierte a array y suma.
  function addPathToTarget(target: string, path: string): void {
    const existing = mapping[target];
    const existingPaths = pathsOf(existing);

    if (existingPaths.includes(path)) {
      // Ya estaba, no duplicar
      return;
    }

    const newPaths = [...existingPaths, path];
    const next = { ...mapping };
    if (newPaths.length === 1) {
      next[target] = newPaths[0];           // string simple
    } else {
      next[target] = newPaths as any;       // array → backend lo concatena con espacio
    }
    onChange(next);
  }

  // Quita un path concreto del target (no todo el target)
  function removePath(target: string, path: string): void {
    const existingPaths = pathsOf(mapping[target]);
    const remaining = existingPaths.filter(p => p !== path);
    const next = { ...mapping };
    if (remaining.length === 0) {
      delete next[target];
    } else if (remaining.length === 1) {
      next[target] = remaining[0];
    } else {
      next[target] = remaining as any;
    }
    onChange(next);
  }

  // Quita todo el target
  function clearTarget(target: string): void {
    const next = { ...mapping };
    delete next[target];
    onChange(next);
  }

  return (
    <div>
      <p className="text-[11px] font-bold uppercase text-muted-foreground mb-2">
        Payload capturado · click en un valor para mapearlo
      </p>
      <p className="text-[10px] text-muted-foreground mb-2 italic">
        💡 Tip: si necesitas <strong>concatenar</strong> dos campos (ej: Prefijo país + Teléfono) → click en ambos valores y asígnalos al mismo destino.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <div className="border border-border rounded-xl p-3 bg-muted/10 max-h-72 overflow-y-auto">
          <PayloadTree obj={payload} mapping={mapping} onSelect={setMapPath} />
        </div>
        <div className="border border-border rounded-xl p-3 space-y-2">
          <p className="text-[11px] font-bold uppercase text-muted-foreground">
            Mapping → {destination === 'matricula' ? 'Solicitud de admisión' : 'Lead'}
          </p>
          {targets.map((t) => {
            const paths = pathsOf(mapping[t.key]);
            return (
              <div key={t.key} className="flex items-start gap-2 text-xs py-1">
                <span className="w-32 font-bold pt-1 flex-shrink-0">
                  {t.label}{t.required && <span className="text-red-500"> *</span>}
                </span>
                <div className="flex-1 flex flex-wrap gap-1 items-center">
                  {paths.length === 0 && (
                    <span className="text-muted-foreground italic">(sin mapear)</span>
                  )}
                  {paths.map((p) => (
                    <span key={p} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/10 text-primary text-[10px] font-mono">
                      {p}
                      <button
                        onClick={() => removePath(t.key, p)}
                        className="hover:text-red-500"
                        aria-label={`Quitar ${p}`}
                        title="Quitar este path"
                      >
                        <X size={10} weight="bold" />
                      </button>
                    </span>
                  ))}
                  {paths.length > 1 && (
                    <span className="text-[10px] text-emerald-600 ml-1" title="Los valores se concatenarán con un espacio">
                      → concatenado
                    </span>
                  )}
                </div>
                {paths.length > 0 && (
                  <button onClick={() => clearTarget(t.key)} className="text-red-500 mt-1" aria-label={`Limpiar ${t.label}`} title="Limpiar todo este campo">
                    <X size={12} weight="bold" />
                  </button>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <PromptDialog
        open={!!mapPath}
        title="Asignar a campo del CRM"
        message={mapPath ? (
          <>
            Selecciona a qué campo del CRM va <code className="font-mono text-foreground">{mapPath}</code>.
            <br />
            <span className="text-[11px] text-muted-foreground">
              Si ya hay un valor en ese campo, este se <strong>añade</strong> y se concatenarán.
            </span>
          </>
        ) : null}
        options={targets.map(t => {
          const existingCount = pathsOf(mapping[t.key]).length;
          const suffix = existingCount > 0 ? ` (${existingCount} ya asignado${existingCount > 1 ? 's' : ''})` : '';
          return { value: t.key, label: t.label + (t.required ? ' *' : '') + suffix };
        })}
        confirmLabel="Asignar"
        onConfirm={(target: string) => {
          if (target && mapPath && targets.find((t) => t.key === target)) addPathToTarget(target, mapPath);
          setMapPath(null);
        }}
        onCancel={() => setMapPath(null)}
      />
    </div>
  );
}
