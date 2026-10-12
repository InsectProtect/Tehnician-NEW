/** Локаль дат и чисел (v82): 'ru-RU' или 'ro-RO' — живая привязка, меняется при включении румынского. */
export let LOC = 'ru-RU';
export function setLocale(lang: 'ru' | 'ro') { LOC = lang === 'ro' ? 'ro-RO' : 'ru-RU'; }
