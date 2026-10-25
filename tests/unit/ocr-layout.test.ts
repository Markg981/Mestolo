import { describe, expect, it } from 'vitest';
import { linesToText, type OcrLine } from '@/lib/ocr/layout';

const H = 16;
const line = (text: string, x: number, y: number, w: number): OcrLine => ({ text, x, y, w, h: H });
/** The text lines in reading order; blank lines (possible paragraph ends) are checked apart. */
const order = (ls: OcrLine[]) => linesToText(ls).split('\n').filter(Boolean);

/** Two-column page (as in the Accademia Montersino recipe cards), lines in a scrambled engine order. */
const twoColumns: OcrLine[] = [
  line('Lavate e pulite i calamari. Apriteli a metà per il senso', 375, 318, 485),
  line('400 g', 75, 318, 45),
  line('300 g', 75, 340, 45),
  line('500 ml', 60, 450, 60),
  line('FRITTO DI CALAMARI, MAZZANCOLLE E CHIPS DI VERDURE', 75, 180, 785),
  line('calamari', 140, 318, 75),
  line('mazzancolle', 140, 340, 100),
  line('Ingredienti per 4 persone', 55, 278, 235),
  line('Preparazione', 375, 278, 120),
  line('della lunghezza e incideteli a rombetti con la lama di', 375, 340, 485),
  line('Per la frittura', 55, 428, 140),
  line('latte', 140, 450, 45),
  line('Raccogliete il pesce in una terrina, unite il latte e la-', 375, 450, 485),
  line('sciate tutto a bagno per almeno 1 ora in frigorifero.', 375, 472, 485),
  // blank band crossing both columns, then a new section on each side
  line('Per la finitura', 55, 520, 140),
  line('Per la salsa di pomodoro agrodolce', 375, 520, 330),
  line('coriandolo o prezzemolo', 140, 542, 210),
  line('Fate soffriggere uno spicchio d’aglio in una padella', 375, 542, 485),
];

describe('linesToText', () => {
  it('rejoins quantities with ingredients and reads the columns one after the other', () => {
    expect(order(twoColumns)).toEqual(
      [
        'FRITTO DI CALAMARI, MAZZANCOLLE E CHIPS DI VERDURE',
        'Ingredienti per 4 persone',
        '400 g calamari',
        '300 g mazzancolle',
        'Per la frittura',
        '500 ml latte',
        'Per la finitura',
        'coriandolo o prezzemolo',
        'Preparazione',
        'Lavate e pulite i calamari. Apriteli a metà per il senso',
        'della lunghezza e incideteli a rombetti con la lama di',
        'Raccogliete il pesce in una terrina, unite il latte e la-',
        'sciate tutto a bagno per almeno 1 ora in frigorifero.',
        'Per la salsa di pomodoro agrodolce',
        'Fate soffriggere uno spicchio d’aglio in una padella',
      ],
    );
  });

  it('keeps a single-column page top to bottom', () => {
    const page = [line('Impastate bene.', 40, 120, 300), line('Torta di mele', 40, 40, 200), line('3 uova', 40, 80, 60), line('200 g farina', 40, 100, 110)];
    expect(order(page)).toEqual(['Torta di mele', '3 uova', '200 g farina', 'Impastate bene.']);
  });

  it('straightens a tilted photo before matching rows and columns', () => {
    const a = 0.03; // ~1.7°: the page is rotated, every line shifts down going right
    const tilted = twoColumns.map((l) => ({ ...l, y: l.y + l.x * Math.tan(a), angle: a }));
    expect(order(tilted)).toEqual(order(twoColumns));
  });

  it('follows columns that drift on a curved or skewed page', () => {
    // the gutter bends: no vertical band is empty along the whole page
    const curved = twoColumns.map((l) => ({ ...l, x: l.x + 0.004 * (l.y - 180) ** 2 / 10 }));
    expect(order(curved)).toEqual(order(twoColumns));
  });

  it('ignores specks in the gutter', () => {
    expect(order([...twoColumns, line('|', 330, 400, 30), line('#', 300, 300, 60)])).toEqual(order(twoColumns));
  });

  it('splits a line the engine joined across the gutter, using the word boxes', () => {
    const joined = twoColumns.filter((l) => l.text !== 'latte' && !l.text.startsWith('Raccogliete'));
    joined.push({
      ...line('latte Raccogliete il pesce in una terrina, unite il latte e la-', 140, 450, 720),
      words: [
        { text: 'latte', x: 140, w: 45 },
        { text: 'Raccogliete il pesce in una terrina,', x: 375, w: 300 },
        { text: 'unite il latte e la-', x: 680, w: 180 },
      ],
    });
    expect(order(joined)).toEqual(order(twoColumns));
  });

  it('reads columns, then a full-width paragraph, then the columns below it', () => {
    const page = [
      line('Ingredienti', 40, 40, 200),
      line('Preparazione', 400, 40, 200),
      line('200 g farina', 40, 60, 200),
      line('Impastate bene.', 400, 60, 300),
      line('Consiglio: servite la torta tiepida con una pallina di gelato.', 40, 120, 660),
      line('Per la crema', 40, 180, 200),
      line('Per la crema scaldate il latte.', 400, 180, 300),
      line('500 ml latte', 40, 200, 200),
    ];
    expect(order(page)).toEqual([
      'Ingredienti',
      '200 g farina',
      'Preparazione',
      'Impastate bene.',
      'Consiglio: servite la torta tiepida con una pallina di gelato.',
      'Per la crema',
      '500 ml latte',
      'Per la crema scaldate il latte.',
    ]);
  });

  it('marks a paragraph end where a line stops short of the column edge', () => {
    const page = [
      line('Lavate e pulite i calamari. Apriteli a metà per il senso', 376, 319, 500),
      line('di lato.', 376, 340, 60),
      line('Raccogliete il pesce in una terrina, unite il latte e la-', 376, 361, 500),
      line('sciate tutto a bagno per almeno 1 ora in frigorifero.', 376, 382, 482),
      line('Nel frattempo, miscelate in una ciotola la semola e la', 376, 403, 500),
    ];
    expect(linesToText(page).split('\n')).toEqual([
      'Lavate e pulite i calamari. Apriteli a metà per il senso',
      'di lato.',
      '',
      'Raccogliete il pesce in una terrina, unite il latte e la-',
      'sciate tutto a bagno per almeno 1 ora in frigorifero.',
      '',
      'Nel frattempo, miscelate in una ciotola la semola e la',
    ]);
  });

  it('joins pieces of one row that the engine split, inside a column', () => {
    const page = [
      line('Sciacquate le zucchine sotto l’acqua corrente e', 375, 535, 500),
      line('a rondelle', 782, 556, 96),
      line('sbucciate le patate; quindi tagliate', 375, 557, 344),
      line('con una mandolina. Trascorso il tempo, riprendete il', 376, 577, 501),
    ];
    expect(order(page)).toEqual([
      'Sciacquate le zucchine sotto l’acqua corrente e',
      'sbucciate le patate; quindi tagliate a rondelle',
      'con una mandolina. Trascorso il tempo, riprendete il',
    ]);
  });

  it('rejoins an ingredient that wrapped at the column edge, not the next ingredient', () => {
    const page = [
      line('100 g farina', 69, 470, 140),
      line('100 g semola di grano duro', 69, 490, 271),
      line('rimacinata', 140, 510, 98),
      line('15 g zucchero', 79, 640, 144),
      line('peperoncino fresco', 140, 660, 181),
      line('aglio', 140, 684, 45),
    ];
    expect(order(page)).toEqual(['100 g farina', '100 g semola di grano duro rimacinata', '15 g zucchero', 'peperoncino fresco', 'aglio']);
  });

  it('reads a g misread as 9 after a quantity', () => {
    expect(order([line('300 9', 68, 342, 47), line('mazzancolle', 140, 342, 116)])).toEqual(['300 g mazzancolle']);
  });

  it('returns an empty string without lines', () => {
    expect(linesToText([line('  ', 0, 0, 10)])).toBe('');
  });
});
