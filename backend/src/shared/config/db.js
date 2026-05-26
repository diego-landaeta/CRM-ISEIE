import pg from 'pg';
import { logger } from '../utils/logger.js';

const { Pool, types } = pg;

// IMPORTANTE: las columnas DATE (oid 1082) las devuelve pg por defecto como
// Date JS en UTC midnight, lo que hace que en front se vea como el día anterior
// para usuarios en zonas con offset negativo (ej. Venezuela GMT-4).
// Forzamos a devolverlas como string 'YYYY-MM-DD' para evitar timezone games.
types.setTypeParser(1082, (val) => val);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  logger.error({ err }, 'Unexpected error on idle client');
});

export const query = (text, params) => pool.query(text, params);

export const getClient = () => pool.connect();

export default pool;
