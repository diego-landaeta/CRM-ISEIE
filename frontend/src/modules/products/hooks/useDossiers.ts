import { useState, useEffect, useCallback } from 'react';
import { getDossierHistory, uploadDossier, getDossierUrl, type Dossier } from '../api/dossiers.api';

export interface UseDossiersResult {
  history: Dossier[];
  activeDossier: Dossier | undefined;
  loading: boolean;
  uploading: boolean;
  uploadProgress: number;
  error: string | null;
  upload: (file: File) => Promise<Dossier>;
  download: (dossierId: number) => Promise<void>;
  refetch: () => Promise<void>;
}

export function useDossiers(
  productId: number | null | undefined,
  projectId: number | null | undefined,
): UseDossiersResult {
  const [history, setHistory] = useState<Dossier[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async (): Promise<void> => {
    if (!productId || !projectId) return;
    setLoading(true);
    try {
      const data = await getDossierHistory(productId, projectId);
      setHistory(data);
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al cargar historial');
    } finally {
      setLoading(false);
    }
  }, [productId, projectId]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  const upload = async (file: File): Promise<Dossier> => {
    if (!projectId || !productId) throw new Error('projectId y productId requeridos');
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const dossier = await uploadDossier(projectId, productId, file, (progressEvent) => {
        const total = progressEvent.total || 1;
        const percent = Math.round((progressEvent.loaded * 100) / total);
        setUploadProgress(percent);
      });
      await fetchHistory();
      return dossier;
    } catch (err: any) {
      setError(err.response?.data?.error || 'Error al subir archivo');
      throw err;
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const download = async (dossierId: number): Promise<void> => {
    if (!projectId) return;
    const { url } = await getDossierUrl(dossierId, projectId);
    window.open(url, '_blank');
  };

  const activeDossier = history.find((d) => d.active);

  return { history, activeDossier, loading, uploading, uploadProgress, error, upload, download, refetch: fetchHistory };
}
