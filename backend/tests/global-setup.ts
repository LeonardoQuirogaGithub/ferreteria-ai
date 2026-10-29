import 'dotenv/config';
import { migrate, reset, seed } from '../src/db/runner.js';

/** Recrea la base de pruebas desde cero: valida además que las migraciones sean repetibles (RNF-FLE-001). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Defina TEST_DATABASE_URL en .env para ejecutar las pruebas');
  if (url === process.env.DATABASE_URL) throw new Error('TEST_DATABASE_URL debe ser distinta de DATABASE_URL');
  const quiet = () => undefined;
  await reset(url, quiet);
  await migrate(url, quiet);
  await seed(url, quiet);
}
