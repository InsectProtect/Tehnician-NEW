// ====================================================================================================
// I18N (v49): минимальная инфраструктура перевода интерфейса (RU/RO).
// Полный перевод всего приложения — отдельная большая задача; здесь заложена архитектура (словарь + t()/useI18n()),
// переведены вкладки нижней навигации и несколько самых заметных заголовков/кнопок как основа для дальнейшего расширения.
// Язык хранится на сервере (users.lang, PUT /api/me/lang) и выбирается в Профиле сегментированным переключателем.
// ====================================================================================================

export type Lang = 'ru' | 'ro';

type Dict = Record<string, string>;

const ru: Dict = {
  tab_today: 'Сегодня',
  tab_inbox: 'Входящие',
  tab_league: 'Лига',
  tab_car: 'Авто',
  tab_profile: 'Профиль',
  profile_title: 'Профиль',
  profile_settings: 'Настройки',
  profile_theme: 'Тема оформления',
  profile_language: 'Язык интерфейса',
  profile_notifications: 'Уведомления и замечания',
  profile_kpi_history: 'История KPI по месяцам',
  car_title: 'Мой авто',
  staff_title: 'Сотрудники',
  save: 'Сохранить',
  cancel: 'Отмена',
  delete: 'Удалить',
};

const ro: Dict = {
  tab_today: 'Astăzi',
  tab_inbox: 'Mesaje',
  tab_league: 'Liga',
  tab_car: 'Mașina',
  tab_profile: 'Profil',
  profile_title: 'Profil',
  profile_settings: 'Setări',
  profile_theme: 'Temă',
  profile_language: 'Limba interfeței',
  profile_notifications: 'Notificări și observații',
  profile_kpi_history: 'Istoricul KPI pe luni',
  car_title: 'Mașina mea',
  staff_title: 'Angajați',
  save: 'Salvează',
  cancel: 'Anulează',
  delete: 'Șterge',
};

const DICTS: Record<Lang, Dict> = { ru, ro };

/** Перевод по ключу; при отсутствии ключа в словаре языка — русский текст (полный словарь не обязателен). */
export function t(key: string, lang: Lang = 'ru'): string {
  return DICTS[lang]?.[key] ?? DICTS.ru[key] ?? key;
}

/** Хук: t() уже привязан к языку пользователя (см. useConfig().user.lang). Использование: const tr = useI18n(); tr('tab_today'). */
export function makeT(lang: Lang) {
  return (key: string) => t(key, lang);
}
