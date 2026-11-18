import { describe, it, expect } from 'vitest';
import {
  prefijoDeEntrada, deducirPais, normalizarMapa, leerFiltroPais, planearPaises,
  sqlPaisDelLead, sqlPaisDeLaVenta, SIN_PAIS,
} from '../src/modules/leads/pais.js';
import { urlDeLaPagina, deducirMapeo } from '../src/modules/make/make.campos-habituales.js';
import { paisesPorSubdominio, updateProjectSchema } from '../src/modules/projects/project.validation.js';
import { listLeadsSchema, webhookLeadSchema } from '../src/modules/leads/lead.validation.js';

/**
 * #221: el país de entrada de un prospecto, por el subdominio de su página.
 * Aquí la regla sola, sin base; el alta de punta a punta está en
 * paisAlEntrar221.test.js y los filtros en paisFiltros221.test.js.
 */

const FONO = { cl: 'CL', mx: 'MX', co: 'CO', pe: 'PE' };

describe('deducir el país de la dirección de entrada', () => {
  it('cl. → Chile y mx. → México', () => {
    expect(deducirPais('https://cl.fonoaprende.com/curso/disfagia/', FONO)).toBe('CL');
    expect(deducirPais('https://mx.fonoaprende.com/', FONO)).toBe('MX');
  });

  it('el dominio raíz no tiene país', () => {
    expect(deducirPais('https://fonoaprende.com/curso/', FONO)).toBeNull();
    expect(deducirPais('https://psikoaprende.com/', FONO)).toBeNull();
  });

  it('www. no cuenta: ni es un país ni tapa el que va detrás', () => {
    expect(deducirPais('https://www.fonoaprende.com/curso/', FONO)).toBeNull();
    expect(deducirPais('https://www.cl.fonoaprende.com/curso/', FONO)).toBe('CL');
    expect(deducirPais('https://www.fonoaprende.com/', { www: 'ES' })).toBeNull();
  });

  it('un prefijo que el campus no tiene configurado → nada (no se adivina)', () => {
    expect(deducirPais('https://ar.fonoaprende.com/', FONO)).toBeNull();
    expect(deducirPais('https://blog.fonoaprende.com/', FONO)).toBeNull();
  });

  it('un campus sin tabla → nada, aunque el subdominio parezca un país', () => {
    expect(deducirPais('https://cl.fonoaprende.com/', {})).toBeNull();
    expect(deducirPais('https://cl.fonoaprende.com/', null)).toBeNull();
  });

  it('sin dirección, o con algo que no es una dirección → nada', () => {
    expect(deducirPais(null, FONO)).toBeNull();
    expect(deducirPais('', FONO)).toBeNull();
    expect(deducirPais('no es una url', FONO)).toBeNull();
  });

  it('da igual mayúsculas, parámetros o que falte el https', () => {
    expect(deducirPais('HTTPS://CL.FonoAprende.com/Curso?utm_source=fb&fbclid=1', FONO)).toBe('CL');
    expect(deducirPais('cl.fonoaprende.com/curso', FONO)).toBe('CL');
  });

  it('una IP no es un subdominio', () => {
    expect(prefijoDeEntrada('http://10.0.0.1/x')).toBeNull();
  });

  it('añadir un país es solo configuración: una línea más en la tabla', () => {
    expect(deducirPais('https://ar.fonoaprende.com/', { ...FONO, ar: 'AR' })).toBe('AR');
  });
});

describe('la tabla del campus', () => {
  it('se limpia: prefijo en minúscula, código en mayúscula, fuera www y lo que no vale', () => {
    expect(normalizarMapa({ CL: 'cl', ' mx ': 'mx', www: 'ES', co: 'Colombia', '': 'PE', 'p e': 'PE' }))
      .toEqual({ cl: 'CL', mx: 'MX' });
    expect(normalizarMapa('{"pe":"PE"}')).toEqual({ pe: 'PE' });
    expect(normalizarMapa('roto')).toEqual({});
    expect(normalizarMapa([['cl', 'CL']])).toEqual({});
  });

  it('el esquema de Configuración la guarda limpia y rechaza lo que no vale', () => {
    expect(paisesPorSubdominio.parse({ CL: 'cl', mx: 'MX' })).toEqual({ cl: 'CL', mx: 'MX' });
    expect(paisesPorSubdominio.safeParse({ www: 'ES' }).success).toBe(false);
    expect(paisesPorSubdominio.safeParse({ cl: 'Chile' }).success).toBe(false);
    expect(paisesPorSubdominio.safeParse({ 'c l': 'CL' }).success).toBe(false);
    expect(updateProjectSchema.parse({ paises_por_subdominio: {} })).toEqual({ paises_por_subdominio: {} });
  });
});

describe('el filtro por país', () => {
  it('acepta un código o sin_pais; lo demás no', () => {
    expect(leerFiltroPais('cl')).toBe('CL');
    expect(leerFiltroPais('MX')).toBe('MX');
    expect(leerFiltroPais(SIN_PAIS)).toBe(SIN_PAIS);
    expect(leerFiltroPais('Chile')).toBeNull();
    expect(leerFiltroPais(undefined)).toBeNull();
  });

  it('el listado de prospectos lo valida (y uno raro es un 400, no un filtro ignorado)', () => {
    expect(listLeadsSchema.parse({ projectId: '1', paisEntrada: 'cl' }).paisEntrada).toBe('CL');
    expect(listLeadsSchema.safeParse({ projectId: '1', paisEntrada: 'Chile' }).success).toBe(false);
  });

  it('la expresión SQL usa sin_pais para los que no tienen, así el filtro es siempre «= $n»', () => {
    expect(sqlPaisDelLead('l')).toBe("COALESCE(l.pais_origen, 'sin_pais')");
    expect(sqlPaisDeLaVenta('c')).toContain('lpais.id = c.lead_id');
    expect(sqlPaisDeLaVenta('')).toContain('lpais.id = conversions.lead_id');
  });
});

describe('la página que manda Make (o Elementor)', () => {
  it('page_url, «Page URL», anidada un nivel o con los datos avanzados de Elementor', () => {
    expect(urlDeLaPagina({ email: 'a@example.com', page_url: 'https://cl.fonoaprende.com/x' })).toBe('https://cl.fonoaprende.com/x');
    expect(urlDeLaPagina({ 'Page URL': 'https://mx.fonoaprende.com/x' })).toBe('https://mx.fonoaprende.com/x');
    expect(urlDeLaPagina({ data: { pageUrl: 'https://pe.fonoaprende.com/x' } })).toBe('https://pe.fonoaprende.com/x');
    expect(urlDeLaPagina({ meta: { page_url: { title: 'Page URL', value: 'https://co.fonoaprende.com/x' } } }))
      .toBe('https://co.fonoaprende.com/x');
  });

  it('landing_url gana si trae valor; vacía, se usa la página', () => {
    expect(urlDeLaPagina({ landing_url: 'https://a.example.com/', page_url: 'https://b.example.com/' })).toBe('https://a.example.com/');
    expect(urlDeLaPagina({ landing_url: '', page_url: 'https://b.example.com/' })).toBe('https://b.example.com/');
  });

  it('un campo «url» o «page» que no es una dirección no cuenta', () => {
    expect(urlDeLaPagina({ page: 'Contacto', url: 'sin dirección' })).toBeNull();
    expect(urlDeLaPagina(null)).toBeNull();
  });

  it('el mapeo deducido también la reconoce con sus otros nombres', () => {
    expect(deducirMapeo({ email: 'a@example.com', 'URL de la página': 'https://cl.fonoaprende.com/' }).landing_url)
      .toBe('URL de la página');
  });

  it('el webhook del CRM acepta page_url (antes se descartaba al validar)', () => {
    const d = webhookLeadSchema.parse({ nombre: 'Ana', email: 'ana@example.com', page_url: 'https://cl.fonoaprende.com/' });
    expect(d.page_url).toBe('https://cl.fonoaprende.com/');
  });
});

describe('planear el relleno hacia atrás', () => {
  const mapas = { 1: FONO, 2: {} };
  it('rellena con la primera dirección que da país y cuenta el resto aparte', () => {
    const plan = planearPaises([
      { lead_id: 10, project_id: 1, pais_origen: null, urls: [{ url: 'https://cl.fonoaprende.com/', fuente: 'ficha' }] },
      { lead_id: 11, project_id: 1, pais_origen: null, urls: [{ url: 'https://fonoaprende.com/', fuente: 'ficha' }, { url: 'https://mx.fonoaprende.com/', fuente: 'make' }] },
      { lead_id: 12, project_id: 1, pais_origen: 'PE', urls: [{ url: 'https://cl.fonoaprende.com/', fuente: 'ficha' }] },
      { lead_id: 13, project_id: 1, pais_origen: null, urls: [] },
      { lead_id: 14, project_id: 2, pais_origen: null, urls: [{ url: 'https://cl.otra.com/', fuente: 'ficha' }] },
      { lead_id: 15, project_id: 1, pais_origen: null, urls: [{ url: 'https://fonoaprende.com/', fuente: 'ficha' }] },
    ], mapas);
    expect(plan.cambios).toEqual([
      { lead_id: 10, pais: 'CL', fuente: 'ficha', url: 'https://cl.fonoaprende.com/' },
      { lead_id: 11, pais: 'MX', fuente: 'make', url: 'https://mx.fonoaprende.com/' },
    ]);
    expect(plan).toMatchObject({ yaTenian: 1, sinUrl: 1, sinTabla: 1, sinPais: 1 });
  });
});
