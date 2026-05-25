// Genera un PDF de certificado de prueba con los datos del PDF de referencia
// (Iris Alvarez Curso de Ventas) para comparar visualmente con el original.
//
// Uso: node backend/scripts/test-cert-render.mjs
// Salida: backend/uploads/documents/test-cert-iris.pdf

import { generateCertificatePdf } from '../src/modules/documents/documents.service.js';

const data = {
  alumno_nombre: 'Iris Cristina Alvarez acosta',
  alumno_dni: 'N20137210',
  tipo_documento: 'PASAPORTE',
  fecha_nacimiento: '11 de octubre de 1989',
  nacionalidad: 'Mexicana',
  curso_nombre: 'Curso de Ventas',
  horas_total: '100',
  puntuacion: '95,40',
  fecha_aprobacion: '21 de mayo de 2026',
  fecha_expedicion: '21 de mayo de 2026',
  ciudad: 'Valencia',
  pais: 'España',
  director_nombre: 'Carlos Saiz',
  creditos_ects: 4,
  modulos: [
    'Fundamentos de las ventas y el comportamiento del consumidor',
    'Estrategias de ventas efectivas',
    'Marketing digital y ventas online',
    'Técnicas de negociación para vendedores',
    'Comunicación eficaz y escucha activa en ventas',
    'Gestión del tiempo y productividad para vendedores',
    'Desarrollo de marca personal para vendedores',
    'Seguimiento de clientes y fidelización en ventas',
    'Evaluación del desempeño de ventas y mejora continua',
    'Trabajo final de curso',
  ],
};

const filePath = await generateCertificatePdf(data, 'test-cert-iris.pdf');
console.log('PDF generado:', filePath);
