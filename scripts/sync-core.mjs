// Copie shared/recipe-core.js vers l'extension et la fonction Supabase.
import { copyFileSync } from 'node:fs';
const src = new URL('../shared/recipe-core.js', import.meta.url);
for (const dst of ['../extension/recipe-core.js', '../supabase/functions/import-recipe/recipe-core.js']) {
  copyFileSync(src, new URL(dst, import.meta.url));
  console.log('→', dst.replace('../', ''));
}
