/**
 * OPTIONAL: seeds a small starter catalog of PUBLIC recipes, owned by an
 * editorial account, so that "Discover" and "Recipe of the day" are not empty
 * on a brand-new installation. The texts are original (written for Mestolo),
 * so they can be used freely by the operator.
 *
 * Usage (Node >= 22.6):
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run seed:catalog
 * Idempotent: recipes with the same title for the editorial account are skipped.
 */
import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const admin = createClient(url, key, { auth: { persistSession: false } });
const EMAIL = process.env.SEED_EDITORIAL_EMAIL ?? 'catalogo@mestolo.invalid';

type Ing = { name: string; quantity: number | null; unit: string | null; toTaste?: boolean; note?: string };
const i = (quantity: number | null, unit: string | null, name: string, extra: Partial<Ing> = {}): Ing => ({ name, quantity, unit, ...extra });
const qb = (name: string): Ing => ({ name, quantity: null, unit: null, toTaste: true });

const CATALOG: { title: string; category: string; description: string; servings: number; prep: number; cook: number; total: number; ingredients: Ing[]; steps: string[]; tags: string[] }[] = [
  {
    title: 'Pasta e fagioli alla buona',
    category: 'first-courses',
    description: 'Un piatto di casa, cremoso, che si fa con quello che c\'è in dispensa.',
    servings: 4, prep: 15, cook: 35, total: 50,
    ingredients: [i(250, 'g', 'pasta mista'), i(480, 'g', 'fagioli borlotti lessati', { note: 'due barattoli, sgocciolati' }), i(1, null, 'cipolla piccola'), i(1, null, 'carota'), i(1, null, 'costa di sedano'), i(2, 'tbsp', 'concentrato di pomodoro'), i(1.2, 'l', 'brodo vegetale'), i(3, 'tbsp', 'olio extravergine d\'oliva'), qb('sale'), qb('pepe nero')],
    steps: ['Trita cipolla, carota e sedano e falli appassire nell\'olio per 8-10 minuti a fuoco medio-basso.', 'Aggiungi il concentrato, mescola un minuto, poi unisci i fagioli e il brodo caldo. Cuoci 15 minuti.', 'Schiaccia con un cucchiaio circa un terzo dei fagioli per rendere il fondo cremoso.', 'Versa la pasta e cuocila nel brodo, mescolando spesso; aggiungi brodo se si asciuga troppo.', 'Regola di sale, completa con pepe e un filo d\'olio a crudo e lascia riposare due minuti.'],
    tags: ['dispensa', 'inverno'],
  },
  {
    title: 'Frittata di zucchine al forno',
    category: 'main-courses',
    description: 'Alta e morbida, senza girarla in padella.',
    servings: 4, prep: 15, cook: 25, total: 40,
    ingredients: [i(6, null, 'uova'), i(3, null, 'zucchine medie'), i(40, 'g', 'parmigiano grattugiato'), i(8, null, 'foglie di menta'), i(2, 'tbsp', 'olio extravergine d\'oliva'), qb('sale')],
    steps: ['Scalda il forno a 180 °C e ungi una teglia di circa 22 cm.', 'Taglia le zucchine a rondelle sottili e saltale in padella con l\'olio per 5 minuti, salando leggermente.', 'Sbatti le uova con parmigiano, menta spezzettata e un pizzico di sale; unisci le zucchine tiepide.', 'Versa nella teglia e cuoci 20-25 minuti, finché il centro non è più tremolante.'],
    tags: ['vegetariana', 'veloce'],
  },
  {
    title: 'Focaccia semplice in teglia',
    category: 'bread-baking',
    description: 'Impasto idratato, poco lievito e tempo: il resto lo fa il forno.',
    servings: 6, prep: 20, cook: 22, total: 300,
    ingredients: [i(500, 'g', 'farina tipo 0'), i(380, 'ml', 'acqua a temperatura ambiente'), i(4, 'g', 'lievito di birra secco'), i(10, 'g', 'sale fino'), i(40, 'ml', 'olio extravergine d\'oliva', { note: 'più quello per la teglia' }), qb('sale grosso')],
    steps: ['Sciogli il lievito in parte dell\'acqua, unisci la farina e il resto dell\'acqua e mescola fino a non vedere farina asciutta.', 'Dopo 20 minuti aggiungi il sale e 20 ml di olio e impasta con la mano bagnata finché l\'impasto è liscio.', 'Copri e lascia lievitare finché raddoppia (circa 2-3 ore a temperatura ambiente, dipende dalla stanza).', 'Stendi nella teglia unta allargando con i polpastrelli, lascia riposare 45 minuti.', 'Fai i buchi con le dita, condisci con olio, un po\' d\'acqua e sale grosso; cuoci a 230 °C per 20-22 minuti.'],
    tags: ['lievitati'],
  },
  {
    title: 'Crema di ceci e limone',
    category: 'sauces',
    description: 'Da spalmare sul pane o da accompagnare alle verdure crude.',
    servings: 6, prep: 10, cook: 0, total: 10,
    ingredients: [i(400, 'g', 'ceci lessati', { note: 'sgocciolati, tenendo un po\' di liquido' }), i(1, null, 'limone', { note: 'succo e scorza' }), i(2, 'tbsp', 'tahina'), i(1, 'clove', 'aglio', { note: 'facoltativo' }), i(3, 'tbsp', 'olio extravergine d\'oliva'), qb('sale'), qb('paprika dolce')],
    steps: ['Frulla ceci, tahina, succo di limone, aglio e sale.', 'Aggiungi a filo l\'olio e qualche cucchiaio del liquido dei ceci fino a ottenere una crema liscia.', 'Assaggia, regola di sale e limone, completa con scorza grattugiata e paprika.'],
    tags: ['vegana', 'senza cottura'],
  },
  {
    title: 'Torta di mele nell\'impasto',
    category: 'desserts',
    description: 'Le mele a pezzi dentro, una a fette sopra. Profuma la casa.',
    servings: 8, prep: 20, cook: 45, total: 65,
    ingredients: [i(3, null, 'uova'), i(150, 'g', 'zucchero'), i(100, 'ml', 'olio di semi'), i(120, 'ml', 'latte'), i(250, 'g', 'farina 00'), i(16, 'g', 'lievito per dolci'), i(3, null, 'mele'), i(1, null, 'limone', { note: 'scorza grattugiata' }), i(1, 'pinch', 'sale')],
    steps: ['Scalda il forno a 175 °C e fodera uno stampo da 24 cm.', 'Monta uova e zucchero finché sono chiari, poi unisci olio, latte e scorza di limone.', 'Aggiungi farina, lievito e sale setacciati, mescolando dal basso verso l\'alto.', 'Unisci due mele a cubetti, versa nello stampo e copri con la terza mela a fettine.', 'Cuoci 40-45 minuti; fai la prova stecchino prima di sfornare.'],
    tags: ['merenda'],
  },
  {
    title: 'Insalata di farro, pomodori e basilico',
    category: 'sides',
    description: 'Fresca, si prepara prima e si porta anche fuori casa.',
    servings: 4, prep: 15, cook: 25, total: 40,
    ingredients: [i(250, 'g', 'farro perlato'), i(300, 'g', 'pomodorini'), i(1, null, 'cetriolo'), i(10, null, 'olive taggiasche'), i(1, 'bunch', 'basilico'), i(4, 'tbsp', 'olio extravergine d\'oliva'), qb('sale')],
    steps: ['Lessa il farro in acqua salata per il tempo indicato sulla confezione, scolalo e raffreddalo sotto l\'acqua.', 'Taglia pomodorini e cetriolo, spezzetta il basilico.', 'Condisci tutto con olio, olive e sale; lascia insaporire 10 minuti prima di servire.'],
    tags: ['estate', 'da asporto'],
  },
];

async function main() {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  let user = list?.users.find((u) => u.email === EMAIL);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({
      email: EMAIL,
      email_confirm: true,
      password: crypto.randomUUID() + crypto.randomUUID(),
      user_metadata: { username: 'mestolo_catalogo', display_name: 'Catalogo Mestolo', locale: 'it' },
    });
    if (error || !data.user) throw error ?? new Error('cannot create editorial user');
    user = data.user;
  }
  await admin.from('profiles').update({ display_name: 'Catalogo Mestolo', bio: 'Ricette di base scritte per Mestolo.' }).eq('id', user.id);
  const { data: cats } = await admin.from('categories').select('id, slug').is('owner_id', null);
  const catId = new Map((cats ?? []).map((c: { id: string; slug: string }) => [c.slug, c.id]));
  const { data: existing } = await admin.from('recipes').select('title').eq('owner_id', user.id);
  const have = new Set((existing ?? []).map((r: { title: string }) => r.title));
  let added = 0;
  for (const r of CATALOG) {
    if (have.has(r.title)) continue;
    const { error } = await admin.from('recipes').insert({
      owner_id: user.id,
      title: r.title,
      description: r.description,
      original_language: 'it',
      servings: r.servings,
      prep_minutes: r.prep,
      cook_minutes: r.cook,
      total_minutes: r.total,
      ingredients: r.ingredients,
      steps: r.steps.map((text) => ({ text })),
      category_id: catId.get(r.category) ?? null,
      tags: r.tags,
      visibility: 'public',
      source_type: 'manual',
      source_name: 'Catalogo Mestolo',
    });
    if (error) throw error;
    added++;
  }
  console.log(`Catalog ready: ${added} recipes added, ${CATALOG.length - added} already present.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
