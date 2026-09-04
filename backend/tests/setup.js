// Variables de entorno para tests.
//
// `vitest.config.js` ya apuntaba aqui, pero el fichero no existia y no habia
// ninguna prueba, asi que `npm test` fallaba con «Failed to load url .../
// tests/setup.js» sin que nadie lo notara. Al portar el panel de claves (#113)
// hacia falta una prueba, y con ella esto.
//
// La base es la LOCAL del docker-compose del repositorio:
//
//   docker compose up -d
//   npm test
//
// El puerto de aqui es el del docker-compose (5432). Ojo: algun `.env` local
// apunta al 5433, asi que si no conecta es lo primero que hay que mirar. Quien
// necesite otra puede pasar DATABASE_URL por entorno.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret-key-for-vitest-2026';
process.env.JWT_REFRESH_SECRET = 'test-jwt-refresh-secret-key-for-vitest-2026';
process.env.DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://crm_iseie_user:crm_iseie_dev_pass@127.0.0.1:5432/crm_iseie';
process.env.PORT = '3099';
process.env.CORS_ORIGINS = 'http://localhost:5173';
process.env.LOG_LEVEL = 'silent';

// Sin esto, el modulo de credenciales se cae al importarse con «ENCRYPTION_KEY
// must be 64 hex chars». Es de pega y solo vale para tests: la de verdad vive
// en el .env del servidor.
process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0'.repeat(64);

// Los tests escriben en la base. Que DATABASE_URL apunte a un servidor de
// verdad tiene que fallar AQUI y no a mitad de una prueba, cuando ya ha
// insertado algo.
const donde = process.env.DATABASE_URL;
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(donde)) {
  throw new Error(
    `DATABASE_URL no apunta a la base local (${donde.replace(/:[^:@]*@/, ':***@')}). `
    + 'Los tests escriben en la base: usa la del docker-compose.'
  );
}
