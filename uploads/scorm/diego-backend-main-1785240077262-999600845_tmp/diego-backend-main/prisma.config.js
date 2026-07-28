import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

export default defineConfig({
    schema: 'prisma/schema.prisma',
    migrations: {
        path: 'prisma/migrations',
    },
    datasource: {
        url: env('DATABASE_URL'),
    },
})