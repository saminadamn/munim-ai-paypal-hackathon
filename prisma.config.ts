// Prisma 7 no longer reads .env files itself. Load .env.local (where Next.js keeps secrets) and
// then .env, so `npx prisma migrate dev` uses the same DATABASE_URL as the app.
import { config } from 'dotenv';
import { defineConfig } from 'prisma/config';

config({ path: '.env.local', quiet: true });
config({ quiet: true });

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: {
    // Migrations need a direct connection: Neon on Vercel sets DATABASE_URL_UNPOOLED next to the
    // pooled DATABASE_URL the app uses. A placeholder lets `prisma generate` run without a database.
    url: process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL || 'postgresql://localhost:5432/munim',
  },
});
