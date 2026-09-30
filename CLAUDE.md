# Памятка для Claude — Telegram Mini App для дезинсекторов (InsectProtect / GARNET-LUX S.R.L.)

Отвечай пользователю **по-русски**, коротко и по делу. Пользователь работает с телефона/планшета.

## Проект
- Монорепозиторий: `server/` (Node, без фреймворка, Postgres на Render / SQLite локально) и `web/` (React + TypeScript + Tailwind v4, Vite → `web/dist`).
- Деплой: Render автоматически собирает ветку `main` этого репозитория. Секреты — только через переменные окружения Render (`process.env`), никогда в коде.
- Подробное описание всех функций — `README.md` (держи его актуальным при каждом изменении).
- Дизайн «InsectProtect × Nothing»: Apple-подобный, скругления, много воздуха, иконки lucide-react. Повышенный коэффициент — фиолетовый (#AF52DE).

## Android APK
- `mobile/` — обёртка Capacitor (грузит сайт с Render), сборка — GitHub Actions `.github/workflows/android.yml`, APK в Releases.
- Вход вне Telegram: `POST /api/app/login` → бот `/start applogin_<код>` → «✅ Войти» → токен `Authorization: app <token>` (auth.js `makeAppToken`), далее PIN.

## Версии
- Видимая версия: `APP_VERSION` в `web/src/screens/Home.tsx` (формат `YYYY.MM.DD-vNN`). Увеличивай при каждом релизе — пользователь проверяет её в Настройках после деплоя.
- Последняя версия на момент переноса: `2026.09.30-v49`.

## Как устроен сервер (server/src/index.js)
- Маршруты: `route(method, pattern, handler, { access: 'admin' })`; ошибки — `must(cond, status, msg)` / `HttpError` (поле `extra` уходит в JSON).
- Роли: `admin` (владелец, всё), `manager` (админ с правами `perms`: tasks, jobs, media, kpi, reports, staff, settings, audit — проверка в `permFor`), `tech` (дезинсектор), `specialist`.
- Подключаемые функции: `features()` (team, job_reviewer, managers, contest, one_open, game, geo_shift, require_geo_start).
- Настройки: `getSetting` / `setSetting`; журнал — `audit()`; уведомления — `addNotification`, `notifyTech`, `notifyAdmins`.
- Миграции: новые таблицы — в SCHEMA (`CREATE TABLE IF NOT EXISTS`), новые колонки — строкой `ALTER TABLE …` в массиве MIGRATIONS в `db.js`.
- Баллы: `calcPoints` = (категория/удалённость + вечер) × коэффициент вредителя × повышенный коэффициент (день недели/период/вручную). Команда: баллы каждому полностью, стоимость заказа делится (`syncTeamShares`, kpi_adjust rule 'team').
- «Кто заберёт»: заявки/поручения со status 'open' и audience (all/tech/specialist/manager), `claimTask`/`claimJob`, бонус `claim_bonus` (kpi_adjust rule 'claim'). Объявления — таблицы announcements/announcement_acks.
- Оплата выезда: visits.payment (cash|transfer|none|multi), pay_amount, pay_note — обязательна в /finish (`parsePayment`), видна в офисе (`paymentText`) и /api/admin/done (cash, pay_counts).
- Большие файлы: `storage.js` (S3 SigV4 presign, без зависимостей). Если заданы S3_*: /api/media/start → PUT в хранилище → /complete (так же /api/jobs/:id/files/start|complete); media_posts.storage_key/msg_text, job_files.storage_key/ready. Без S3 — как раньше через Telegram (50 МБ).
- Игра: `awardXp` (xp_events, уникально tg_id+ref), `gameState` (уровни, квесты, серии, значки) → /api/me/game. Смена в эфире: live location боту → `handleLocation` (geo_live), `geoTick` (+10 XP/час), `geoMorningTick`, /api/tasks/:id/route, /api/admin/live, `applyShiftGeo`. Входящие: `inboxFor` → /api/inbox, /api/inbox/ack. Фронтенд сотрудника — screens/Play.tsx (PlayProvider, TabBar, AlertOverlay, RewardSheet, RouteCard, LiveWidget), components/game.tsx (TileMap без библиотек).
- Контроль баллов: `guardCheck`/`guardVisit` (после /finish, в фоне), таблица point_flags (new|ok|fixed), настройки `point_guard`, итог дня `guardDigestTick`, callback `pgok:`, API /api/admin/guard*.
- KPI менеджеров (server/src/sales.js, `initSales(ctx)`): настройки в setting `mgr_kpi` ({managers:{tg:cfg}, gaps, coach, game}), `calc()` = формула из таблицы (премия = выручка × ставка × K_KPI × K), таблицы task_gaps / mgr_calls / mgr_facts, tasks.author_id; тик раз в минуту — ошибки в заявках (нет адреса/даты/времени/телефона в ЛЮБОЙ активной заявке → `gapRecipients`: менеджер-автор, иначе все менеджеры, иначе админы; task_gaps.msg_id — JSON {tg: msg}), перезвоны, утренний коуч. API /api/mgr/*, /api/tasks/:id/fill, /api/admin/sales* (только главный админ). Фронтенд — screens/Sales.tsx (вкладка «Продажи», MgrHero на «Обзоре» менеджера, ?sales=calls|me из кнопок бота).
- Повышенный коэффициент: weekday[7], special[] (даты), windows[] (дни + время «с–до», `inWindow`).
- Удалённость — только по геолокации: `autoZone(v)` (офис задал → как задал; есть geo_km → `zoneFromKm`; нет → 'city'). Дезинсектор зону не выбирает (PATCH игнорирует point_zone от не-админа), /finish пересчитывает. Быстрый акт: infestation 'medium', preparation 'done' по умолчанию. «Кто где»: /api/admin/live отдаёт last (последняя точка) и site (объект/адрес), WhereSheet в Play.tsx.

- v47: комнаты из заявки — rooms_disputes, `decideRooms`, callbacks rmok:/rmset:, RoomsDisputesWidget (screens/Rooms.tsx), RoomsFromTask в Visit.tsx. «Мой авто» — server/src/car.js (`initCar`: cars, car_fuel, car_service, car_checks, car_photos; setting car_cfg, car_plan; фото — base64 в БД, отдаются по /r/car/f|p/:id с подписью; callbacks carok:/carbad:), ИИ — server/src/ai.js (`aiJson`), но с v48 в car.js выключен по решению владельца (aiOn = () => false): фото подтверждает менеджер/админ, сумма и литры вводятся вручную. Фронтенд: screens/Car.tsx (CarScreen — вкладка «Авто» в TabBar; CarsPanel — вкладка админки «Автопарк»), ?car=check / ?cars=review.
- v49: **удаление сотрудника** — `DELETE /api/admin/users/:id` (только главный админ удаляет admin/manager, себя нельзя, hard-delete без каскада истории), кнопка в StaffSheet (screens/Staff.tsx). **Удаление авто** — таблица `car_delete_requests` (status new/pending→approved/rejected, msgs — JSON тек:msg_id), в car.js: `POST /api/car/delete-request` (техник → уведомление менеджерам/админу с callback `cardelok:`/`cardelno:`, решает `decideCarDelete`), `DELETE /api/admin/cars/:tg` (админ/менеджер с правом kpi — сразу), `POST /api/admin/car-delete-requests/:id`; UI в Car.tsx (CarScreen — «Удалить авто», CarsPanel — очередь запросов, FleetCarSheet — прямое удаление). **Обязательная геолокация** — фича `require_geo_start` (DEFAULT_FEATURES), проверка в /api/tasks/:id/start (`geoFresh(geo_live)`) и /api/visits/:id/finish (`v.geo_km != null` после `applyShiftGeo`), переключатель в Admin.tsx FEATURE_LIST. **Штрафы менеджеров** — каталог `PENALTIES` в sales.js (по образцу SUPERS, пока один тип `late_dispatch`), таблица `mgr_penalties` (task_id+penalty_id уникально), `PENALTY_EVALUATORS` — маппинг id→функция-проверка (сейчас только `evalLateDispatch`: tasks.sent_at − tasks.created_at > cfg.penalties.late_dispatch.param мин), `penaltyTick()` в общем `tick()`, штраф идёт в `fine` наравне с gap_fine, `/api/admin/sales` отдаёт `penalties` (каталог) и `full()` — активные штрафы менеджера; UI — карточка «Штрафы» в Sales.tsx ConfigEditor (по образцу супер-бонусов), строки в PayoutCard. **CRM-коннектор** — server/src/crm.js (`initCrm(ctx)`, провайдеры в `PROVIDERS`, сейчас только `amocrm`), настройка `crm_cfg` (provider/enabled/amocrm.domain+access_token — только в БД, без ENV), `tasks.crm_lead_id` (`PUT /api/tasks/:id/crm-lead`, поле CrmLeadField в Tasks.tsx), маршруты `/api/admin/crm` (GET/PUT/disconnect, только владелец), UI CrmSheet.tsx (из Admin.tsx → «Интеграции» → «CRM»); хук `crm.onVisitDone()` вызывается в /finish при наличии crm_lead_id — best-effort (лид → «успешно реализовано» + прикреплён PDF акта), ошибки не блокируют завершение, уведомляют админа. **Язык интерфейса** — `users.lang` ('ru'|'ro', default 'ru'), `PUT /api/me/lang`, web/src/i18n.ts (словарь + `t()`/`makeT()`), переключатель `LanguageCard` в Play.tsx ProfileScreen (сохраняет и делает `window.location.reload()` — контекст `ConfigCtx` не даёт обновить язык без перезагрузки), переведены вкладки TabBar.

## Проверка перед коммитом
- Сервер: `node --check server/src/index.js`, запуск локально:
  `PORT=4000 DEV_AUTH=1 BOT_TOKEN=123:abc REPORT_SECRET=x SQLITE_FILE=/tmp/t.sqlite node server/src/index.js`
  (DEV_AUTH=1 — вход через заголовок `x-dev-user: <tg_id>`).
- Фронтенд: `cd web && npm ci && npx tsc --noEmit && npm run build`.
- Хуки React — только до любых `return` в компоненте.

## Коммиты
- Коммить в `main` (Render деплоит `main`), сообщение: `vNN — что сделано`.
- После пуша напиши пользователю, что изменилось, и номер версии для проверки.
