// Типы помещений и время отсутствия людей после обработки — влияют на рекомендации заказчику (RU и RO).

export const PREMISES = [
  {
    id: 'living', label: 'Квартира / частный дом', ro: 'Apartament / casă de locuit',
    before: [
      'Убрать продукты, посуду, зубные щётки, детские игрушки и корм животных в закрытые шкафы или холодильник.',
      'Отодвинуть мебель от стен, освободить доступ к плинтусам, под раковину, за плиту и холодильник.',
      'Вывести из квартиры детей, беременных, пожилых и домашних животных; аквариум накрыть и выключить компрессор.',
    ],
    after: [
      'Протереть мыльно-содовым раствором только поверхности, с которыми контактируют руки и продукты: столы, ручки, выключатели.',
      'Постельное бельё и детские вещи, оказавшиеся в зоне обработки, постирать.',
    ],
    beforeRo: [
      'Puneți alimentele, veselă, periuțele de dinți, jucăriile copiilor și hrana animalelor în dulapuri închise sau în frigider.',
      'Îndepărtați mobilierul de la pereți, asigurați accesul la plinte, sub chiuvetă, în spatele aragazului și al frigiderului.',
      'Scoateți din apartament copiii, femeile însărcinate, persoanele în vârstă și animalele de companie; acoperiți acvariul și opriți compresorul.',
    ],
    afterRo: [
      'Spălați cu soluție de apă cu săpun și sodă doar suprafețele cu care intră în contact mâinile și alimentele: mese, mânere, întrerupătoare.',
      'Spălați lenjeria de pat și lucrurile copiilor care s-au aflat în zona tratată.',
    ],
  },
  {
    id: 'horeca', label: 'Кухня / кафе / ресторан', ro: 'Bucătărie / cafenea / restaurant',
    before: [
      'Обработку проводить после закрытия или в санитарный день; остановить приготовление пищи.',
      'Убрать продукты, полуфабрикаты и открытую тару в холодильные камеры или закрытые контейнеры; накрыть плёнкой рабочие столы.',
      'Освободить доступ к зонам за и под оборудованием: плиты, посудомоечные машины, мармиты, холодильные витрины, мойки.',
      'Вынести мусор, очистить жироуловители и трапы.',
    ],
    after: [
      'Перед началом работы вымыть все рабочие поверхности, разделочные доски и посуду, контактирующие с пищей.',
      'Не мыть плинтусы, щели и зоны за оборудованием 10–14 дней — препарат продолжает действовать.',
      'Ежедневно убирать остатки пищи и жир под оборудованием, не оставлять открытую еду и воду на ночь.',
    ],
    beforeRo: [
      'Tratamentul se efectuează după închidere sau în ziua sanitară; se oprește prepararea alimentelor.',
      'Puneți alimentele, semipreparatele și recipientele deschise în camere frigorifice sau recipiente închise; acoperiți mesele de lucru cu folie.',
      'Asigurați accesul în spatele și sub echipamente: plite, mașini de spălat vase, vitrine frigorifice, chiuvete.',
      'Scoateți gunoiul, curățați separatoarele de grăsimi și sifoanele de pardoseală.',
    ],
    afterRo: [
      'Înainte de începerea lucrului spălați toate suprafețele de lucru, tocătoarele și vesela care intră în contact cu alimentele.',
      'Nu spălați plintele, fisurile și zonele din spatele echipamentelor timp de 10–14 zile — preparatul continuă să acționeze.',
      'Zilnic curățați resturile de alimente și grăsimea de sub echipamente, nu lăsați mâncare și apă deschise peste noapte.',
    ],
  },
  {
    id: 'food_prod', label: 'Пищевое производство / склад продуктов', ro: 'Producție alimentară / depozit de alimente',
    before: [
      'Продукцию и сырьё в открытом виде убрать из зоны обработки или плотно укрыть плёнкой.',
      'Остановить линии, закрыть технологические ёмкости; предупредить службу качества (HACCP).',
      'Освободить проходы вдоль стен на 50 см для доступа к периметру.',
    ],
    after: [
      'Перед пуском линий провести санитарную обработку оборудования, контактирующего с продукцией.',
      'Зафиксировать обработку в журнале HACCP, сохранить акт и журнал мониторинга.',
      'Не перемещать и не открывать станции мониторинга; о повреждённых сообщать исполнителю.',
    ],
    beforeRo: [
      'Produsele și materia primă deschise se scot din zona tratată sau se acoperă etanș cu folie.',
      'Opriți liniile, închideți recipientele tehnologice; informați serviciul de calitate (HACCP).',
      'Eliberați culoarele de-a lungul pereților pe 50 cm pentru acces la perimetru.',
    ],
    afterRo: [
      'Înainte de pornirea liniilor efectuați igienizarea echipamentelor care intră în contact cu produsele.',
      'Înregistrați tratamentul în registrul HACCP, păstrați procesul-verbal și jurnalul de monitorizare.',
      'Nu mutați și nu deschideți stațiile de monitorizare; comunicați executantului despre cele deteriorate.',
    ],
  },
  {
    id: 'warehouse', label: 'Склад (непищевой)', ro: 'Depozit (nealimentar)',
    before: [
      'Освободить доступ к периметру стен, углам и зонам под стеллажами.',
      'Упаковку и товар, чувствительные к влаге, укрыть плёнкой.',
    ],
    after: [
      'Не проводить влажную уборку по периметру 7–10 дней.',
      'Поддерживать порядок: не хранить картон и мусор у стен — это укрытия для вредителей.',
    ],
    beforeRo: [
      'Asigurați accesul la perimetrul pereților, colțuri și zonele de sub rafturi.',
      'Acoperiți cu folie ambalajele și mărfurile sensibile la umiditate.',
    ],
    afterRo: [
      'Nu efectuați curățenie umedă pe perimetru timp de 7–10 zile.',
      'Mențineți ordinea: nu depozitați carton și gunoi lângă pereți — acestea sunt adăposturi pentru dăunători.',
    ],
  },
  {
    id: 'office', label: 'Офис', ro: 'Birou',
    before: [
      'Обработку проводить в нерабочее время; убрать еду из ящиков столов и с кухни офиса.',
      'Закрыть и накрыть оргтехнику, освободить доступ к кухонной зоне и санузлам.',
    ],
    after: [
      'Перед началом рабочего дня проветрить помещение и протереть рабочие столы.',
      'Не хранить еду в столах, ежедневно выносить мусор с кухни.',
    ],
    beforeRo: [
      'Tratamentul se efectuează în afara orelor de lucru; scoateți alimentele din sertarele birourilor și din bucătăria oficiului.',
      'Închideți și acoperiți tehnica de birou, asigurați accesul la zona de bucătărie și la grupurile sanitare.',
    ],
    afterRo: [
      'Înainte de începerea zilei de lucru aerisiți încăperea și ștergeți birourile.',
      'Nu păstrați alimente în birouri, scoateți zilnic gunoiul din bucătărie.',
    ],
  },
  {
    id: 'retail', label: 'Магазин / торговый зал', ro: 'Magazin / sală comercială',
    before: [
      'Обработку проводить после закрытия; открытые продукты убрать или накрыть.',
      'Освободить доступ к зонам за холодильным оборудованием и под стеллажами.',
    ],
    after: [
      'Перед открытием проветрить зал и протереть прилавки и корзины.',
      'Проверять поступающий товар и тару — через них часто заносятся вредители.',
    ],
    beforeRo: [
      'Tratamentul se efectuează după închidere; produsele deschise se scot sau se acoperă.',
      'Asigurați accesul la zonele din spatele echipamentelor frigorifice și sub rafturi.',
    ],
    afterRo: [
      'Înainte de deschidere aerisiți sala și ștergeți tejghelele și coșurile.',
      'Verificați marfa și ambalajele primite — prin ele deseori sunt aduși dăunătorii.',
    ],
  },
  {
    id: 'hotel', label: 'Гостиница / хостел / общежитие', ro: 'Hotel / hostel / cămin',
    before: [
      'Освободить номера на время обработки; снять постельное бельё и шторы.',
      'Кровати и мягкую мебель отодвинуть от стен, открыть шкафы и тумбы.',
    ],
    after: [
      'Бельё и текстиль из обработанных номеров стирать при 60 °C и выше.',
      'Заселять номера после проветривания; при жалобах гостей сразу сообщать исполнителю.',
    ],
    beforeRo: [
      'Eliberați camerele pe durata tratamentului; scoateți lenjeria de pat și draperiile.',
      'Îndepărtați paturile și mobilierul tapițat de la pereți, deschideți dulapurile și noptierele.',
    ],
    afterRo: [
      'Lenjeria și textilele din camerele tratate se spală la 60 °C și mai mult.',
      'Cazați oaspeți după aerisire; la reclamațiile oaspeților anunțați imediat executantul.',
    ],
  },
  {
    id: 'kids_med', label: 'Детское / медицинское учреждение', ro: 'Instituție pentru copii / medicală',
    before: [
      'Обработку проводить только в отсутствие детей и пациентов (выходные, санитарный день).',
      'Убрать игрушки, постельные принадлежности, медикаменты и расходные материалы в закрытые шкафы.',
    ],
    after: [
      'До прихода детей или пациентов провести влажную уборку поверхностей, доступных для контакта, и проветрить помещения.',
      'Игрушки и предметы ухода, находившиеся в зоне обработки, вымыть.',
    ],
    beforeRo: [
      'Tratamentul se efectuează doar în lipsa copiilor și a pacienților (zile de odihnă, zi sanitară).',
      'Puneți jucăriile, lenjeria, medicamentele și consumabilele în dulapuri închise.',
    ],
    afterRo: [
      'Până la venirea copiilor sau a pacienților efectuați curățenia umedă a suprafețelor accesibile și aerisiți încăperile.',
      'Spălați jucăriile și obiectele de îngrijire care s-au aflat în zona tratată.',
    ],
  },
  {
    id: 'basement', label: 'Подвал / техпомещение', ro: 'Subsol / încăpere tehnică',
    before: [
      'Обеспечить доступ к коммуникациям, стоякам, приямкам и вентиляции.',
      'Убрать мусор и хлам, устранить протечки и стоячую воду.',
    ],
    after: [
      'Закрыть подвальные окна и продухи сеткой, держать двери закрытыми.',
      'Поддерживать сухость — влажность привлекает тараканов, блох и комаров.',
    ],
    beforeRo: [
      'Asigurați accesul la comunicații, coloane, cămine și ventilație.',
      'Scoateți gunoiul și obiectele inutile, eliminați scurgerile și apa stătătoare.',
    ],
    afterRo: [
      'Închideți ferestrele și gurile de aerisire ale subsolului cu plasă, țineți ușile închise.',
      'Mențineți uscăciunea — umiditatea atrage gândacii, puricii și țânțarii.',
    ],
  },
];

/** Сколько нельзя находиться в помещении после обработки. */
export const REENTRY = [
  { id: '2-3', label: '2–3 часа', ru: '2–3 часа', ro: '2–3 ore' },
  { id: '4-6', label: '4–6 часов', ru: '4–6 часов', ro: '4–6 ore' },
  { id: '12-24', label: '12–24 часа', ru: '12–24 часа', ro: '12–24 de ore' },
  { id: '24-48', label: '24–48 часов', ru: '24–48 часов', ro: '24–48 de ore' },
];
const RANK = { '2-3': 1, '4-6': 2, '12-24': 3, '24-48': 4 };

/** По вредителям: тараканы и блохи — 4–6 ч, клопы — 12–24 ч, остальное — 2–3 ч. */
export function reentryDefault(procedure, pests = []) {
  if (procedure === 'Дератизация') return '';
  let best = '2-3';
  for (const p of pests) {
    const r = p === 'Клопы' ? '12-24' : /тарак|Блохи/i.test(p) ? '4-6' : '2-3';
    if (RANK[r] > RANK[best]) best = r;
  }
  return best;
}

export const reentryOf = (id) => REENTRY.find((r) => r.id === id) || null;

export function premiseBlocks(ids = [], lang = 'ru') {
  const out = [];
  for (const p of PREMISES.filter((x) => ids.includes(x.id))) {
    const name = lang === 'ro' ? p.ro : p.label;
    out.push({ title: lang === 'ro' ? `${name}: pregătirea` : `${name}: подготовка`, items: lang === 'ro' ? p.beforeRo : p.before });
    out.push({ title: lang === 'ro' ? `${name}: după tratament` : `${name}: после обработки`, items: lang === 'ro' ? p.afterRo : p.after });
  }
  return out;
}

export function reentryBlock(id, lang = 'ru') {
  const r = reentryOf(id);
  if (!r) return null;
  return lang === 'ro'
    ? { title: 'Accesul în încăpere', items: [`Nu vă aflați în încăperea tratată timp de ${r.ro} după tratament. Apoi aerisiți cel puțin 30–60 de minute.`], accent: true }
    : { title: 'Время отсутствия', items: [`Не находиться в обработанном помещении ${r.ru} после обработки. Затем проветрить не менее 30–60 минут.`], accent: true };
}
