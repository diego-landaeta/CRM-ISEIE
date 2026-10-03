import { diasHasta } from './fechas';

/*
  Qué filas entran en una lista de vencimientos, y en qué orden.

  Hay DOS preguntas distintas que se parecen mucho y ordenan al revés:

    «¿POR DÓNDE EMPIEZO?»  — lo más atrasado primero. Es «Siguientes acciones»
                             de Prospectos: un seguimiento con seis días de
                             retraso es lo primero que hay que hacer hoy.

    «¿QUÉ VIENE AHORA?»    — lo más cercano primero, y lo vencido aparte. Es
                             «Próximos cobros» de Clientes.

  Mezclarlas es lo que marcó Diego el 15/09: «"Próximos cobros" no sirve como
  está: dice "venció hace 285 días", que es mirar atrás. Tiene que decir cuándo
  va a vencer». Esa tarjeta ordenaba por atraso y se quedaba con cinco, así que
  cinco deudas viejas —de datos importados— tapaban siempre lo que venía. La
  tarjeta se llamaba «Próximos» y no enseñaba ni uno.

  Lo vencido no se esconde: se cuenta aparte y se puede mirar, pero deja de
  comerse la lista de lo que viene.
*/

export type Orden = 'urgencia' | 'proximidad' | 'vencidas';

export interface ConFecha {
  fecha?: string | null;
}

/** Las ventanas que se ofrecen como filtro. `null` es «no hay ventana». */
export const VENTANAS: Array<{ clave: string; texto: string; dias: number | null; orden: Orden }> = [
  { clave: 'manana', texto: 'Mañana', dias: 1, orden: 'proximidad' },
  { clave: 'semana', texto: '7 días', dias: 7, orden: 'proximidad' },
  { clave: 'mes', texto: '30 días', dias: 30, orden: 'proximidad' },
  { clave: 'vencidas', texto: 'Vencidas', dias: null, orden: 'vencidas' },
];

/**
 * Las filas que se pintan, y cuántas vencidas se han quedado fuera.
 *
 * `vencidasFuera` no es decoración: si hay 40 cuotas vencidas y la tarjeta
 * enseña lo que viene, callárselo convertiría una lista honesta en una lista
 * incompleta. Se dice el número y se deja ir a verlas.
 */
export function seleccionar<T extends ConFecha>(
  items: T[],
  { orden = 'urgencia', ventanaDias = 7, maximo = 5 }: {
    orden?: Orden; ventanaDias?: number | null; maximo?: number;
  } = {},
): { filas: T[]; vencidasFuera: number } {
  const conDias = (items || [])
    .map((it) => ({ it, dias: diasHasta(it.fecha) }))
    // Sin fecha no se puede decir cuándo vence, así que no entra. Contarla
    // como «hoy» pondría arriba lo que no sabemos.
    .filter((x): x is { it: T; dias: number } => x.dias !== null);

  const vencidas = conDias.filter((x) => x.dias < 0);

  if (orden === 'vencidas') {
    // Aquí sí manda el atraso: la más vieja primero, que es la que lleva más
    // tiempo sin reclamarse.
    return {
      filas: vencidas.sort((a, b) => a.dias - b.dias).slice(0, maximo).map((x) => x.it),
      vencidasFuera: Math.max(0, vencidas.length - maximo),
    };
  }

  if (orden === 'proximidad') {
    const proximos = conDias
      .filter((x) => x.dias >= 0 && (ventanaDias == null || x.dias <= ventanaDias))
      .sort((a, b) => a.dias - b.dias);
    return { filas: proximos.slice(0, maximo).map((x) => x.it), vencidasFuera: vencidas.length };
  }

  // 'urgencia': como estaba. Lo más atrasado primero, y lo vencido cuenta como
  // parte de la lista porque ES por dónde hay que empezar.
  const cola = conDias
    .sort((a, b) => a.dias - b.dias)
    .filter((x) => ventanaDias == null || x.dias <= ventanaDias);
  return { filas: cola.slice(0, maximo).map((x) => x.it), vencidasFuera: 0 };
}
