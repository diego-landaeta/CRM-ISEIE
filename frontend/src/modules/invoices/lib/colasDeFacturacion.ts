// Qué colas de facturación se pintan en Finanzas › Facturas.
//
// La cola es de UN campus (`/invoices/facturacion-al-dia?projectId=`). Con un
// campus arriba, la suya. Con una empresa elegida, una por cada campus de la
// empresa (21/10). Y con «Todos los proyectos» (-1)... ninguna: la tarjeta
// recibía `projectId={null}` y no pedía nada.
//
// 25/11, Ana (gestora con «Emitir desde la cola»): el 23/11 facturaba con un
// campus elegido; hoy entró con «Todos», cobró la cuota de la venta 540 y en
// Facturas no había cola donde emitirla. El cobro 1008 estaba en la cola de
// Psiko, pero no se veía en ninguna parte. Con «Todos», una cola por campus
// suyo, y solo las que tienen algo por facturar.

export type CampusDeCola = { id: number; nombre: string };

export function colasQueSeVen({
  pid, porSociedad, sociedadProjects, filterProject, projects,
}: {
  pid: number | null | undefined;
  porSociedad: boolean;
  sociedadProjects: CampusDeCola[];
  filterProject: string;
  projects: CampusDeCola[] | null | undefined;
}): { campus: CampusDeCola[]; varias: boolean } | null {
  if (porSociedad) {
    const campus = filterProject ? sociedadProjects.filter((p) => String(p.id) === filterProject) : sociedadProjects;
    return { campus, varias: !filterProject && sociedadProjects.length > 1 };
  }
  if (pid === -1) {
    const campus = (projects || []).filter((p) => Number(p.id) > 0);
    return { campus, varias: campus.length > 1 };
  }
  return null;
}
