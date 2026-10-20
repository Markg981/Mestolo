/**
 * Calendario indicativo di frutta e verdura di stagione.
 *
 * Riferimento: clima temperato dell'emisfero nord, produzione in pieno campo
 * per Italia/Europa meridionale e centrale (calendari divulgativi di stagionalita
 * in stile CREA / Ministero dell'Agricoltura italiano e analoghi europei). E una
 * semplificazione: varia con regione, varieta e annata, quindi e solo indicativo.
 * Per l'emisfero sud i mesi sono sfasati di 6 (vedi index.ts).
 *
 * Mesi: 1 = gennaio ... 12 = dicembre. Sinonimi per lingua separati da ";" (singolari e plurali).
 */
import type { Locale } from '@/i18n/config';

export type SeasonalKind = 'fruit' | 'vegetable';

export interface SeasonalProduct {
  id: string;
  kind: SeasonalKind;
  /** months (northern hemisphere) in which the product is in season */
  months: readonly number[];
  /** synonyms used to recognise the product in ingredient names, per app language */
  names: Record<Locale, readonly string[]>;
}

type Row = [id: string, kind: SeasonalKind, months: string, it: string, en: string, es: string, fr: string, de: string, pt: string];

const split = (s: string): string[] => s.split(';').map((x) => x.trim()).filter(Boolean);

const ROWS: Row[] = [
  ['asparagus', 'vegetable', '3-6', 'asparago;asparagi', 'asparagus', 'esparrago;esparragos', 'asperge;asperges', 'spargel', 'espargo;espargos'],
  ['artichoke', 'vegetable', '2-5,10-11', 'carciofo;carciofi', 'artichoke;artichokes', 'alcachofa;alcachofas', 'artichaut;artichauts', 'artischocke;artischocken', 'alcachofra;alcachofras'],
  ['peas', 'vegetable', '4-6', 'pisello;piselli', 'peas;pea;green peas', 'guisante;guisantes', 'petit pois;pois', 'erbse;erbsen', 'ervilha;ervilhas'],
  ['broadbeans', 'vegetable', '4-6', 'fava;fave', 'broad beans;broad bean;fava beans', 'haba;habas', 'feve;feves', 'dicke bohnen;saubohnen', 'fava;favas'],
  ['zucchini', 'vegetable', '5-9', 'zucchina;zucchine;zucchino;zucchini', 'zucchini;courgette;courgettes', 'calabacin;calabacines', 'courgette;courgettes', 'zucchini;zucchino', 'curgete;curgetes;abobrinha;abobrinhas'],
  ['tomato', 'vegetable', '6-9', 'pomodoro;pomodori;pomodorini', 'tomato;tomatoes;cherry tomatoes', 'tomate;tomates', 'tomate;tomates', 'tomate;tomaten', 'tomate;tomates'],
  ['eggplant', 'vegetable', '6-9', 'melanzana;melanzane', 'eggplant;eggplants;aubergine;aubergines', 'berenjena;berenjenas', 'aubergine;aubergines', 'aubergine;auberginen', 'beringela;beringelas'],
  ['pepper', 'vegetable', '6-9', 'peperone;peperoni', 'bell pepper;bell peppers;sweet pepper', 'pimiento;pimientos', 'poivron;poivrons', 'paprika;paprikaschote;paprikaschoten', 'pimentao;pimentoes;pimento'],
  ['cucumber', 'vegetable', '6-8', 'cetriolo;cetrioli', 'cucumber;cucumbers', 'pepino;pepinos', 'concombre;concombres', 'gurke;gurken', 'pepino;pepinos'],
  ['greenbeans', 'vegetable', '6-9', 'fagiolino;fagiolini', 'green beans;green bean;string beans', 'judia verde;judias verdes', 'haricot vert;haricots verts', 'grune bohnen;buschbohnen', 'feijao verde;feijoes verdes;vagem'],
  ['corn', 'vegetable', '7-9', 'mais;pannocchia;pannocchie', 'corn;sweetcorn;corn on the cob', 'maiz;mazorca', 'mais;epi de mais', 'mais;maiskolben', 'milho;espiga de milho'],
  ['pumpkin', 'vegetable', '9-12', 'zucca', 'pumpkin;squash;butternut', 'calabaza', 'citrouille;potiron;courge', 'kurbis;butternut', 'abobora'],
  ['mushroom', 'vegetable', '9-11', 'fungo;funghi;porcini;porcino', 'mushroom;mushrooms;porcini', 'seta;setas;champinon;champinones;hongos', 'champignon;champignons;cepe;cepes', 'pilz;pilze;champignons;steinpilze', 'cogumelo;cogumelos'],
  ['cauliflower', 'vegetable', '10-3', 'cavolfiore;cavolfiori', 'cauliflower;cauliflowers', 'coliflor;coliflores', 'chou fleur;choux fleurs', 'blumenkohl', 'couve flor;couve-flor'],
  ['broccoli', 'vegetable', '10-3', 'broccolo;broccoli', 'broccoli', 'brocoli;broculi', 'brocoli;brocolis', 'brokkoli', 'brocolo;brocolos;brocolis'],
  ['cabbage', 'vegetable', '10-3', 'cavolo;cavoli;verza;cavolo nero;cavolo cappuccio', 'cabbage;kale;savoy cabbage', 'col;repollo;berza;kale', 'chou;choux;chou frise', 'kohl;wirsing;gruenkohl;grunkohl;weisskohl', 'couve;repolho;couves'],
  ['brusselssprouts', 'vegetable', '10-2', 'cavolini di bruxelles;cavoletti di bruxelles', 'brussels sprouts;brussel sprouts', 'coles de bruselas', 'choux de bruxelles', 'rosenkohl', 'couves de bruxelas'],
  ['spinach', 'vegetable', '10-5', 'spinaci;spinacio', 'spinach', 'espinaca;espinacas', 'epinard;epinards', 'spinat', 'espinafre;espinafres'],
  ['chard', 'vegetable', '4-6,9-11', 'bietola;bietole;erbette', 'chard;swiss chard', 'acelga;acelgas', 'blette;blettes', 'mangold', 'acelga;acelgas'],
  ['leek', 'vegetable', '10-3', 'porro;porri', 'leek;leeks', 'puerro;puerros', 'poireau;poireaux', 'lauch;porree', 'alho porro;alhos porros;alho-porro'],
  ['fennel', 'vegetable', '10-3', 'finocchio;finocchi', 'fennel', 'hinojo', 'fenouil', 'fenchel', 'funcho;erva-doce'],
  ['radicchio', 'vegetable', '10-3', 'radicchio;cicoria;indivia', 'radicchio;chicory;endive', 'achicoria;endibia', 'chicoree;endive', 'chicoree;endivie;radicchio', 'chicoria;endivia;radicchio'],
  ['lettuce', 'vegetable', '4-6,9-10', 'lattuga;insalata;rucola', 'lettuce;arugula;rocket;salad leaves', 'lechuga;rucula', 'laitue;salade;roquette', 'salat;kopfsalat;rucola', 'alface;rucula'],
  ['carrot', 'vegetable', '5-11', 'carota;carote', 'carrot;carrots', 'zanahoria;zanahorias', 'carotte;carottes', 'karotte;karotten;mohre;mohren', 'cenoura;cenouras'],
  ['beet', 'vegetable', '10-3', 'barbabietola;barbabietole;rapa rossa', 'beet;beets;beetroot', 'remolacha;remolachas', 'betterave;betteraves', 'rote bete;rote beete', 'beterraba;beterrabas'],
  ['celery', 'vegetable', '9-12', 'sedano', 'celery', 'apio', 'celeri', 'sellerie;stangensellerie', 'aipo'],
  ['turnip', 'vegetable', '10-3', 'rapa;rape', 'turnip;turnips', 'nabo;nabos', 'navet;navets', 'ruebe;rube;steckrube', 'nabo;nabos'],
  ['strawberry', 'fruit', '4-6', 'fragola;fragole', 'strawberry;strawberries', 'fresa;fresas', 'fraise;fraises', 'erdbeere;erdbeeren', 'morango;morangos'],
  ['cherry', 'fruit', '5-7', 'ciliegia;ciliegie', 'cherry;cherries', 'cereza;cerezas', 'cerise;cerises', 'kirsche;kirschen', 'cereja;cerejas'],
  ['apricot', 'fruit', '6-7', 'albicocca;albicocche', 'apricot;apricots', 'albaricoque;albaricoques', 'abricot;abricots', 'aprikose;aprikosen', 'damasco;damascos;alperce;alperces'],
  ['peach', 'fruit', '6-9', 'pesca;pesche;nettarina;nettarine', 'peach;peaches;nectarine;nectarines', 'melocoton;melocotones;nectarina;nectarinas', 'peche;peches;nectarine;nectarines', 'pfirsich;pfirsiche;nektarine;nektarinen', 'pessego;pessegos;nectarina;nectarinas'],
  ['watermelon', 'fruit', '6-8', 'anguria;cocomero;cocomeri', 'watermelon;watermelons', 'sandia;sandias', 'pasteque;pasteques', 'wassermelone;wassermelonen', 'melancia;melancias'],
  ['melon', 'fruit', '6-9', 'melone;meloni', 'melon;melons;cantaloupe', 'melon;melones', 'melon;melons', 'melone;melonen', 'melao;meloes'],
  ['fig', 'fruit', '7-9', 'fico;fichi', 'fig;figs', 'higo;higos', 'figue;figues', 'feige;feigen', 'figo;figos'],
  ['plum', 'fruit', '6-9', 'prugna;prugne;susina;susine', 'plum;plums', 'ciruela;ciruelas', 'prune;prunes;mirabelle', 'pflaume;pflaumen;zwetschge;zwetschgen', 'ameixa;ameixas'],
  ['grape', 'fruit', '8-10', 'uva', 'grape;grapes', 'uva;uvas', 'raisin;raisins', 'traube;trauben', 'uva;uvas'],
  ['pear', 'fruit', '8-12', 'pera;pere', 'pear;pears', 'pera;peras', 'poire;poires', 'birne;birnen', 'pera;peras'],
  ['apple', 'fruit', '9-12,1-2', 'mela;mele', 'apple;apples', 'manzana;manzanas', 'pomme;pommes', 'apfel;apfelsaft', 'maca;macas'],
  ['chestnut', 'fruit', '10-11', 'castagna;castagne;marrone;marroni', 'chestnut;chestnuts', 'castana;castanas', 'chataigne;chataignes;marron;marrons', 'kastanie;kastanien;maroni', 'castanha;castanhas'],
  ['persimmon', 'fruit', '10-12', 'cachi;kaki;caco', 'persimmon;persimmons;kaki', 'caqui;caquis', 'kaki;kakis;plaqueminier', 'kaki;kakis;persimone', 'dospiro;dospiros;caqui'],
  ['pomegranate', 'fruit', '10-12', 'melograno;melagrana;melograni', 'pomegranate;pomegranates', 'granada;granadas', 'grenade;grenades', 'granatapfel', 'roma;romas'],
  ['orange', 'fruit', '11-4', 'arancia;arance', 'orange;oranges', 'naranja;naranjas', 'orange;oranges', 'orange;orangen;apfelsine;apfelsinen', 'laranja;laranjas'],
  ['mandarin', 'fruit', '11-2', 'mandarino;mandarini;clementina;clementine', 'mandarin;mandarins;tangerine;tangerines;clementine;clementines', 'mandarina;mandarinas;clementina;clementinas', 'mandarine;mandarines;clementine;clementines', 'mandarine;mandarinen;clementine;clementinen', 'tangerina;tangerinas;clementina;clementinas'],
  ['lemon', 'fruit', '11-4', 'limone;limoni', 'lemon;lemons', 'limon;limones', 'citron;citrons', 'zitrone;zitronen', 'limao;limoes'],
  ['kiwi', 'fruit', '11-4', 'kiwi', 'kiwi;kiwis;kiwifruit', 'kiwi;kiwis', 'kiwi;kiwis', 'kiwi;kiwis', 'kiwi;kiwis'],
];

/** "3-6", "10-2" (wrap-around) and "4-6,9-11" -> sorted month list. */
export function parseMonths(spec: string): number[] {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const [a, b = a] = part.split('-').map(Number);
    for (let m = a; ; m = (m % 12) + 1) {
      out.add(m);
      if (m === b) break;
    }
  }
  return [...out].sort((x, y) => x - y);
}

export const SEASONAL_PRODUCTS: readonly SeasonalProduct[] = ROWS.map(([id, kind, months, it, en, es, fr, de, pt]) => ({
  id,
  kind,
  months: parseMonths(months),
  names: { it: split(it), en: split(en), es: split(es), fr: split(fr), de: split(de), pt: split(pt) },
}));
