import { useEffect, useState } from 'react';
import client from '@/shared/api/client';
import type { Lead } from '@/shared/types';

// Las plantillas de WhatsApp, leídas de la base de datos.
//
// Antes vivían en el localStorage del navegador, y eso traía dos problemas:
// cada gestora tenía las suyas en su equipo —nadie podía revisarlas y si
// cambiaba de ordenador las perdía— y los dos CRMs las guardaban con formatos
// distintos que ni siquiera coincidían entre sí.
//
// Aquí solo se leen. Crear, cambiar y borrar vive en la pantalla de Plantillas,
// para que no haya dos sitios donde editar lo mismo.

export interface WhatsappTemplate {
  id: number | string;
  label: string;
  text: string;
  ambito?: 'compartida' | 'personal';
}

interface FilaApi {
  id: number;
  label: string;
  body: string;
  ambito: 'compartida' | 'personal';
}

export function useWhatsappTemplates(projectId: number | string | null | undefined) {
  const [templates, setTemplates] = useState<WhatsappTemplate[]>([]);

  useEffect(() => {
    // -1 es «Todos los proyectos» del selector: no hay plantillas que traer.
    const pid = Number(projectId);
    if (!pid || pid === -1) { setTemplates([]); return undefined; }

    let vivo = true;
    client.get(`/whatsapp/templates?projectId=${pid}`)
      .then((r) => {
        if (!vivo) return;
        const filas = (r.success ? (r.data as FilaApi[] | undefined) : undefined) || [];
        // El campo se llama `body` en la base y `text` en las pantallas viejas.
        setTemplates(filas.map((t) => ({ id: t.id, label: t.label, text: t.body, ambito: t.ambito })));
      })
      .catch(() => { if (vivo) setTemplates([]); });
    return () => { vivo = false; };
  }, [projectId]);

  return { templates };
}

/** Subset de Lead que fillTemplate consume (laxo para aceptar tipos parciales). */
export type FillTemplateLead = Pick<Partial<Lead>, 'nombre' | 'producto_nombre' | 'producto_interes' | 'email' | 'telefono'>;

/** Reemplaza variables en el template con los datos del lead. */
export function fillTemplate(text: string, { lead, projectName }: { lead?: FillTemplateLead | null; projectName?: string }): string {
  return text
    .replace(/\{nombre\}/gi, lead?.nombre?.split(' ')[0] || lead?.nombre || '')
    .replace(/\{nombreCompleto\}/gi, lead?.nombre || '')
    .replace(/\{producto\}/gi, lead?.producto_nombre || lead?.producto_interes || 'nuestros servicios')
    .replace(/\{proyecto\}/gi, projectName || '')
    .replace(/\{email\}/gi, lead?.email || '')
    .replace(/\{telefono\}/gi, lead?.telefono || '');
}
