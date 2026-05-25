import client from '@/shared/api/client';

export interface Dossier {
  id: number;
  product_id: number;
  project_id?: number;
  // Backend devuelve filename_original (campo histórico); algunos endpoints
  // exponen también filename y size_bytes/subido_por_nombre como variantes
  filename?: string;
  filename_original?: string;
  file_size?: number;
  size_bytes?: number;
  url?: string;
  version?: number;
  active?: boolean;
  uploaded_by_nombre?: string;
  subido_por_nombre?: string;
  created_at: string;
}

export interface DossierUploadProgress {
  loaded: number;
  total?: number;
  percent?: number;
}

export type ProgressCallback = (event: { loaded: number; total?: number }) => void;

export async function uploadDossier(
  projectId: number,
  productId: number,
  file: File,
  onProgress?: ProgressCallback,
): Promise<Dossier> {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('productId', String(productId));

  const { data } = await client.post('/dossiers/upload', formData, {
    params: { projectId },
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: onProgress,
  });
  return data.data;
}

export async function getDossierUrl(id: number, projectId: number): Promise<{ url: string; expiresAt?: string }> {
  const { data } = await client.get(`/dossiers/${id}/url`, { params: { projectId } });
  return data.data;
}

export async function getDossierHistory(productId: number, projectId: number): Promise<Dossier[]> {
  const { data } = await client.get(`/dossiers/product/${productId}/history`, { params: { projectId } });
  return data.data;
}
