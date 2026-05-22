// Copia robusta al portapapeles con fallback para HTTP (no-secure context).
// La Clipboard API solo funciona en HTTPS o localhost — en HTTP plano falla
// silenciosamente, por eso necesitamos el fallback con execCommand.
//
// Devuelve true si copió OK, false si todo falló.
export async function copyToClipboard(text: string): Promise<boolean> {
  if (text === undefined || text === null) return false;

  // 1. Intentar Clipboard API moderna
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(String(text));
      return true;
    } catch { /* fallback abajo */ }
  }

  // 2. Fallback: textarea + execCommand (deprecado pero universal)
  const ta = document.createElement('textarea');
  ta.value = String(text);
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.left = '0';
  ta.style.opacity = '0';
  ta.style.pointerEvents = 'none';
  ta.setAttribute('readonly', '');
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, ta.value.length);

  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}
