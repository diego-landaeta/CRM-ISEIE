// Conversión de color para CRM-191 (branding por proyecto).
// Las CSS vars `--primary` / `--ring` se declaran como triplete HSL
// space-separated (ej. "230 75% 55%") en index.css. Convertimos hex
// configurado por el admin a esa forma para inyectarlo en runtime.

/**
 * Convierte un hex de 6 dígitos (#rrggbb) al triplete HSL que usa
 * Tailwind/shadcn: "H S% L%". Devuelve null si el input no es válido.
 */
export function hexToHslTriplet(hex: string | null | undefined): string | null {
  if (!hex) return null;
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const r = parseInt(m[1].slice(0, 2), 16) / 255;
  const g = parseInt(m[1].slice(2, 4), 16) / 255;
  const b = parseInt(m[1].slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d) + (g < b ? 6 : 0); break;
      case g: h = ((b - r) / d) + 2; break;
      case b: h = ((r - g) / d) + 4; break;
    }
    h /= 6;
  }
  const H = Math.round(h * 360);
  const S = Math.round(s * 100);
  const L = Math.round(l * 100);
  return `${H} ${S}% ${L}%`;
}

/**
 * Verifica si un string ya viene en formato hex (#rrggbb). Útil para
 * validaciones rápidas en UI antes de enviar al backend.
 */
export function isValidHexColor(value: string | null | undefined): boolean {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

/**
 * Toma un triplete HSL "H S% L%" y devuelve una variante adaptada al modo
 * oscuro: si la luminosidad original es muy baja (color corporativo navy
 * tipo `#002776`), la sube hasta un mínimo legible sobre fondos dark.
 *
 * Sin esto, el `--primary` se aplicaría como navy oscuro y los textos
 * `text-primary` sobre `bg-primary/10` quedan ilegibles en dark mode.
 */
export function adaptHslForDarkMode(triplet: string | null): string | null {
  if (!triplet) return null;
  const m = /^(\d+)\s+(\d+)%\s+(\d+)%$/.exec(triplet);
  if (!m) return triplet;
  const h = parseInt(m[1], 10);
  const s = parseInt(m[2], 10);
  const l = parseInt(m[3], 10);
  // Si la luminosidad es <= 45% (color oscuro), la subimos a una variante
  // legible sobre dark mode sin quemar (azul corporativo conserva carácter).
  if (l <= 45) {
    return `${h} ${Math.min(s, 80)}% 58%`;
  }
  return triplet;
}
