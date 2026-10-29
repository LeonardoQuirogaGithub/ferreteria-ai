import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

// src/db → backend/ al ejecutar con tsx; dist/src/db → backend/ una vez compilado.
const here = path.dirname(fileURLToPath(import.meta.url));
const root = [path.resolve(here, '..', '..'), path.resolve(here, '..', '..', '..')].find((d) => fs.existsSync(path.join(d, 'migrations')))!;
export const MIGRATIONS_DIR = path.join(root, 'migrations');
export const SEEDS_DIR = path.join(root, 'seeds');

function sqlFiles(dir: string): string[] {
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Aplica cada archivo pendiente en su propia transacción y lo registra en `tabla`. */
async function applyDir(client: pg.Client, dir: string, tabla: string, log: (m: string) => void) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${tabla} (nombre VARCHAR(200) PRIMARY KEY, aplicado_en TIMESTAMPTZ NOT NULL DEFAULT now())`,
  );
  const done = new Set((await client.query<{ nombre: string }>(`SELECT nombre FROM ${tabla}`)).rows.map((r) => r.nombre));
  let aplicados = 0;
  for (const file of sqlFiles(dir)) {
    if (done.has(file)) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query(`INSERT INTO ${tabla}(nombre) VALUES ($1)`, [file]);
      await client.query('COMMIT');
      aplicados++;
      log(`  ✔ ${file}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(`Falló ${file}: ${(error as Error).message}`);
    }
  }
  if (aplicados === 0) log('  (sin cambios pendientes)');
}

export async function migrate(url: string, log: (m: string) => void = console.log) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    log('Migraciones:');
    await applyDir(client, MIGRATIONS_DIR, 'schema_migrations', log);
  } finally {
    await client.end();
  }
}

export async function seed(url: string, log: (m: string) => void = console.log) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    log('Seeds:');
    await applyDir(client, SEEDS_DIR, 'schema_seeds', log);
  } finally {
    await client.end();
  }
}

/** Borra el esquema public completo. Solo para desarrollo y pruebas. */
export async function reset(url: string, log: (m: string) => void = console.log) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    log('Esquema public recreado.');
  } finally {
    await client.end();
  }
}

export async function verify(url: string, log: (m: string) => void = console.log) {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    const kardex = await client.query('SELECT * FROM fn_verificar_kardex()');
    const lotes = await client.query('SELECT * FROM fn_verificar_lotes()');
    log(`Diferencias kardex/existencia: ${kardex.rowCount}`);
    log(`Diferencias lotes/existencia: ${lotes.rowCount}`);
    return (kardex.rowCount ?? 0) + (lotes.rowCount ?? 0) === 0;
  } finally {
    await client.end();
  }
}
