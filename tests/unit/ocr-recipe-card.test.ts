import { describe, expect, it } from 'vitest';
import { cleanOcrText } from '@/lib/ocr/clean';
import { parseRecipeText } from '@/lib/recipes/text-parser';

/** ML Kit output of a two-column recipe card, already reordered by the layout step. */
const CARD = `FRITTO DI CALAMARI, MAZZANCOLLE E CHIPS DI VERDURE
Ingredienti per 4 persone
400 g calamari
100 g ZUcchine
Per la frittura
500 ml latte
100 g semola di grano duro
Per la salsa al pomodoro
agrodolce
200 g pomodori pelati
15 g ZUCchero
Per la finitura
coriandolo o prezzemolo
Preparazione
Lavate e pulite i calamari. Tagliateli in qUadrati.
Raccogliete il pesce in una terrina, unite il latte e la-
sciate tutto a bagno per almeno 1 ora in frigorifero.
Per la salsa di pomodoro agrodolce
Fate soffriggere uno spicchio d'aglio in una padella
per 3-4 minuti.
Consigli
I| metodo di frittura impiegato è il classico. GIi alimenti vengono tenuti a bagno.`;

describe('OCR of a recipe card', () => {
  const r = parseRecipeText(cleanOcrText(CARD));

  it('fixes case misreads of same-shape letters and I/l', () => {
    const t = cleanOcrText(CARD);
    expect(t).toContain('100 g zucchine');
    expect(t).toContain('15 g zucchero');
    expect(t).toContain('in quadrati');
    expect(t).toContain('Il metodo');
    expect(t).toContain('Gli alimenti');
    expect(t).toContain('FRITTO DI CALAMARI');
  });

  it('turns sub-headings into ingredient sections, including a wrapped one', () => {
    expect(r.ingredients.map((i) => [i.name, i.section ?? null])).toEqual([
      ['calamari', null],
      ['zucchine', null],
      ['latte', 'Per la frittura'],
      ['semola di grano duro', 'Per la frittura'],
      ['pomodori pelati', 'Per la salsa al pomodoro agrodolce'],
      ['zucchero', 'Per la salsa al pomodoro agrodolce'],
      ['coriandolo o prezzemolo', 'Per la finitura'],
    ]);
    expect(r.servings).toBe(4);
  });

  it('keeps step sections and puts the tips in the description', () => {
    expect(r.steps.map((s) => [s.text, s.section ?? null])).toEqual([
      ['Lavate e pulite i calamari. Tagliateli in quadrati.', null],
      ['Raccogliete il pesce in una terrina, unite il latte e lasciate tutto a bagno per almeno 1 ora in frigorifero.', null],
      ["Fate soffriggere uno spicchio d'aglio in una padella per 3-4 minuti.", 'Per la salsa di pomodoro agrodolce'],
    ]);
    expect(r.description).toContain('Il metodo di frittura');
  });

  it('takes the all-caps title under the logo and drops the logo lines', () => {
    const p = parseRecipeText(`ACCADEMIA\nMontersino\n${CARD}`);
    expect(p.title).toBe('FRITTO DI CALAMARI, MAZZANCOLLE E CHIPS DI VERDURE');
    expect(p.description).not.toContain('Montersino');
  });

  it('keeps the first line as title in pasted text', () => {
    expect(parseRecipeText('Tiramisù\nIl dolce più amato\nIngredienti\n3 uova\nPreparazione\nMontate le uova.').title).toBe('Tiramisù');
  });

  it('recognizes headers with one OCR misread, not prose that starts alike', () => {
    const p = parseRecipeText('Torta\nIngredenti per 4 persone\n200 g farina\nPreparzione\nPreparate lo stampo.\nImpastate bene.');
    expect(p.ingredients.map((i) => i.name)).toEqual(['farina']);
    expect(p.servings).toBe(4);
    expect(p.steps.map((s) => s.text)).toEqual(['Preparate lo stampo.', 'Impastate bene.']);
  });

  it('splits steps at paragraph ends, whatever the OCR made of the case', () => {
    const text = cleanOcrText(
      'Preparazione\n\nRaccogliete il pesce in una terrina, unite il latte e la-\nSciate tutto a bagno.\n\n' +
        'Sbucciate le patate; quindi tagliate a rondelle\nCon una mandolina. Trascorso il tempo, asciugatelo su un foglio\ndi carta assorbente da cucina\n\n' +
        'Scaldate in una pentola abbondante olio.',
    );
    expect(parseRecipeText(`Fritto\nIngredienti\n400 g calamari\n${text}`).steps.map((s) => s.text)).toEqual([
      'Raccogliete il pesce in una terrina, unite il latte e lasciate tutto a bagno.',
      'Sbucciate le patate; quindi tagliate a rondelle con una mandolina. Trascorso il tempo, asciugatelo su un foglio di carta assorbente da cucina',
      'Scaldate in una pentola abbondante olio.',
    ]);
  });

  it('keeps one step per line in pasted text without paragraphs', () => {
    const p = parseRecipeText('Torta\nIngredienti\n200 g farina\nPreparazione\nMescolate la farina\nSbattete le uova\nCuocete in forno');
    expect(p.steps.map((s) => s.text)).toEqual(['Mescolate la farina', 'Sbattete le uova', 'Cuocete in forno']);
  });

  it('joins the lines of each tip paragraph in the description', () => {
    const p = parseRecipeText('Torta\nIngredienti\n200 g farina\nPreparazione\nImpastate.\nConsigli\nServitela tiepida con la pan-\nna montata.\n\nSi conserva due giorni.');
    expect(p.description).toBe('Servitela tiepida con la panna montata.\nSi conserva due giorni.');
  });

  it('reads "300 9" as 300 g', () => {
    expect(cleanOcrText('300 9 mazzancolle')).toBe('300 g mazzancolle');
  });

  it('does not take a wrapped prose line starting with "Per" as a heading', () => {
    const p = parseRecipeText('Torta\nIngredienti\n200 g farina\nPreparazione\nMescolate bene\nper evitare grumi\nPer evitare che si attacchi\nmescolate spesso.');
    expect(p.steps.every((s) => !s.section)).toBe(true);
  });
});
