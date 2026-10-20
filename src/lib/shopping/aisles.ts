// Reparti del supermercato: classificazione deterministica da dizionario
// multilingua (it, en, es, fr, de, pt) e raggruppamento in ordine fisso.

export const AISLES = ['produce', 'bakery', 'meat', 'fish', 'dairy', 'pantry', 'frozen', 'beverages', 'household', 'other'] as const;
export type Aisle = (typeof AISLES)[number];

export function isAisle(v: unknown): v is Aisle {
  return typeof v === 'string' && (AISLES as readonly string[]).includes(v);
}

/** Minuscolo, senza accenti, spazi compattati: chiave stabile per nome prodotto. */
export function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 200);
}

// Radici gia normalizzate (senza accenti). "=" iniziale: parola esatta.
// Una radice si confronta come prefisso della parola; se lunga almeno 5
// caratteri anche come sottostringa (composti tedeschi: "Vollkornbrot").
// Vince la radice piu lunga; a parita, l'ordine dei reparti qui sotto.
const DICTIONARY: Record<Exclude<Aisle, 'other'>, string[]> = {
  frozen: [
    'surgelat', 'congelat', 'gelato', 'ghiacciol', 'frozen', 'ice cream', 'congel', 'surgel', 'glace', 'sorbet', 'tiefkuhl', 'eiscreme',
    'speiseeis', 'sorvete', 'helado', 'gelado', 'sorbetto', 'bastoncini di pesce', 'fish fingers',
  ],
  household: [
    'detersiv', 'detergent', 'sapone', 'shampoo', 'dentifric', 'carta igienica', 'carta da cucina', 'scottex', 'sgrassator', 'candeggina',
    'ammorbident', 'spugn', 'sacchi', 'pellicola', 'alluminio', 'toilet', 'paper towel', 'kitchen roll', 'soap', 'toothpaste', 'bleach', 'sponge',
    'bin bag', 'trash bag', 'cling film', '=dish', 'laundry', 'papel higienico', 'jabon', 'lavavajillas', 'lejia', 'esponja', 'bolsas de basura',
    'papier toilette', 'savon', 'lessive', 'eponge', 'liquide vaisselle', 'dentifrice', 'javel', 'sacs poubelle', 'toilettenpapier', 'seife',
    'spulmittel', 'waschmittel', 'zahnpasta', 'muellbeutel', 'mullbeutel', 'schwamm', 'papel higienico', 'sabonete', 'sabao', 'detergente',
    'esponja', 'saco do lixo', 'sacos do lixo', 'lixivia', 'guardanapo', 'tovagliol', 'napkin', 'servilleta', 'serviette', 'servietten', 'pile',
    'lampadin', 'light bulb', 'cat litter', 'lettiera', 'crocchette', 'pet food', 'cibo per cani', 'cibo per gatti',
  ],
  beverages: [
    'acqua', 'water', 'agua', 'eau', 'wasser', 'birra', 'beer', 'cerveza', 'biere', 'bier', 'cerveja', 'vino', 'wine', 'vin ', 'wein', 'vinho',
    'succo', 'juice', 'zumo', 'jugo', 'jus ', 'saft', 'sumo', '=cola', 'coca', 'aranciata', 'limonata', 'soda', 'tonica', 'tonic', 'spritz',
    'bibita', 'bevanda', 'drink', 'soft drink', 'refresco', 'boisson', 'getrank', 'limonade', 'cafe', 'caffe', 'coffee', 'kaffee', 'cafes',
    'te ', '=te', '=tea', '=the', '=tee', 'tisana', 'infuso', 'infusion', 'herbal tea', 'kamillentee', 'camomilla', 'chamomile', 'orzata',
    'prosecco', 'spumante', 'champagne', 'sekt', 'espumante', 'cava', 'liquore', 'liqueur', 'licor', 'likor', 'grappa', 'whisky', 'whiskey',
    'vodka', '=rum', '=gin', 'amaro', 'cidre', 'cider', 'sidra', 'energy drink', 'bevanda vegetale', 'latte di soia', 'latte di mandorla',
    'latte di avena', 'soy milk', 'oat milk', 'almond milk', 'leche de soja', 'leche de avena', 'lait de soja', 'lait d avoine', 'sojamilch',
    'hafermilch', 'mandelmilch', 'leite de soja', 'leite de aveia', 'tonico', 'seltz', 'mineral',
  ],
  fish: [
    'pesce', 'salmon', 'tonno', 'tuna', 'atun', 'thon', 'thunfisch', 'atum', 'merluzz', 'baccala', 'stoccafisso', '=cod', 'bacalao', 'morue',
    'kabeljau', 'bacalhau', 'orata', 'branzin', 'spigola', 'sea bass', 'sea bream', 'lubina', 'dorada', 'bar ', 'dorade', 'wolfsbarsch',
    'dourada', 'robalo', 'acciug', 'alici', 'anchov', 'anchoa', 'sardin', 'sardell', 'sgombr', 'mackerel', 'caballa', 'maquereau', 'makrele',
    'cavala', 'trota', 'trout', 'trucha', 'truite', 'forelle', 'truta', 'gamber', 'shrimp', 'prawn', 'camaron', 'langostino', 'crevette', 'garnele',
    'camarao', 'calamar', 'seppi', 'polpo', 'octopus', 'pulpo', 'poulpe', 'oktopus', 'polvo', 'cozze', 'mussel', 'mejillon', 'moule', 'miesmuschel',
    'mexilhao', 'vongol', 'clam', 'almeja', 'palourde', 'venusmuschel', 'ameijoa', 'aragost', 'lobster', 'langosta', 'homard', 'hummer', 'lagosta',
    'granchio', 'crab', 'cangrejo', 'crabe', 'krabbe', 'caranguejo', 'frutti di mare', 'seafood', 'marisco', 'fruits de mer', 'meeresfruchte',
    'merluza', 'lachs', 'fisch', 'poisson', 'peixe', 'pescado', 'surimi', 'baccalà', 'stockfisch', 'eglefin', 'haddock', 'sogliola', 'sole ',
    'halibut', 'rombo', 'platessa', 'plaice', 'sepia', 'sepie', 'tintenfisch', 'lula', 'ostric', 'oyster', 'ostra', 'huitre', 'auster',
  ],
  meat: [
    'carne', 'meat', 'viande', 'fleisch', 'manzo', 'beef', 'ternera', 'vaca', 'boeuf', 'rind', 'vitello', 'veal', 'veau', 'kalb', 'vitela',
    'maiale', 'pork', 'cerdo', 'porc', 'schwein', 'porco', 'suino', 'pollo', 'chicken', 'frango', 'poulet', 'huhn', 'hahnchen', 'tacchin', 'turkey',
    'pavo', 'dinde', 'pute', 'truthahn', 'peru', 'agnello', 'lamb', 'cordero', 'agneau', 'lamm', 'cordeiro', 'coniglio', 'rabbit', 'conejo',
    'lapin', 'kaninchen', 'coelho', 'anatra', 'duck', 'pato', 'canard', 'ente', 'salsiccia', 'salsicce', 'sausage', 'salchicha', 'chorizo',
    'saucisse', 'wurst', 'wurstchen', 'salsicha', 'linguica', 'prosciutt', '=ham', 'jamon', 'jambon', 'schinken', 'presunto', 'fiambre', 'speck',
    'pancetta', 'bacon', 'guanciale', 'panceta', 'lardon', 'lardo', 'salame', 'salami', 'mortadella', 'bresaola', 'cotechino', 'wurstel', 'hamburger',
    'burger', 'macinato', 'mince', 'minced', 'carne picada', 'carne moida', 'hackfleisch', 'viande hachee', 'bistecca', 'steak', 'filetto',
    'fillet of beef', 'cotoletta', 'cutlet', 'costata', 'costine', 'ribs', 'costillas', 'cotes', 'rippchen', 'costelas', 'fegato', 'liver',
    'higado', 'foie', 'leber', 'figado', 'arrosto', 'roast', 'asado', 'rotis', 'braten', 'assado', 'spezzatino', 'stew meat', 'pollame', 'poultry',
    'salchichon', 'jambonneau', 'pastrami', 'coscia', 'petto di', 'chicken breast', 'pechuga', 'blanc de poulet', 'hahnchenbrust', 'peito de frango',
  ],
  dairy: [
    'latte', 'milk', 'leche', 'lait', 'milch', 'leite', 'yogurt', 'yoghurt', 'iogurte', 'jogurt', 'formaggi', 'cheese', 'queso', 'fromage',
    'kase', 'queijo', 'mozzarella', 'parmigian', 'parmesan', 'grana', 'pecorino', 'ricotta', 'mascarpone', 'gorgonzola', 'stracchino', 'scamorza',
    'provola', 'fontina', 'asiago', 'emmental', 'gruyere', 'cheddar', 'brie', 'camembert', 'feta', 'philadelphia', 'cream cheese', 'quark',
    'burro', 'butter', 'mantequilla', 'beurre', 'manteiga', 'panna', 'cream', 'nata', 'creme', 'sahne', 'schlagobers', 'kefir', 'uova', 'uovo',
    'eggs', 'egg ', '=egg', 'huevo', 'oeuf', 'ei ', '=eier', '=ei', 'ovos', '=ovo', 'besciamella', 'bechamel', 'margarin', 'margarina',
    'requeson', 'cottage', 'skyr', 'burrata', 'halloumi', 'taleggio', 'nata montada', 'whipping',
  ],
  bakery: [
    'pane', 'bread', 'pan ', '=pan', 'pain', 'brot', 'pao', 'baguette', 'ciabatta', 'focaccia', 'panino', 'panini', 'rosetta', '=roll', '=rolls', '=bun',
    'bollo', 'brioche', 'cornett', 'croissant', 'fette biscottate', 'grissini', 'breadsticks', 'cracker', 'taralli', 'piadina', 'wrap', 'tortilla',
    'pita', 'naan', 'toast', 'pan carre', 'pane in cassetta', 'sandwich', 'torta', 'cake', 'tarta', 'gateau', 'kuchen', 'bolo', 'biscott',
    'biscuit', 'galleta', 'plätzchen', 'keks', 'bolacha', 'cookie', 'muffin', 'cornflakes', 'brotchen', 'semmel', 'vollkornbrot', 'pretzel',
    'brezel', 'panettone', 'pandoro', 'colomba', 'merendin', 'pasticcini', 'pastries', 'pasteles', 'patisserie', 'geback', 'pastel', 'doce',
  ],
  pantry: [
    'pasta', 'spaghetti', 'penne', 'fusilli', 'rigatoni', 'tagliatelle', 'lasagn', 'gnocchi', 'noodle', 'fideos', 'nouilles', 'nudeln', 'macarr',
    'massa', 'riso', 'rice', 'arroz', 'riz', 'reis', 'arroz', 'couscous', 'farro', 'orzo', 'barley', 'cebada', 'orge', 'gerste', 'cevada', 'quinoa',
    'avena', 'oats', 'avoine', 'hafer', 'aveia', 'polenta', 'semola', 'farina', 'flour', 'harina', 'farine', 'mehl', 'amido', 'starch', 'maizena',
    'fecule', 'speisestarke', 'lievito', 'yeast', 'levadura', 'levure', 'hefe', 'fermento', 'baking powder', 'bicarbonato', 'baking soda',
    'zucchero', 'sugar', 'azucar', 'sucre', 'zucker', 'acucar', 'miele', 'honey', 'miel', 'honig', 'mel ', '=mel', 'sale', 'salt', '=sal',
    '=sel', 'salz', 'pepe', 'pepper', 'pimienta', 'poivre', 'pfeffer', 'pimenta', 'spezie', 'spice', 'especia', 'epice', 'gewurz', 'origano',
    'oregano', 'basilico secco', 'cumino', 'cumin', 'comino', 'kreuzkummel', 'cominho', 'paprika', 'pimenton', 'curry', 'curcuma', 'turmeric',
    'curcuma', 'zafferano', 'saffron', 'azafran', 'safran', 'cannella', 'cinnamon', 'canela', 'cannelle', 'zimt', 'noce moscata', 'nutmeg',
    'nuez moscada', 'muscade', 'muskat', 'noz-moscada', 'chiodi di garofano', 'cloves', 'clavo', 'girofle', 'nelken', 'cravo', 'vaniglia',
    'vanilla', 'vainilla', 'vanille', 'baunilha', 'olio', 'oil', 'aceite', 'huile', 'ol ', 'oleo', 'azeite', 'aceto', 'vinegar', 'vinagre',
    'vinaigre', 'essig', 'vinagre', 'passata', 'pelati', 'polpa di pomodoro', 'tomato sauce', 'canned tomato', 'tomate frito', 'tomate triturado',
    'coulis', 'tomaten', 'concentrato', 'tomato paste', 'sugo', 'sauce', 'salsa', 'ketchup', 'maionese', 'mayonnaise', 'mayonesa', 'mayo',
    'senape', 'mustard', 'mostaza', 'moutarde', 'senf', 'mostarda', 'salsa di soia', 'soy sauce', 'salsa de soja', 'sauce soja', 'sojasauce',
    'molho de soja', 'pesto', 'tonno in scatola', 'canned tuna', 'legumi', 'lenticch', 'lentil', 'lenteja', 'lentille', 'linsen', 'lentilha',
    'ceci', 'chickpea', 'garbanzo', 'pois chiche', 'kichererbse', 'grao-de-bico', 'fagioli', 'beans', 'judias', 'alubias', 'haricots', 'bohnen',
    'feijao', 'piselli secchi', 'split pea', 'frutta secca', 'nuts', 'frutos secos', 'noix', 'nusse', 'mandorl', 'almond', 'almendra', 'amande',
    'mandel', 'amendoa', 'noci', 'walnut', 'nuez', 'nueces', 'nuts', 'noz ', 'walnuss', 'nocciol', 'hazelnut', 'avellana', 'noisette', 'haselnuss',
    'avela', 'pistacchi', 'pistachio', 'pistacho', 'pistache', 'pistazie', 'pinoli', 'pine nut', 'piñones', 'pignon', 'pinienkern', 'pinhao',
    'arachid', 'peanut', 'cacahuete', 'cacahuete', 'cacahuete', 'erdnuss', 'amendoim', 'uvetta', 'raisin', 'pasas', 'rosinen', 'passas',
    'cioccolat', 'chocolate', 'chocolat', 'schokolade', 'cacao', 'kakao', 'nutella', 'marmellata', 'jam', 'mermelada', 'confiture', 'konfituere',
    'marmelade', 'geleia', 'cereali', 'cereal', 'muesli', 'granola', 'biscotti secchi', 'caramell', 'candy', 'caramelo', 'bonbon', 'bonbons',
    'bombom', 'snack', 'patatine', 'chips', 'crisps', 'papas fritas', 'tortilla chips', 'conserva', 'canned', 'en conserva', 'lata', 'dose',
    'brodo', 'broth', 'stock', 'caldo', 'bouillon', 'brühe', 'bruhe', 'dado', 'stock cube', 'pastilla de caldo', 'cubo de caldo',
    'olive', 'olives', 'aceitunas', 'olives ', 'oliven', 'azeitonas', 'capperi', 'capers', 'alcaparras', 'capres', 'kapern', 'carciofini',
    'sott olio', 'sottaceti', 'pickles', 'pepinillos', 'cornichons', 'gurken', 'picles', 'tahina', 'tahini', 'hummus', 'latte di cocco',
    'coconut milk', 'leche de coco', 'lait de coco', 'kokosmilch', 'leite de coco', 'cocco', 'coconut', 'coco ', 'kokos', 'tofu', 'seitan',
    'tempeh', 'gelatina', 'gelatin', 'agar', 'edulcorante', 'sweetener', 'stevia', 'sciroppo', 'syrup', 'sirope', 'sirop', 'sirup', 'xarope',
    'caffe in grani', 'ground coffee', 'cafe molido', 'cafe moulu', 'kaffeebohnen', 'coffee beans', 'cafe em po', 'pangrattato', 'breadcrumbs',
    'pan rallado', 'chapelure', 'semmelbrosel', 'pao ralado', 'riso soffiato', 'wasabi', 'miso', 'sesamo', 'sesame', 'sesam', 'gergelim',
    'semi di', 'seeds', 'semillas', 'graines', 'samen', 'sementes', 'lino', 'flax', 'linaza', 'lin ', 'leinsamen', 'linhaca', 'chia', 'papavero',
    'poppy', 'amapola', 'pavot', 'mohn', 'papoila', 'zafran', 'dattero', 'datteri', 'date ', 'dates', 'datiles', 'dattes', 'datteln', 'tamaras',
    'fichi secchi', 'dried fig', 'higos secos', 'figues seches', 'getrocknete feigen', 'figos secos', 'prugne secche', 'prune', 'ciruelas pasas',
    'pruneaux', 'pflaumen', 'ameixas secas', 'cranberry secch', 'baccel', 'tapioca', 'agave', 'melassa', 'molasses', 'melaza', 'melasse',
  ],
  produce: [
    'frutta', 'fruit', 'fruta', 'fruits', 'obst', 'verdura', 'vegetable', 'verdure', 'legumbres', 'legume', 'gemuse', 'hortalica', 'legumes',
    'mela', 'mele', 'apple', 'manzana', 'pomme', 'apfel', 'maca', 'pera', 'pere', 'pear', 'poire', 'birne', 'banan', 'platano', 'arancia', 'arance',
    'orange', 'naranja', 'laranja', 'orangen', 'mandarin', 'clementin', 'tangerin', 'limone', 'limoni', 'lemon', 'limon', 'citron', 'zitrone',
    'limao', 'lime', 'lima', 'pompelmo', 'grapefruit', 'pomelo', 'pamplemousse', 'toronja', 'fragol', 'strawberr', 'fresa', 'fraise', 'erdbeer',
    'morango', 'lampon', 'raspberr', 'frambues', 'framboise', 'himbeer', 'framboesa', 'mirtill', 'blueberr', 'arandano', 'myrtille', 'heidelbeer',
    'mirtilo', 'more ', 'blackberr', 'mora ', 'mure', 'brombeer', 'amora', 'ciliegi', 'cherr', 'cereza', 'cerise', 'kirsche', 'cereja', 'pesca',
    'peach', 'melocoton', 'peche', 'pfirsich', 'nettarin', 'nectarin', 'albicocc', 'apricot', 'albaricoque', 'abricot', 'aprikose', 'damasco',
    'prugn', 'plum', 'ciruela', 'prune ', 'pflaume', 'ameixa', 'uva', 'grape', 'raisins', 'traube', 'melone', 'melon', 'meloncino', 'cocomero',
    'anguria', 'watermelon', 'sandia', 'pasteque', 'wassermelone', 'melancia', 'kiwi', 'ananas', 'pineapple', 'pina ', 'mango', 'papaya',
    'avocado', 'aguacate', 'abacate', 'fico', 'fichi', 'fig ', 'figs', 'higo', 'figue', 'feige', 'figo', 'melagran', 'pomegranate', 'granada',
    'grenade', 'granatapfel', 'roma ', 'cachi', 'persimmon', 'caqui', 'kaki', 'pomodor', 'tomato', 'tomate', 'tomaten', 'insalata', 'lettuce',
    'lechuga', 'laitue', 'salat', 'alface', 'rucola', 'arugula', 'rucula', 'roquette', 'rauke', 'rugula', 'spinaci', 'spinach', 'espinaca',
    'epinard', 'spinat', 'espinafre', 'valerian', 'lamb s lettuce', 'canonigos', 'mache', 'feldsalat', 'bieta', 'bietol', 'chard', 'acelga',
    'blette', 'mangold', 'cicoria', 'chicory', 'achicoria', 'chicoree', 'zichorie', 'radicchio', 'indivia', 'endive', 'escarola', 'endivie',
    'carota', 'carote', 'carrot', 'zanahoria', 'carotte', 'karotte', 'mohre', 'cenoura', 'patat', 'potato', 'cartof', 'kartoffel', 'batata',
    'pomme de terre', 'papa ', 'papas ', 'cipoll', 'onion', 'cebolla', 'oignon', 'zwiebel', 'cebola', 'scalogn', 'shallot', 'chalota',
    'echalote', 'schalotte', 'chalota', 'aglio', 'garlic', 'ajo', 'ail', 'knoblauch', 'alho', 'porro', 'porri', 'leek', 'puerro', 'poireau',
    'lauch', 'alho-porro', 'zucchin', 'courgette', 'calabacin', 'abobrinha', 'melanzan', 'eggplant', 'aubergine', 'berenjena', 'beringela',
    'peperon', 'bell pepper', 'pimiento', 'poivron', 'paprikaschote', 'pimentao', 'peperoncin', 'chili', 'chilli', 'guindilla', 'piment',
    'cetriol', 'cucumber', 'pepino', 'concombre', 'gurke', 'pepino', 'sedano', 'celery', 'apio', 'celeri', 'sellerie', 'aipo', 'finocch',
    'fennel', 'hinojo', 'fenouil', 'fenchel', 'funcho', 'cavolfior', 'cauliflower', 'coliflor', 'chou-fleur', 'blumenkohl', 'couve-flor',
    'broccol', 'brocoli', 'cavolo', 'cabbage', 'repollo', 'col ', 'chou', 'kohl', 'couve', 'verza', 'savoy', 'cavolini', 'brussels', 'coles de',
    'choux de', 'rosenkohl', 'couves de', 'asparag', 'esparrago', 'asperge', 'spargel', 'carciofi', 'artichoke', 'alcachofa', 'artichaut',
    'artischocke', 'alcachofra', 'fagiolini', 'green bean', 'judias verdes', 'haricots verts', 'grune bohnen', 'feijao verde', 'piselli freschi',
    'peas', 'guisantes', 'petits pois', 'erbsen', 'ervilhas', 'zucca', 'pumpkin', 'calabaza', 'citrouille', 'potiron', 'kurbis', 'abobora',
    'fungh', 'mushroom', 'champinon', 'seta', 'champignon', 'pilze', 'cogumelo', 'porcini', 'barbabietol', 'beet', 'remolacha', 'betterave',
    'rote bete', 'beterraba', 'ravanell', 'radish', 'rabano', 'radis', 'radieschen', 'rabanete', 'zenzero', 'ginger', 'jengibre', 'gingembre',
    'ingwer', 'gengibre', 'prezzemolo', 'parsley', 'perejil', 'persil', 'petersilie', 'salsa fresca', 'salsinha', 'basilico', 'basil', 'albahaca',
    'basilic', 'basilikum', 'manjericao', 'menta', 'mint', 'hierbabuena', 'menthe', 'minze', 'hortela', 'rosmarin', 'romero', 'alecrim', 'salvia',
    'sage', 'salbei', 'sauge', 'timo', 'thyme', 'tomillo', 'thym', 'thymian', 'tomilho', 'erba cipollina', 'chives', 'cebollino', 'ciboulette',
    'schnittlauch', 'cebolinha', 'coriandolo', 'cilantro', 'coriander', 'koriander', 'coentro', 'aneto', 'dill', 'eneldo', 'aneth', 'endro',
    'germogli', 'sprouts', 'germinados', 'germes', 'sprossen', 'germinados', 'mais dolce', 'sweetcorn', 'corn on', 'elote', 'mais ', 'patata dolce',
    'sweet potato', 'boniato', 'patate douce', 'susswasser', 'topinambur', 'rapa', 'turnip', 'nabo', 'navet', 'ruben', 'sedano rapa', 'celeriac',
    'insalata mista', 'mixed salad', 'ensalada', 'salade', 'fresh herbs', 'erbe aromatiche', 'hierbas', 'herbes', 'krauter', 'ervas',
  ],
};

interface Rule {
  stem: string;
  exact: boolean;
  aisle: Exclude<Aisle, 'other'>;
  order: number;
}

const RULES: Rule[] = [];
(Object.keys(DICTIONARY) as (keyof typeof DICTIONARY)[]).forEach((aisle, order) => {
  const seen = new Set<string>();
  for (const raw of DICTIONARY[aisle]) {
    const exact = raw.startsWith('=');
    // gli spazi finali nel dizionario diventano parola esatta
    const trailing = !exact && raw.endsWith(' ');
    const stem = normalizeName(exact ? raw.slice(1) : raw);
    if (!stem || seen.has(stem + (exact || trailing ? '=' : ''))) continue;
    seen.add(stem + (exact || trailing ? '=' : ''));
    RULES.push({ stem, exact: exact || trailing, aisle, order });
  }
});

/** Classifica un nome prodotto in un reparto (deterministico). */
export function classifyAisle(name: string): Aisle {
  const norm = normalizeName(name);
  if (!norm) return 'other';
  const padded = ` ${norm} `;
  const tokens = norm.split(' ');
  let best: Rule | null = null;
  for (const r of RULES) {
    let hit: boolean;
    if (r.stem.includes(' ')) hit = padded.includes(` ${r.stem}`) && (r.exact ? padded.includes(` ${r.stem} `) : true);
    else if (r.exact) hit = tokens.includes(r.stem);
    else hit = tokens.some((t) => t.startsWith(r.stem) || (r.stem.length >= 6 && t.includes(r.stem)));
    if (!hit) continue;
    if (!best || r.stem.length > best.stem.length || (r.stem.length === best.stem.length && r.order < best.order)) best = r;
  }
  return best ? best.aisle : 'other';
}

export interface AisleItem {
  id: string;
  name: string;
}

export interface AisleGroup<T> {
  aisle: Aisle;
  items: T[];
}

/** Reparto effettivo: scelta dell'utente (per nome normalizzato) oppure automatico. */
export function aisleFor(name: string, overrides: ReadonlyMap<string, Aisle> | Record<string, Aisle>): Aisle {
  const key = normalizeName(name);
  const o = overrides instanceof Map ? overrides.get(key) : (overrides as Record<string, Aisle>)[key];
  return o && isAisle(o) ? o : classifyAisle(name);
}

/** Raggruppa per reparto nell'ordine fisso di AISLES; omette i reparti vuoti. */
export function groupByAisle<T extends AisleItem>(items: T[], overrides: ReadonlyMap<string, Aisle> | Record<string, Aisle> = {}): AisleGroup<T>[] {
  const buckets = new Map<Aisle, T[]>();
  for (const it of items) {
    const a = aisleFor(it.name, overrides);
    const list = buckets.get(a);
    if (list) list.push(it);
    else buckets.set(a, [it]);
  }
  return AISLES.filter((a) => buckets.has(a)).map((a) => ({ aisle: a, items: buckets.get(a)! }));
}
