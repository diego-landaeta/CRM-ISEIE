import crypto from 'crypto';

// Cifrado simetrico AES-256-GCM para credenciales API.
// Clave de 32 bytes (64 chars hex) en env var ENCRYPTION_KEY.
// Generar con: openssl rand -hex 32
const ALGORITHM = 'aes-256-gcm';

function getKey() {
  const keyHex = process.env.ENCRYPTION_KEY;
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
  }
  return Buffer.from(keyHex, 'hex');
}

export function encrypt(plaintext) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return {
    encrypted: encrypted.toString('hex'),
    iv: iv.toString('hex'),
    authTag: authTag.toString('hex'),
  };
}

export function decrypt(encryptedHex, ivHex, authTagHex) {
  const decipher = crypto.createDecipheriv(ALGORITHM, getKey(), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const decrypted = Buffer.concat([decipher.update(Buffer.from(encryptedHex, 'hex')), decipher.final()]);
  return decrypted.toString('utf8');
}

export function maskSecret(value) {
  if (!value || value.length < 8) return '........';
  return value.slice(0, 4) + '.'.repeat(Math.max(8, value.length - 8)) + value.slice(-4);
}
