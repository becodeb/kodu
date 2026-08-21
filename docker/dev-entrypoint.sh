#!/bin/sh
# Arranque del contenedor de desarrollo: prepara Prisma y levanta Astro con hot reload.
set -e

echo "> Generando Prisma Client..."
npx prisma generate

if [ -d "prisma/migrations" ] && [ -n "$(ls -A prisma/migrations 2>/dev/null)" ]; then
  echo "> Aplicando migraciones..."
  npx prisma migrate deploy
else
  echo "> Sin migraciones todavia: sincronizando el schema con db push..."
  npx prisma db push --skip-generate
fi

echo "> Astro dev en http://localhost:3000"
# --ignore-lock: adentro del contenedor hay un solo dev server, y el lock que
# Astro 7 deja en .astro/dev.json vive en el bind mount: si el contenedor se
# reinicia, el lock viejo lo haria crashear en loop.
exec npm run dev -- --ignore-lock
