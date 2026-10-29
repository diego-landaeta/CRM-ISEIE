import { describe, it, expect, vi } from 'vitest';

// El mensaje del widget de WhatsApp lo manda la persona que entra en la web, y
// {{nombre}} es la gestora de la burbuja. El texto por defecto decía «Hola, soy
// {{nombre}} de {{project}}», así que la persona se presentaba con el nombre de
// la gestora: «Hola, soy Ana de ISEF» (Diego, 29/10: «está mal»).

vi.mock('../src/shared/config/db.js', () => ({
  getClient: vi.fn(),
  // Un campus sin texto propio: sale el de por defecto.
  query: vi.fn(async () => ({ rows: [{ project_nombre: 'ISEF', project_slug: 'isef' }], rowCount: 1 })),
}));

const { getConfig } = await import('../src/modules/widget/widget.model.js');

describe('mensaje por defecto del widget', () => {
  it('saluda a la gestora en vez de hacerse pasar por ella', async () => {
    const { message_template: t } = await getConfig(9);
    expect(t).not.toMatch(/soy\s*\{\{nombre\}\}/i);
    const enviado = t.replace('{{nombre}}', 'Ana').replace('{{project}}', 'ISEF').replace('{{url}}', 'https://isef.es/curso');
    expect(enviado).toBe('Hola Ana de ISEF. Quiero información sobre: https://isef.es/curso');
  });
});
