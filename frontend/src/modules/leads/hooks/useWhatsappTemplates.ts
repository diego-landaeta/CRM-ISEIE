// Stub del modulo plantillas WhatsApp. Devuelve la API que consume LeadsPage
// ({templates, save, reset}) como no-ops para que el destructuring no rompa.
// fillTemplate sí lo usa QuickActions.tsx en producción.

export interface WhatsappTemplate {
  id: string | number;
  label: string;
  text: string;
}

export interface UseWhatsappTemplatesResult {
  templates: WhatsappTemplate[];
  save: (templates: WhatsappTemplate[]) => void;
  reset: () => void;
}

export function useWhatsappTemplates(_projectId?: number | null): UseWhatsappTemplatesResult {
  return {
    templates: [],
    save: () => { /* no-op */ },
    reset: () => { /* no-op */ },
  };
}

export function fillTemplate(template: string, _lead: unknown): string {
  return template;
}

export default useWhatsappTemplates;
