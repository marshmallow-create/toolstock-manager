import 'dotenv/config';
import { defineConfig } from 'prisma/config';
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations', seed: 'node scripts/run-typescript.mjs seed' },
  datasource: { url: process.env.DATABASE_URL ?? 'postgresql://localhost:5432/toolstock_dev' },
});

