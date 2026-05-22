// Mime helpers para subidas/descargas de imágenes (avatares, logos).
// Coordinado con el set de mimes que valida `uploadImage` en `middleware/upload.js`.

export function mimeToExt(mime) {
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/webp') return 'webp';
  return 'jpg';
}

export function extToMime(ext) {
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  return 'image/jpeg';
}
