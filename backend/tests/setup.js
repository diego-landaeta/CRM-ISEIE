// Variables de entorno para tests.
//
// Antes esto abria un tunel SSH contra la base de staging del servidor de
// produccion, con la contraseña escrita aqui dentro. Eso significaba tres cosas
// malas: hacia falta acceso al servidor solo para lanzar tests, dos personas
// ejecutandolos a la vez se pisaban los datos, y una credencial real vivia en
// el repositorio.
//
// Ahora apunta a la base LOCAL desechable:
//
//   docker compose -f docker-compose.dev.yml up -d
//   npm run db:preparar -- --datos
//   npm test
//
// Quien necesite otra puede pasar DATABASE_URL por entorno.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-vitest-2026';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-vitest-2026';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://crm_user:crm_local@127.0.0.1:15432/crm_dev';
process.env.PORT = '3099';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';
// Las credenciales de las APIs externas se guardan cifradas, y sin esta clave
// el modulo entero se cae con «ENCRYPTION_KEY must be 64 hex chars». Es de
// pega y solo vale para tests: la de verdad vive en el .env del servidor.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY
  || '0'.repeat(64);

// Aviso temprano y claro. Sin esto, los 8 ficheros que necesitan base fallan con
// un ECONNREFUSED suelto que no le dice a nadie que le falta levantar el
// contenedor.
if (/187\.124\.128\.126|72\.60\.90\.135/.test(process.env.DATABASE_URL)) {
  throw new Error(
    'DATABASE_URL apunta a un servidor real. Los tests escriben en la base: usa la local.'
  );
}
