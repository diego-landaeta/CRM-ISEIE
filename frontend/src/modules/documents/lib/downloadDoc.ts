import { getAccessToken } from '@/shared/api/client';

interface DocLike {
  id: number;
  number: string;
}

/**
 * Trigger a browser download for a generated document. Uses raw fetch (not the
 * client.js wrapper because the response is binary, not JSON).
 *
 * Returns true if the download was initiated, false on auth/network error.
 */
export async function downloadDoc(doc: DocLike, projectId: number): Promise<boolean> {
  if (!doc?.id || !projectId) return false;
  const baseUrl = (import.meta.env.BASE_URL || '/crm/').replace(/\/$/, '');
  const token = getAccessToken() || '';
  try {
    const res = await fetch(`${baseUrl}/api/documents/${doc.id}/download?projectId=${projectId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return false;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${doc.number || `documento-${doc.id}`}.pdf`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Revoke after a tick to give the click time to register
    setTimeout(() => URL.revokeObjectURL(url), 100);
    return true;
  } catch {
    return false;
  }
}
