import { useState, useEffect } from 'react';
import { MagnifyingGlass, User, CurrencyEur, X } from '@phosphor-icons/react';
import client from '@/shared/api/client';
import { useProjectContext } from '@/contexts/ProjectContext';
import { useIdsDelAmbito } from '@/shared/hooks/useAmbito';
import StatusBadge from '@/shared/components/ui/StatusBadge';

interface LeadOption {
  id: number;
  nombre: string;
  email: string;
  estado: string;
  producto_nombre: string | null;
  valor_estimado: number | null;
}

interface Props {
  open: boolean;
  onSelect: (lead: LeadOption) => void;
  onClose: () => void;
}

export default function LeadPicker({ open, onSelect, onClose }: Props) {
  const [search, setSearch] = useState('');
  const [leads, setLeads] = useState<LeadOption[]>([]);
  const [loading, setLoading] = useState(false);
  const { activeProject } = useProjectContext();
  // El campus de la cabecera o, con «Todos» o una empresa (-1), los de su
  // ámbito. Sin ninguno no se pregunta: el servidor lo rechaza con 400 (CRM#859;
  // antes mandaba `projectId=-1`, o nada).
  const idsDelAmbito = useIdsDelAmbito();
  const pid = activeProject?.id && activeProject.id > 0 ? activeProject.id : null;
  const ambito = pid ? `projectId=${pid}` : (idsDelAmbito.length ? `projectIds=${idsDelAmbito.join(',')}` : null);

  useEffect(() => {
    if (!open || !ambito) return;
    setSearch('');
    setLoading(true);
    client.get(`/leads?${ambito}&limit=20&sort=recent`)
      .then(r => { if (r.success) setLeads(r.data || []); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [open, ambito]);

  useEffect(() => {
    if (!open || !search || !ambito) return;
    const timeout = setTimeout(() => {
      // `search`, que es lo que entiende /leads; con `q` no filtraba nada.
      client.get(`/leads?${ambito}&search=${encodeURIComponent(search)}&limit=15`)
        .then(r => { if (r.success) setLeads(r.data || []); })
        .catch(() => {});
    }, 300);
    return () => clearTimeout(timeout);
  }, [search, open, ambito]);

  if (!open) return null;

  return (
    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-[400px] max-w-[calc(100vw-2rem)] bg-card border border-border rounded-xl shadow-xl z-50 max-h-80 flex flex-col">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
        <span className="text-sm font-semibold">Compartir prospecto</span>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted"><X size={16} /></button>
      </div>
      <div className="px-3 py-2">
        <div className="relative">
          <MagnifyingGlass size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            autoFocus
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nombre, email..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-muted/50 border-0 text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary/50"
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {loading && <p className="text-xs text-muted-foreground text-center py-4">Buscando...</p>}
        {!loading && leads.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Sin resultados</p>}
        {leads.map(l => (
          <button
            key={l.id}
            onClick={() => onSelect(l)}
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-muted/50 text-left transition-colors"
          >
            <div className="w-8 h-8 rounded-full bg-blue-500/10 flex items-center justify-center flex-shrink-0">
              <User size={16} weight="fill" className="text-blue-500" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium truncate">{l.nombre}</span>
                <StatusBadge status={l.estado} />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
                <span className="truncate">{l.email}</span>
                {l.producto_nombre && <span className="truncate">· {l.producto_nombre}</span>}
                {l.valor_estimado != null && l.valor_estimado > 0 && (
                  <span className="flex items-center gap-0.5"><CurrencyEur size={10} />{l.valor_estimado}</span>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
