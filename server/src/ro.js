import { premiseBlocks, reentryBlock } from './premises.js';
// Румынские подписи и рекомендации для акта (Proces de recepție a lucrărilor).
// Интерфейс приложения — на русском, документ для заказчика — на румынском.

const map = (dict) => (v) => dict[v] ?? v;

export const roProcedure = map({
  'Дезинсекция': 'Dezinsecție',
  'Дератизация': 'Deratizare',
  'Дезинфекция': 'Dezinfecție',
  'Мониторинг ловушек': 'Monitorizarea capcanelor',
  'Акарицидная обработка': 'Tratament acaricid',
  'Фумигация': 'Fumigare',
});

export const roTarget = map({ rodents: 'Rozătoare', crawling: 'Gândaci / târâtoare', flying: 'Insecte zburătoare' });
export const roCondition = map({ ok: 'În regulă', replaced: 'Înlocuită', damaged: 'Deteriorată', missing: 'Lipsă', no_access: 'Fără acces' });
export const roBait = map({ none: 'Neatinsă', partial: 'Consumată parțial', full: 'Consumată integral' });

export const roPest = map({
  'Тараканы': 'Gândaci de bucătărie',
  'Рыжие тараканы': 'Gândaci roșcați',
  'Чёрные тараканы': 'Gândaci negri',
  'Летающие насекомые': 'Insecte zburătoare',
  'Грызуны': 'Rozătoare',
  'Осы': 'Viespi',
  'Клопы': 'Ploșnițe',
  'Муравьи': 'Furnici',
  'Блохи': 'Purici',
  'Мухи': 'Muște',
  'Моль / кожееды': 'Molii / gândaci de piele',
  'Комары': 'Țânțari',
  'Клещи': 'Căpușe',
  'Другие насекомые': 'Alte insecte',
  'Мыши': 'Șoareci',
  'Крысы': 'Șobolani',
  'Другое': 'Altele',
});

export const roInfestation = map({ none: 'Nu a fost depistată', low: 'Scăzută', medium: 'Medie', high: 'Ridicată', critical: 'Critică' });
export const roPreparation = map({ done: 'Efectuată', partial: 'Parțial', none: 'Neefectuată' });

export const roCategory = map({
  'Подготовка помещения': 'Pregătirea spațiului',
  'Степень заражения': 'Gradul de infestare',
  'Нет доступа': 'Lipsă de acces',
  'Санитарное состояние': 'Starea sanitară',
  'Другое': 'Altele',
});

export const roTrapKind = map({
  'Клеевая ловушка': 'Capcană adezivă',
  'Родентицидная станция': 'Stație rodenticidă',
  'Механическая ловушка': 'Capcană mecanică',
  'Клеевая ловушка (грызуны)': 'Capcană adezivă (rozătoare)',
  'Клеевая ловушка (насекомые)': 'Capcană adezivă (insecte)',
  'Инсектицидная лампа': 'Lampă insecticidă',
  'Феромонная ловушка': 'Capcană cu feromoni',
});

export const roTrapStatus = map({
  ok: 'Fără activitate', activity: 'Activitate', replaced: 'Înlocuită', damaged: 'Deteriorată', missing: 'Lipsă', no_access: 'Fără acces',
});

/* ======================= Рекомендации (RO) ======================= */

const GENERAL_BEFORE = [
  'Pe durata tratamentului, în încăpere nu trebuie să se afle persoane, animale de companie sau păsări.',
  'Produsele alimentare, vesela, obiectele copiilor și de igienă se păstrează în dulapuri închise, frigider sau pungi etanșe.',
  'Acvariile se acoperă etanș, iar compresorul se oprește.',
];
const GENERAL_AFTER = [
  'Reveniți în încăpere nu mai devreme de 2–3 ore, apoi aerisiți cel puțin 30–60 de minute.',
  'Suprafețele care intră în contact cu alimentele (mese, chiuvete, mânere) se spală cu soluție de apă cu săpun și sodă.',
];

const PESTS = {
  'Тараканы': {
    before: [
      'Asigurați accesul la plinte, spațiul de sub chiuvetă, din spatele aragazului, frigiderului și mobilierului de bucătărie.',
      'Toate produsele alimentare se pun în frigider sau în recipiente ermetice; scoateți gunoiul.',
      'Eliminați scurgerile și accesul la apă — gândacii nu supraviețuiesc mult fără apă.',
    ],
    after: [
      'Nu spălați plintele, fisurile și locurile din spatele mobilierului timp de 10–14 zile — preparatul continuă să acționeze.',
      'Nu folosiți pe cont propriu aerosoli sau creioane insecticide — acestea alungă insectele din zonele tratate.',
      'Apariția gândacilor în primele 5–7 zile este normală: ies din ascunzișuri și pier.',
      'Păstrați alimentele închise, scoateți gunoiul zilnic.',
    ],
    repeat: 'Tratament repetat — peste 14–21 de zile: din ooteci ies noi indivizi.',
  },
  'Клопы': {
    before: [
      'Lenjeria de pat, cuverturile, perdelele și hainele din dulapuri se spală la 60 °C sau mai mult ori se ambalează în pungi etanșe.',
      'Îndepărtați paturile, canapelele și dulapurile de perete cu 20–30 cm, scoateți husele detașabile.',
      'Eliberați spațiul de sub paturi și canapele, ridicați lucrurile de pe podea.',
      'Nu mutați mobilierul și lucrurile în alte încăperi înainte de tratament — astfel se răspândesc ploșnițele.',
    ],
    after: [
      'Nu aspirați și nu spălați mobilierul, plintele și îmbinările timp de 10–14 zile.',
      'Se poate și este recomandat să dormiți în patul tratat — ploșnițele ies spre om și pier pe suprafețele tratate.',
      'Lenjeria și hainele curate se readuc după tratamentul repetat.',
    ],
    repeat: 'Tratamentul repetat este obligatoriu — peste 10–14 zile, după eclozarea nimfelor.',
  },
  'Муравьи': {
    before: [
      'Păstrați alimentele, în special dulciurile, în recipiente închise; ștergeți firimiturile și petele lipicioase.',
      'Indicați specialistului locurile unde au fost observate traseele și aglomerările de furnici.',
      'Nu aplicați insecticide pe cont propriu cu 3 zile înainte de vizită.',
    ],
    after: [
      'Nu spălați locurile de aplicare a gelurilor-momeală și traseele timp de 2–4 săptămâni.',
      'Nu lăsați mâncare și apă descoperite — furnicile trebuie să consume momeala.',
    ],
    repeat: 'Control — peste 14–30 de zile: distrugerea coloniei necesită timp.',
  },
  'Блохи': {
    before: [
      'Aspirați temeinic covoarele, mobilierul tapițat, colțurile și fisurile; sacul aspiratorului se aruncă imediat.',
      'Spălați la temperatură înaltă așternuturile animalelor.',
      'Tratați simultan animalele de companie cu un produs veterinar antipurici.',
      'Ridicați lucrurile de pe podea, asigurați accesul la plinte.',
    ],
    after: [
      'Nu spălați podelele și nu aspirați timp de 3–5 zile.',
      'Ulterior aspirați regulat — vibrațiile stimulează ieșirea puricilor din coconi sub acțiunea preparatului.',
    ],
    repeat: 'Tratament repetat — peste 10–14 zile.',
  },
  'Мухи': {
    before: [
      'Scoateți gunoiul, închideți containerele cu capac, eliminați deșeurile alimentare și organice.',
      'Acoperiți alimentele, strângeți vesela.',
    ],
    after: [
      'Instalați plase anti-insecte la ferestre și uși.',
      'Spălați regulat containerele de gunoi, nu lăsați deșeurile peste noapte.',
    ],
    repeat: 'Tratament repetat — la necesitate, peste 7–14 zile.',
  },
  'Моль / кожееды': {
    before: [
      'Eliberați dulapurile, comodele și rafturile; sortați articolele din lână, blană și piele.',
      'Articolele deteriorate se spală la temperatură înaltă, se usucă la soare sau se aruncă.',
      'Aspirați rafturile, colțurile dulapurilor, plintele și spațiul de sub mobilier.',
    ],
    after: [
      'Lucrurile se pun înapoi după aerisirea dulapurilor timp de cel puțin 2–3 ore.',
      'Păstrați lâna și blana în huse, folosiți repelente pentru dulapuri.',
    ],
    repeat: 'Tratament repetat — peste 14–21 de zile.',
  },
  'Комары': {
    before: [
      'Eliminați apa stătătoare: butoaie, găleți, tăvi, burlane înfundate.',
      'Cosiți iarba și curățați vegetația densă din zonele de odihnă.',
    ],
    after: [
      'Nu udați zonele tratate timp de 24 de ore.',
      'Instalați plase anti-țânțari, schimbați regulat apa din recipiente.',
    ],
    repeat: 'Tratament repetat — peste 3–4 săptămâni pe parcursul sezonului.',
  },
  'Клещи': {
    before: [
      'Cosiți iarba, strângeți frunzele uscate și crengile de pe teren.',
      'Îndepărtați de pe teritoriu jucăriile copiilor, rufele, hrana pentru animale.',
    ],
    after: [
      'Nu vă aflați pe terenul tratat și nu lăsați animalele afară timp de 24–48 de ore.',
      'Nu udați și nu cosiți iarba timp de 3–5 zile.',
    ],
    repeat: 'Tratament acaricid repetat — peste 30–45 de zile pe parcursul sezonului.',
  },
  'Другие насекомые': {
    before: ['Asigurați accesul la locurile unde au fost depistate insectele, strângeți alimentele și vesela.'],
    after: ['Nu spălați suprafețele tratate timp de 7–10 zile.'],
    repeat: 'Termenul tratamentului repetat — conform recomandării specialistului.',
  },
  'Мыши': {
    before: [
      'Păstrați alimentele și furajele în recipiente închise din metal, sticlă sau plastic rezistent.',
      'Eliminați accesul la apă, scoateți zilnic gunoiul, închideți containerele.',
      'Etanșați fisurile și orificiile mai mari de 6 mm cu plasă metalică sau ciment, inclusiv în jurul țevilor.',
    ],
    after: [
      'Nu deschideți, nu mutați și nu îndepărtați stațiile de momeală și capcanele.',
      'Nu permiteți accesul copiilor și animalelor de companie la stații.',
      'Anunțați despre urme noi: excremente, rosături, miros.',
    ],
    repeat: 'Controlul capcanelor și înlocuirea momelii — lunar sau conform graficului din contract.',
  },
  'Крысы': {
    before: [
      'Excludeți accesul la hrană și apă: recipiente închise, instalații sanitare funcționale, containere de gunoi închise.',
      'Îndepărtați gunoiul și materialele depozitate lângă pereții clădirii — acestea servesc drept adăpost rozătoarelor.',
      'Etanșați orificiile mai mari de 12 mm cu plasă metalică sau ciment, montați grile la ventilație.',
    ],
    after: [
      'Nu mutați și nu deschideți stațiile de momeală, nu aruncați momeala.',
      'Nu permiteți accesul copiilor și animalelor la stații.',
      'Rozătoarele moarte se strâng cu mănuși; comunicați specialistului locurile unde au fost găsite.',
    ],
    repeat: 'Inspecție de control și reînnoirea momelii — peste 2–4 săptămâni, apoi conform graficului.',
  },
};

PESTS['Рыжие тараканы'] = PESTS['Тараканы'];
PESTS['Чёрные тараканы'] = {
  ...PESTS['Тараканы'],
  before: [
    ...PESTS['Тараканы'].before,
    'Asigurați accesul în subsol, la coloanele de canalizare, sifoane și grilele de ventilație — gândacul negru trăiește în locuri umede.',
  ],
  repeat: 'Tratament repetat — peste 21–30 de zile: gândacul negru se dezvoltă mai lent.',
};
PESTS['Летающие насекомые'] = {
  before: [...PESTS['Мухи'].before, 'Montați plase contra insectelor la ferestre și uși.'],
  after: PESTS['Мухи'].after,
  repeat: PESTS['Мухи'].repeat,
};
PESTS['Грызуны'] = PESTS['Мыши'];
PESTS['Осы'] = {
  before: [
    'Comunicați specialistului unde se află cuibul; nu încercați să-l distrugeți singuri.',
    'Închideți ferestrele, îndepărtați copiii și animalele de companie din zona tratată.',
  ],
  after: [
    'Nu vă apropiați de cuib timp de 24 de ore și nu-l atingeți până când activitatea nu încetează complet.',
    'Nu lăsați afară băuturi dulci, fructe și resturi alimentare — acestea atrag viespile.',
  ],
  repeat: 'Dacă activitatea reapare peste 3–5 zile — tratament repetat.',
};

const DISINFECTION = {
  before: ['Efectuați curățenia, eliberați suprafețele meselor, rafturilor și pervazurilor.', 'Strângeți alimentele, vesela și obiectele personale.'],
  after: [
    'Aerisiți încăperea cel puțin 1 oră după încheierea expoziției.',
    'Suprafețele care intră în contact cu alimentele se clătesc cu apă potabilă.',
    'Periodicitatea — conform cerințelor sanitare și contractului.',
  ],
};

export function buildRecommendationsRo({ procedure, pests = [], infestation, preparation, premises = [], reentry = '' }) {
  const blocks = [];
  const notes = [];
  if (preparation === 'none') notes.push('Spațiul nu a fost pregătit pentru tratament — eficiența poate fi redusă. Este necesară pregătirea spațiului și efectuarea unui tratament repetat.');
  if (preparation === 'partial') notes.push('Pregătirea spațiului a fost efectuată parțial — în locurile inaccesibile eficiența poate fi redusă. Se recomandă înlăturarea neajunsurilor înainte de tratamentul repetat.');
  if (infestation === 'critical') notes.push('Grad critic de infestare: este necesar un curs de 2–3 tratamente și o inspecție de control. Se recomandă verificarea încăperilor adiacente.');
  if (infestation === 'high') notes.push('Grad ridicat de infestare: tratamentul repetat și inspecția de control sunt obligatorii.');
  if (notes.length) blocks.push({ title: 'Important', items: notes, accent: true });
  const re = reentryBlock(reentry, 'ro');
  if (re) blocks.push(re);
  blocks.push(...premiseBlocks(premises, 'ro'));
  const generalAfter = re ? GENERAL_AFTER.slice(1) : GENERAL_AFTER;

  if (procedure === 'Дезинфекция' && !pests.length) {
    blocks.push({ title: 'Pregătirea pentru tratament', items: DISINFECTION.before });
    blocks.push({ title: 'După tratament', items: DISINFECTION.after });
    return blocks;
  }
  for (const p of pests.filter((x) => PESTS[x])) {
    blocks.push({ title: `${roPest(p)}: pregătirea`, items: PESTS[p].before });
    blocks.push({ title: `${roPest(p)}: după tratament`, items: [...PESTS[p].after, PESTS[p].repeat] });
  }
  if (procedure !== 'Дератизация') blocks.push({ title: 'Reguli generale', items: [...GENERAL_BEFORE, ...generalAfter] });
  return blocks;
}

/* ======================= Реквизиты по умолчанию (из бланка) ======================= */

export const DEFAULT_COMPANY = {
  name: 'GARNET-LUX S.R.L.',
  fiscal: '1003600084563',
  seat: 'or. Codru, mun. Chișinău',
  rep: 'Dede Artiom',
  func: 'Administrator',
  tagline: 'DEZINSECȚIE • DERATIZARE • DEZINFECȚIE',
  declarations:
    'Prestatorul a prezentat Beneficiarului toate informațiile privind preparatele insecticide și rodenticide utilizate (denumire comercială, substanță activă, mod de acțiune, riscuri, măsuri de securitate și prim ajutor). Beneficiarul le-a înțeles și acceptat integral. Beneficiarul își asumă expres și permanent obligația de a asigura izolarea completă a spațiilor tratate, menținerea strictă a ordinii, curățeniei și igienei, precum și izolarea etanșă a tuturor produselor alimentare, în vederea obținerii efectului maxim și prevenirii reinfestării. Beneficiarul confirmă că serviciile de dezinsecție, deratizare și/sau dezinfectare au fost executate complet, profesional și conform tehnologiei, normelor și instrucțiunilor aplicabile, au fost recepționate fără nicio obiecție și că a fost informat adecvat asupra tuturor aspectelor intervenției și măsurilor post-tratament. Prin semnarea prezentului act, Beneficiarul declară că nu are și nu va formula pretenție, reclamație sau acțiune împotriva Prestatorului cu privire la serviciile prestate, renunțând irevocabil la orice drept de a solicita despăgubiri, refacerea lucrărilor sau alte remedii, cu excepția cazurilor de dol, culpă gravă sau situații expres prevăzute de lege.',
  // Declarația beneficiarului — обязательный блок Anexa nr. 1 над подписями. {ore} → время без доступа в помещение.
  annex_declaration: [
    'Serviciile au fost prestate integral, în volumul și la calitatea convenite. Nu am obiecții sau pretenții privind calitatea și cantitatea serviciilor prestate și nu voi formula astfel de pretenții în viitor.',
    'Am luat cunoștință de condițiile prestării serviciilor și de recomandările din prezenta anexă și sunt de acord cu acestea.',
    'Am fost informat(ă) despre preparatele utilizate, riscurile și măsurile de siguranță, inclusiv despre interdicția de a reveni în spațiile tratate timp de {ore}, obligația de aerisire și de curățenie ulterioară.',
    'Îmi asum întreaga răspundere pentru orice consecințe asupra sănătății persoanelor și animalelor (inclusiv reacții alergice, intoleranțe, stări de rău) și asupra bunurilor, apărute ca urmare a nerespectării recomandărilor, a accesului prematur în spațiile tratate sau a nedeclarării unor afecțiuni ori sensibilități. În aceste cazuri Prestatorul nu poartă răspundere.',
    'Reapariția dăunătorilor ca urmare a nerespectării recomandărilor sau a reinfestării din spațiile învecinate nu constituie o deficiență a serviciului.',
  ].join('\n'),
};

/** Населённый пункт из адреса: «or. Anenii Noi, str. …» → «or. Anenii Noi» */
export function localityFromAddress(address = '') {
  const first = String(address).split(',')[0].trim();
  // первая часть без цифр — это город/село; иначе (улица с номером дома) — населённый пункт по умолчанию
  if (first && first.length <= 40 && !/\d/.test(first)) return first;
  return process.env.DEFAULT_LOCALITY || 'mun. Chișinău';
}
