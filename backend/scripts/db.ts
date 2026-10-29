import 'dotenv/config';
import { migrate, reset, seed, verify } from '../src/db/runner.js';

const [command, target] = process.argv.slice(2);
const url = target === '--test' ? process.env.TEST_DATABASE_URL : process.env.DATABASE_URL;

if (!url) {
  console.error('Defina DATABASE_URL (o TEST_DATABASE_URL con --test) en .env');
  process.exit(1);
}

async function main() {
  switch (command) {
    case 'migrate':
      await migrate(url!);
      break;
    case 'seed':
      await seed(url!);
      break;
    case 'reset':
      if (process.env.NODE_ENV === 'production') throw new Error('db:reset está deshabilitado en producción');
      await reset(url!);
      await migrate(url!);
      await seed(url!);
      break;
    case 'verify':
      if (!(await verify(url!))) process.exitCode = 1;
      break;
    default:
      console.error('Uso: tsx scripts/db.ts <migrate|seed|reset|verify> [--test]');
      process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
