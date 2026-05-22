#!/usr/bin/env node
// Crea el primer superadmin del CRM-ISEIE.
//
// Uso:
//   node scripts/create-superadmin.js --email tu@email.com --nombre "Tu Nombre" --password "PASSWORD"
//
// O interactivo (sin --password):
//   node scripts/create-superadmin.js --email tu@email.com --nombre "Tu Nombre"
//   → te pide la contraseña por stdin sin echo.
//
// Requisitos: 001_initial_schema.sql ya aplicada y DATABASE_URL en .env.

import 'dotenv/config';
import bcrypt from 'bcrypt';
import readline from 'node:readline';
import { Writable } from 'node:stream';
import pg from 'pg';

const BCRYPT_ROUNDS = 12;

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i++) {
    const flag = argv[i];
    if (flag.startsWith('--')) {
      const key = flag.slice(2);
      out[key] = argv[i + 1];
      i++;
    }
  }
  return out;
}

async function promptHidden(prompt) {
  return new Promise((resolve) => {
    const mutableStdout = new Writable({
      write(chunk, _enc, cb) {
        if (!this.muted) process.stdout.write(chunk);
        cb();
      },
    });
    mutableStdout.muted = false;
    const rl = readline.createInterface({ input: process.stdin, output: mutableStdout, terminal: true });
    rl.question(prompt, (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
    mutableStdout.muted = true;
  });
}

function validatePassword(pw) {
  if (pw.length < 8) return 'mínimo 8 caracteres';
  if (!/[A-Z]/.test(pw)) return 'al menos una mayúscula';
  if (!/[0-9]/.test(pw)) return 'al menos un número';
  return null;
}

async function main() {
  const args = parseArgs(process.argv);
  const email = args.email?.toLowerCase().trim();
  const nombre = args.nombre?.trim();
  let password = args.password;

  if (!email || !nombre) {
    console.error('Faltan --email y/o --nombre');
    console.error('Uso: node scripts/create-superadmin.js --email X --nombre Y [--password Z]');
    process.exit(2);
  }
  if (!/^[^@]+@[^@]+\.[^@]+$/.test(email)) {
    console.error('Email con formato inválido');
    process.exit(2);
  }

  if (!password) {
    password = await promptHidden('Contraseña: ');
    const confirm = await promptHidden('Confirmar: ');
    if (password !== confirm) {
      console.error('Las contraseñas no coinciden');
      process.exit(2);
    }
  }

  const pwError = validatePassword(password);
  if (pwError) {
    console.error(`Contraseña inválida: ${pwError}`);
    process.exit(2);
  }

  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL no definida en .env');
    process.exit(2);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  try {
    const existing = await pool.query('SELECT id, role FROM users WHERE email = $1', [email]);
    if (existing.rows[0]) {
      console.error(`Ya existe un usuario con email ${email} (id=${existing.rows[0].id}, role=${existing.rows[0].role})`);
      process.exit(1);
    }

    const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

    const { rows } = await pool.query(
      `INSERT INTO users (nombre, email, password_hash, role, active)
       VALUES ($1, $2, $3, 'superadmin', true)
       RETURNING id, nombre, email, role, created_at`,
      [nombre, email, passwordHash]
    );

    console.log('Superadmin creado:');
    console.log(JSON.stringify(rows[0], null, 2));
  } catch (err) {
    console.error('Error:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
