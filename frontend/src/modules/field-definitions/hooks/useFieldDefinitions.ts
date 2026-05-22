import { useEffect, useState, useCallback } from 'react';
import * as api from '../api/fields.api';
import type { FieldDefinition, FieldEntity } from '../api/fields.api';

export interface UseFieldDefinitionsResult {
  fields: FieldDefinition[];
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export default function useFieldDefinitions(
  projectId: number | null | undefined,
  entity?: FieldEntity,
): UseFieldDefinitionsResult {
  const [fields, setFields] = useState<FieldDefinition[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.listFields(projectId, entity);
      setFields(data);
    } catch (err: any) {
      setError(err?.message || 'Error cargando campos');
    } finally {
      setLoading(false);
    }
  }, [projectId, entity]);

  useEffect(() => { load(); }, [load]);

  return { fields, loading, error, refetch: load };
}
