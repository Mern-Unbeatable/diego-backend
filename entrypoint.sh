#!/bin/sh

# Exit immediately if a command exits with a non-zero status
set -e

echo "🚀 Starting entrypoint script..."

# Generate Prisma client (if not already generated in build stage or if needed for specific environment)
# npx prisma generate

echo "🔄 Running database migrations..."
npx prisma migrate deploy

echo "🌱 Seeding the database..."
# Run the seed script. We use ts-node because seeds are in TS and might not be fully bundled in the same way.
# Alternatively, if seeds are compiled, we point to the JS version.
npm run seeds:prod

echo "🏁 Starting the application..."
# Start the application
exec node ./build/src/bootstrap.js
