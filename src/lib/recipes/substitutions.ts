import { z } from 'zod';
import { normalizeText } from './duplicates';

/**
 * Built-in (non-AI, free) substitution table for very common ingredients.
 * Every entry is a SUGGESTION with known limits, never a guarantee, and makes
 * no claim about allergy or intolerance safety.
 */
type L = Record<'it' | 'en' | 'es' | 'fr' | 'de' | 'pt', string>;

export interface BuiltinSubstitution {
  match: string[];
  alternatives: { name: L; ratio: L; effect: L; limits: L }[];
}

export const BUILTIN_SUBSTITUTIONS: BuiltinSubstitution[] = [
  {
    match: ['burro', 'butter', 'mantequilla', 'beurre', 'manteiga'],
    alternatives: [
      {
        name: { it: 'Olio extravergine d’oliva', en: 'Extra virgin olive oil', es: 'Aceite de oliva virgen extra', fr: 'Huile d’olive vierge extra', de: 'Natives Olivenöl extra', pt: 'Azeite extra virgem' },
        ratio: { it: 'circa 3/4 del peso del burro', en: 'about 3/4 of the butter weight', es: 'aprox. 3/4 del peso de la mantequilla', fr: 'environ 3/4 du poids du beurre', de: 'etwa 3/4 des Buttergewichts', pt: 'cerca de 3/4 do peso da manteiga' },
        effect: { it: 'Sapore più fruttato, impasti più umidi e meno friabili', en: 'Fruitier taste, moister and less flaky doughs', es: 'Sabor más afrutado, masas más húmedas y menos quebradizas', fr: 'Goût plus fruité, pâtes plus humides et moins friables', de: 'Fruchtiger, Teige feuchter und weniger mürbe', pt: 'Sabor mais frutado, massas mais húmidas e menos quebradiças' },
        limits: { it: 'Sconsigliato per sfoglia, frolla e creme montate', en: 'Not suitable for puff pastry, shortcrust or whipped creams', es: 'No apto para hojaldre, masa quebrada o cremas montadas', fr: 'Déconseillé pour pâte feuilletée, sablée ou crèmes fouettées', de: 'Nicht für Blätterteig, Mürbeteig oder Buttercremes', pt: 'Não indicado para massa folhada, areada ou cremes batidos' },
      },
    ],
  },
  {
    match: ['latte', 'milk', 'leche', 'lait', 'milch', 'leite'],
    alternatives: [
      {
        name: { it: 'Bevanda vegetale non zuccherata (soia, avena)', en: 'Unsweetened plant drink (soy, oat)', es: 'Bebida vegetal sin azúcar (soja, avena)', fr: 'Boisson végétale non sucrée (soja, avoine)', de: 'Ungesüßter Pflanzendrink (Soja, Hafer)', pt: 'Bebida vegetal sem açúcar (soja, aveia)' },
        ratio: { it: 'stessa quantità', en: 'same amount', es: 'misma cantidad', fr: 'même quantité', de: 'gleiche Menge', pt: 'mesma quantidade' },
        effect: { it: 'Gusto leggermente diverso; la soia si comporta meglio nelle creme', en: 'Slightly different taste; soy works best in custards', es: 'Sabor algo distinto; la soja funciona mejor en cremas', fr: 'Goût un peu différent ; le soja convient mieux aux crèmes', de: 'Etwas anderer Geschmack; Soja eignet sich am besten für Cremes', pt: 'Sabor ligeiramente diferente; a soja resulta melhor em cremes' },
        limits: { it: 'Può addensare meno; verificare gli ingredienti in caso di allergie', en: 'May thicken less; check labels for allergies', es: 'Puede espesar menos; revisa etiquetas si hay alergias', fr: 'Peut moins épaissir ; vérifiez l’étiquette en cas d’allergie', de: 'Dickt evtl. weniger an; bei Allergien Etikett prüfen', pt: 'Pode espessar menos; verifique o rótulo em caso de alergias' },
      },
    ],
  },
  {
    match: ['uova', 'uovo', 'egg', 'eggs', 'huevo', 'huevos', 'oeuf', 'oeufs', 'ei', 'eier', 'ovo', 'ovos'],
    alternatives: [
      {
        name: { it: 'Semi di lino macinati + acqua', en: 'Ground flaxseed + water', es: 'Linaza molida + agua', fr: 'Graines de lin moulues + eau', de: 'Gemahlene Leinsamen + Wasser', pt: 'Linhaça moída + água' },
        ratio: { it: '1 cucchiaio + 3 cucchiai d’acqua per uovo, riposo 10 min', en: '1 tbsp + 3 tbsp water per egg, rest 10 min', es: '1 cda + 3 cdas de agua por huevo, reposar 10 min', fr: '1 c. à s. + 3 c. à s. d’eau par œuf, repos 10 min', de: '1 EL + 3 EL Wasser pro Ei, 10 Min. quellen', pt: '1 colher de sopa + 3 de água por ovo, repousar 10 min' },
        effect: { it: 'Lega gli impasti (biscotti, muffin); gusto leggermente rustico', en: 'Binds doughs (cookies, muffins); slightly nutty taste', es: 'Liga masas (galletas, magdalenas); sabor algo rústico', fr: 'Lie les pâtes (biscuits, muffins) ; goût légèrement rustique', de: 'Bindet Teige (Kekse, Muffins); leicht nussig', pt: 'Liga massas (bolachas, muffins); sabor ligeiramente rústico' },
        limits: { it: 'Non monta: inadatto a meringhe, pan di Spagna, frittate', en: 'Does not whip: unsuitable for meringues, sponge cakes, omelettes', es: 'No monta: no sirve para merengues, bizcochos o tortillas', fr: 'Ne monte pas : inadapté aux meringues, génoises, omelettes', de: 'Nicht aufschlagbar: ungeeignet für Baiser, Biskuit, Omelett', pt: 'Não bate: inadequado para merengues, pão-de-ló, omeletes' },
      },
    ],
  },
  {
    match: ['panna', 'panna fresca', 'panna da cucina', 'cream', 'heavy cream', 'nata', 'crème', 'crème fraîche', 'sahne', 'natas', 'creme de leite'],
    alternatives: [
      {
        name: { it: 'Yogurt greco intero', en: 'Full-fat Greek yogurt', es: 'Yogur griego entero', fr: 'Yaourt grec entier', de: 'Griechischer Joghurt (vollfett)', pt: 'Iogurte grego integral' },
        ratio: { it: 'stessa quantità, aggiunto a fuoco spento', en: 'same amount, added off the heat', es: 'misma cantidad, fuera del fuego', fr: 'même quantité, hors du feu', de: 'gleiche Menge, ohne Hitze unterrühren', pt: 'mesma quantidade, fora do lume' },
        effect: { it: 'Più acidulo e meno grasso', en: 'Tangier and lighter', es: 'Más ácido y ligero', fr: 'Plus acidulé et plus léger', de: 'Säuerlicher und leichter', pt: 'Mais ácido e mais leve' },
        limits: { it: 'Può separarsi se bolle; non si monta', en: 'May curdle if boiled; does not whip', es: 'Puede cortarse si hierve; no se monta', fr: 'Peut trancher à ébullition ; ne se fouette pas', de: 'Kann beim Kochen gerinnen; nicht schlagbar', pt: 'Pode talhar se ferver; não bate' },
      },
    ],
  },
  {
    match: ['lievito di birra fresco', 'lievito fresco', 'fresh yeast', 'levadura fresca', 'levure fraîche', 'frischhefe', 'fermento fresco'],
    alternatives: [
      {
        name: { it: 'Lievito di birra secco', en: 'Active dry yeast', es: 'Levadura seca', fr: 'Levure sèche', de: 'Trockenhefe', pt: 'Fermento biológico seco' },
        ratio: { it: 'circa 1/3 del peso del lievito fresco (indicazione comune, controlla la confezione)', en: 'about 1/3 of the fresh yeast weight (common guideline, check the package)', es: 'aprox. 1/3 del peso de la fresca (orientativo, revisa el envase)', fr: 'environ 1/3 du poids de la levure fraîche (indicatif, voir l’emballage)', de: 'etwa 1/3 des Frischhefegewichts (Richtwert, Packung beachten)', pt: 'cerca de 1/3 do peso do fresco (orientativo, veja a embalagem)' },
        effect: { it: 'Risultato simile; tempi di lievitazione possono variare', en: 'Similar result; rising times may vary', es: 'Resultado similar; los tiempos pueden variar', fr: 'Résultat similaire ; temps de pousse variables', de: 'Ähnliches Ergebnis; Gehzeiten können variieren', pt: 'Resultado semelhante; tempos de levedação podem variar' },
        limits: { it: 'Non sostituisce il lievito madre né il lievito chimico', en: 'Does not replace sourdough starter or baking powder', es: 'No sustituye la masa madre ni la levadura química', fr: 'Ne remplace ni le levain ni la levure chimique', de: 'Ersetzt weder Sauerteig noch Backpulver', pt: 'Não substitui o fermento natural nem o químico' },
      },
    ],
  },
  {
    match: ['zucchero', 'sugar', 'azúcar', 'sucre', 'zucker', 'açúcar'],
    alternatives: [
      {
        name: { it: 'Miele', en: 'Honey', es: 'Miel', fr: 'Miel', de: 'Honig', pt: 'Mel' },
        ratio: { it: 'circa 3/4 della quantità, riducendo un po’ i liquidi', en: 'about 3/4 of the amount, slightly reducing liquids', es: 'aprox. 3/4 de la cantidad, reduciendo algo los líquidos', fr: 'environ 3/4 de la quantité, en réduisant un peu les liquides', de: 'etwa 3/4 der Menge, Flüssigkeit etwas reduzieren', pt: 'cerca de 3/4 da quantidade, reduzindo um pouco os líquidos' },
        effect: { it: 'Più umido, colorisce prima in forno, gusto di miele', en: 'Moister, browns faster, honey flavour', es: 'Más húmedo, se dora antes, sabor a miel', fr: 'Plus moelleux, colore plus vite, goût de miel', de: 'Saftiger, bräunt schneller, Honiggeschmack', pt: 'Mais húmido, aloura mais depressa, sabor a mel' },
        limits: { it: 'Inadatto a meringhe e caramello; non adatto a bambini sotto 1 anno', en: 'Unsuitable for meringues and caramel; not for infants under 1', es: 'No apto para merengues y caramelo; no para menores de 1 año', fr: 'Inadapté aux meringues et caramel ; pas avant 1 an', de: 'Ungeeignet für Baiser und Karamell; nicht für Kinder unter 1 Jahr', pt: 'Inadequado para merengues e caramelo; não para bebés com menos de 1 ano' },
      },
    ],
  },
  {
    match: ['pangrattato', 'breadcrumbs', 'pan rallado', 'chapelure', 'paniermehl', 'semmelbrösel', 'pão ralado'],
    alternatives: [
      {
        name: { it: 'Fiocchi d’avena tritati o crackers sbriciolati', en: 'Blitzed rolled oats or crushed crackers', es: 'Copos de avena triturados o galletas saladas', fr: 'Flocons d’avoine mixés ou crackers écrasés', de: 'Gemahlene Haferflocken oder zerbröselte Cracker', pt: 'Flocos de aveia triturados ou bolachas de água e sal' },
        ratio: { it: 'stessa quantità', en: 'same amount', es: 'misma cantidad', fr: 'même quantité', de: 'gleiche Menge', pt: 'mesma quantidade' },
        effect: { it: 'Panatura simile, croccantezza diversa', en: 'Similar coating, different crunch', es: 'Rebozado similar, textura distinta', fr: 'Panure similaire, croustillant différent', de: 'Ähnliche Panade, andere Knusprigkeit', pt: 'Panado semelhante, crocância diferente' },
        limits: { it: 'L’avena può contenere glutine se non certificata', en: 'Oats may contain gluten unless certified', es: 'La avena puede contener gluten si no está certificada', fr: 'L’avoine peut contenir du gluten si non certifiée', de: 'Hafer kann Gluten enthalten, wenn nicht zertifiziert', pt: 'A aveia pode conter glúten se não for certificada' },
      },
    ],
  },
  {
    match: ['vino bianco', 'white wine', 'vino blanco', 'vin blanc', 'weißwein', 'weisswein', 'vinho branco'],
    alternatives: [
      {
        name: { it: 'Brodo + un cucchiaino di aceto o succo di limone', en: 'Stock + a teaspoon of vinegar or lemon juice', es: 'Caldo + una cucharadita de vinagre o limón', fr: 'Bouillon + une cuillère à café de vinaigre ou citron', de: 'Brühe + ein TL Essig oder Zitronensaft', pt: 'Caldo + uma colher de chá de vinagre ou limão' },
        ratio: { it: 'stessa quantità di liquido', en: 'same amount of liquid', es: 'misma cantidad de líquido', fr: 'même quantité de liquide', de: 'gleiche Flüssigkeitsmenge', pt: 'mesma quantidade de líquido' },
        effect: { it: 'Mantiene l’acidità, aroma meno complesso', en: 'Keeps acidity, less complex aroma', es: 'Mantiene la acidez, aroma menos complejo', fr: 'Garde l’acidité, arôme moins complexe', de: 'Erhält Säure, weniger komplexes Aroma', pt: 'Mantém a acidez, aroma menos complexo' },
        limits: { it: 'Regola il sale se il brodo è sapido', en: 'Adjust salt if the stock is salty', es: 'Ajusta la sal si el caldo es salado', fr: 'Ajustez le sel si le bouillon est salé', de: 'Salz anpassen, wenn die Brühe salzig ist', pt: 'Ajuste o sal se o caldo for salgado' },
      },
    ],
  },
  {
    match: ['parmigiano', 'parmigiano reggiano', 'parmesan', 'parmesano', 'grana padano', 'grana'],
    alternatives: [
      {
        name: { it: 'Pecorino grattugiato', en: 'Grated pecorino', es: 'Pecorino rallado', fr: 'Pecorino râpé', de: 'Geriebener Pecorino', pt: 'Pecorino ralado' },
        ratio: { it: 'circa 2/3 della quantità', en: 'about 2/3 of the amount', es: 'aprox. 2/3 de la cantidad', fr: 'environ 2/3 de la quantité', de: 'etwa 2/3 der Menge', pt: 'cerca de 2/3 da quantidade' },
        effect: { it: 'Più sapido e deciso', en: 'Saltier and sharper', es: 'Más salado e intenso', fr: 'Plus salé et plus marqué', de: 'Salziger und kräftiger', pt: 'Mais salgado e intenso' },
        limits: { it: 'Riduci il sale nel resto della ricetta', en: 'Reduce salt elsewhere in the recipe', es: 'Reduce la sal en el resto de la receta', fr: 'Réduisez le sel ailleurs dans la recette', de: 'Salz im Rest des Rezepts reduzieren', pt: 'Reduza o sal no resto da receita' },
      },
    ],
  },
  {
    match: ['limone', 'succo di limone', 'lemon', 'lemon juice', 'limón', 'zumo de limón', 'citron', 'jus de citron', 'zitrone', 'zitronensaft', 'limão', 'sumo de limão'],
    alternatives: [
      {
        name: { it: 'Aceto di vino bianco o di mele', en: 'White wine or cider vinegar', es: 'Vinagre de vino blanco o de manzana', fr: 'Vinaigre de vin blanc ou de cidre', de: 'Weißwein- oder Apfelessig', pt: 'Vinagre de vinho branco ou de maçã' },
        ratio: { it: 'circa metà della quantità di succo', en: 'about half the amount of juice', es: 'aprox. la mitad del zumo', fr: 'environ la moitié du jus', de: 'etwa die Hälfte der Saftmenge', pt: 'cerca de metade do sumo' },
        effect: { it: 'Acidità simile, manca il profumo di agrume', en: 'Similar acidity, no citrus aroma', es: 'Acidez similar, sin aroma cítrico', fr: 'Acidité similaire, sans arôme d’agrume', de: 'Ähnliche Säure, kein Zitrusaroma', pt: 'Acidez semelhante, sem aroma cítrico' },
        limits: { it: 'Non sostituisce la scorza', en: 'Does not replace zest', es: 'No sustituye la ralladura', fr: 'Ne remplace pas le zeste', de: 'Ersetzt keinen Zitronenabrieb', pt: 'Não substitui a raspa' },
      },
    ],
  },
];

export type SubLocale = keyof L;

export function findBuiltinSubstitutions(ingredientName: string, locale: string) {
  const loc = (['it', 'en', 'es', 'fr', 'de', 'pt'].includes(locale) ? locale : 'en') as SubLocale;
  const n = ` ${normalizeText(ingredientName)} `;
  const entry = BUILTIN_SUBSTITUTIONS.find((e) =>
    e.match.some((m) => n.includes(` ${normalizeText(m)} `)),
  );
  if (!entry) return [];
  return entry.alternatives.map((a) => ({
    name: a.name[loc],
    quantity_hint: a.ratio[loc],
    effect: a.effect[loc],
    limitations: a.limits[loc],
  }));
}

/** Shape returned to the UI for both built-in and AI substitutions. */
export const substitutionResultSchema = z.object({
  ingredients: z
    .array(
      z.object({
        ingredient: z.string().max(200),
        alternatives: z
          .array(
            z.object({
              name: z.string().max(200),
              quantity_hint: z.string().max(300),
              effect: z.string().max(600),
              limitations: z.string().max(600),
              risky: z.boolean().default(false),
            }),
          )
          .max(5),
      }),
    )
    .max(20),
  general_warning: z.string().max(600).default(''),
});
export type SubstitutionResult = z.infer<typeof substitutionResultSchema>;
