// Слой БД: PostgreSQL на Render (DATABASE_URL), встроенный SQLite локально.
// SQL пишем в стиле Postgres ($1, $2 …) — для SQLite плейсхолдеры переводятся в ?1, ?2 …
import path from 'node:path';
import fs from 'node:fs';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  tg_id      TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  tg_name    TEXT NOT NULL DEFAULT '',
  username   TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  role       TEXT NOT NULL DEFAULT 'tech',
  status     TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  last_seen  TEXT
);

CREATE TABLE IF NOT EXISTS invites (
  code       TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'tech',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used_by    TEXT,
  used_at    TEXT
);

CREATE TABLE IF NOT EXISTS audit (
  id         TEXT PRIMARY KEY,
  at         TEXT NOT NULL,
  actor_id   TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action     TEXT NOT NULL,
  target     TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS audit_at_idx ON audit (at);

CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  task_no      INTEGER NOT NULL,
  tech_tg_id   TEXT NOT NULL,
  company_name TEXT NOT NULL DEFAULT '',
  address      TEXT NOT NULL DEFAULT '',
  planned_at   TEXT,
  has_time     INTEGER NOT NULL DEFAULT 0,
  procedure    TEXT NOT NULL DEFAULT '',
  pests        TEXT NOT NULL DEFAULT '[]',
  phone        TEXT NOT NULL DEFAULT '',
  comment      TEXT NOT NULL DEFAULT '',
  area         TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL DEFAULT 'new',
  visit_id     TEXT,
  chat_id      TEXT,
  thread_id    TEXT,
  message_id   TEXT,
  confirm_id   TEXT,
  author       TEXT NOT NULL DEFAULT '',
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS tasks_tech_idx ON tasks (tech_tg_id, status);

CREATE TABLE IF NOT EXISTS notifications (
  id          TEXT PRIMARY KEY,
  tg_id       TEXT NOT NULL,
  kind        TEXT NOT NULL,
  text        TEXT NOT NULL,
  visit_id    TEXT,
  task_id     TEXT,
  author_id   TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL,
  read_at     TEXT
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (tg_id, created_at);
CREATE TABLE IF NOT EXISTS office_calls (
  id         TEXT PRIMARY KEY,
  tg_id      TEXT NOT NULL,
  by_id      TEXT NOT NULL DEFAULT '',
  by_name    TEXT NOT NULL DEFAULT '',
  note       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  last_at    TEXT,
  count      INTEGER NOT NULL DEFAULT 0,
  msg_id     TEXT,
  ack_at     TEXT,
  cancelled_at TEXT
);
CREATE TABLE IF NOT EXISTS announcements (
  id          TEXT PRIMARY KEY,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  color       TEXT NOT NULL DEFAULT 'info',
  audience    TEXT NOT NULL DEFAULT 'all',
  author_id   TEXT NOT NULL DEFAULT '',
  author_name TEXT NOT NULL DEFAULT '',
  expires_at  TEXT,
  created_at  TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS announcement_acks (
  ann_id TEXT NOT NULL,
  tg_id  TEXT NOT NULL,
  at     TEXT NOT NULL,
  PRIMARY KEY (ann_id, tg_id)
);
CREATE TABLE IF NOT EXISTS app_logins (
  code       TEXT PRIMARY KEY,
  status     TEXT NOT NULL DEFAULT 'pending',
  tg_id      TEXT,
  device     TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_files (
  id         TEXT PRIMARY KEY,
  job_id     TEXT NOT NULL,
  tg_id      TEXT NOT NULL,
  name       TEXT NOT NULL DEFAULT '',
  mime       TEXT NOT NULL DEFAULT '',
  size       INTEGER NOT NULL DEFAULT 0,
  file_id    TEXT NOT NULL DEFAULT '',
  kind       TEXT NOT NULL DEFAULT 'document',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS job_files_job_idx ON job_files (job_id);
CREATE TABLE IF NOT EXISTS jobs (
  id           TEXT PRIMARY KEY,
  job_no       INTEGER NOT NULL,
  tg_id        TEXT NOT NULL,
  title        TEXT NOT NULL,
  descr        TEXT NOT NULL DEFAULT '',
  due_at       TEXT,
  points       REAL NOT NULL DEFAULT 0,
  target       INTEGER,
  done_count   INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'new',
  report       TEXT NOT NULL DEFAULT '',
  admin_note   TEXT NOT NULL DEFAULT '',
  author_id    TEXT NOT NULL DEFAULT '',
  author_name  TEXT NOT NULL DEFAULT '',
  ack_at       TEXT,
  submitted_at TEXT,
  decided_at   TEXT,
  decided_by   TEXT NOT NULL DEFAULT '',
  awarded      REAL,
  adjust_id    TEXT,
  due_reminded TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS jobs_user_idx ON jobs (tg_id, status);
CREATE TABLE IF NOT EXISTS media_posts (
  id         TEXT PRIMARY KEY,
  tg_id      TEXT NOT NULL,
  visit_id   TEXT,
  kind       TEXT NOT NULL,
  mime       TEXT NOT NULL DEFAULT '',
  size       INTEGER NOT NULL DEFAULT 0,
  file_id    TEXT NOT NULL DEFAULT '',
  thumb_id   TEXT NOT NULL DEFAULT '',
  caption    TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'proposed',
  points     REAL,
  adjust_id  TEXT,
  chat_id    TEXT,
  msg_id     TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS coach_msgs (
  id         TEXT PRIMARY KEY,
  week       TEXT NOT NULL,
  tg_id      TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'improve',
  text       TEXT NOT NULL,
  metrics    TEXT NOT NULL DEFAULT '{}',
  status     TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS kpi_adjust (
  id         TEXT PRIMARY KEY,
  month      TEXT NOT NULL,
  tg_id      TEXT NOT NULL,
  rule       TEXT NOT NULL DEFAULT 'manual',
  points     REAL NOT NULL,
  reason     TEXT NOT NULL DEFAULT '',
  status     TEXT NOT NULL DEFAULT 'proposed',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  decided_by TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS kpi_plans (
  month      TEXT NOT NULL,
  tg_id      TEXT NOT NULL,
  points     REAL,
  sent_at    TEXT,
  msg_id     TEXT,
  remind_at  TEXT,
  remind_count INTEGER NOT NULL DEFAULT 0,
  ack_at     TEXT,
  PRIMARY KEY (month, tg_id)
);

CREATE TABLE IF NOT EXISTS tg_chats (
  id         TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  type       TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS clients (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  inn        TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  contact    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS objects (
  id           TEXT PRIMARY KEY,
  company_id   TEXT NOT NULL,
  company_name TEXT NOT NULL,
  address      TEXT NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS objects_company_idx ON objects (company_id);

CREATE TABLE IF NOT EXISTS traps (
  id         TEXT PRIMARY KEY,
  code       TEXT NOT NULL UNIQUE,
  object_id  TEXT NOT NULL REFERENCES objects(id),
  number     INTEGER NOT NULL,
  kind       TEXT NOT NULL,
  location   TEXT NOT NULL DEFAULT '',
  active     INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS traps_object_idx ON traps (object_id);

CREATE TABLE IF NOT EXISTS visits (
  id           TEXT PRIMARY KEY,
  object_id    TEXT NOT NULL REFERENCES objects(id),
  company_id   TEXT NOT NULL,
  company_name TEXT NOT NULL,
  address      TEXT NOT NULL,
  procedure    TEXT NOT NULL,
  tech_tg_id   TEXT NOT NULL,
  tech_name    TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'open',
  comment      TEXT NOT NULL DEFAULT '',
  amo_note_id  TEXT,
  lead_id      TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);
CREATE INDEX IF NOT EXISTS visits_started_idx ON visits (started_at);

CREATE TABLE IF NOT EXISTS inspections (
  id            TEXT PRIMARY KEY,
  visit_id      TEXT NOT NULL REFERENCES visits(id),
  trap_id       TEXT NOT NULL REFERENCES traps(id),
  status        TEXT NOT NULL,
  pest          TEXT NOT NULL DEFAULT '',
  count         INTEGER NOT NULL DEFAULT 0,
  bait_replaced INTEGER NOT NULL DEFAULT 0,
  comment       TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  UNIQUE (visit_id, trap_id)
);
CREATE INDEX IF NOT EXISTS inspections_trap_idx ON inspections (trap_id);

CREATE TABLE IF NOT EXISTS observations (
  id         TEXT PRIMARY KEY,
  visit_id   TEXT NOT NULL REFERENCES visits(id),
  category   TEXT NOT NULL,
  comment    TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS observations_visit_idx ON observations (visit_id);

CREATE TABLE IF NOT EXISTS photos (
  id             TEXT PRIMARY KEY,
  observation_id TEXT NOT NULL REFERENCES observations(id),
  visit_id       TEXT NOT NULL,
  mime           TEXT NOT NULL,
  data           TEXT NOT NULL,
  created_at     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS photos_obs_idx ON photos (observation_id);
`;

// Миграции для баз, созданных предыдущими версиями
const MIGRATIONS = [
  'ALTER TABLE visits ADD COLUMN lead_id TEXT',
  'CREATE INDEX IF NOT EXISTS visits_lead_idx ON visits (lead_id)',
  "ALTER TABLE visits ADD COLUMN infestation TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN preparation TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN office_sent_at TEXT',
  "ALTER TABLE visits ADD COLUMN pests TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN revision INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN pin_hash TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE users ADD COLUMN pin_fails INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE users ADD COLUMN pin_locked_until TEXT',
  "ALTER TABLE clients ADD COLUMN legal_address TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE clients ADD COLUMN rep_function TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN area TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN location TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN products TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN client_rep TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN client_rep_function TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN locality TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN act_seq INTEGER',
  'ALTER TABLE visits ADD COLUMN task_id TEXT',
  'ALTER TABLE visits ADD COLUMN office_msg_id TEXT',
  "ALTER TABLE traps ADD COLUMN target TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN ack_at TEXT',
  "ALTER TABLE visits ADD COLUMN premises TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE visits ADD COLUMN reentry TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN archived_at TEXT',
  "ALTER TABLE visits ADD COLUMN approval TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN approval_note TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN approved_by TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN unplanned_reason TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN rooms INTEGER',
  'ALTER TABLE visits ADD COLUMN client_signature TEXT',
  "ALTER TABLE tasks ADD COLUMN call_status TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN call_at TEXT',
  'ALTER TABLE tasks ADD COLUMN en_route_at TEXT',
  'ALTER TABLE tasks ADD COLUMN call_undo INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN rooms INTEGER',
  "ALTER TABLE tasks ADD COLUMN stage TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN price REAL',
  "ALTER TABLE visits ADD COLUMN stage TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN price REAL',
  'ALTER TABLE tasks ADD COLUMN route_undo INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN start_undo INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE visits ADD COLUMN annul_req INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN soon_at TEXT',
  'ALTER TABLE tasks ADD COLUMN soon_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN soon_msg_id TEXT',
  'ALTER TABLE tasks ADD COLUMN soon_ack_at TEXT',
  'ALTER TABLE tasks ADD COLUMN soon_for TEXT',
  "ALTER TABLE visits ADD COLUMN point_cat TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE visits ADD COLUMN point_zone TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN points REAL',
  'ALTER TABLE visits ADD COLUMN points_manual INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE visits ADD COLUMN mult REAL',
  'ALTER TABLE tasks ADD COLUMN mult REAL',
  'ALTER TABLE tasks ADD COLUMN boost_sent TEXT',
  "ALTER TABLE tasks ADD COLUMN point_cat TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE tasks ADD COLUMN point_zone TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE users ADD COLUMN perms TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE tasks ADD COLUMN team TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE visits ADD COLUMN team TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE visits ADD COLUMN points_total REAL',
  "ALTER TABLE kpi_adjust ADD COLUMN ref TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE jobs ADD COLUMN reviewer_id TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE jobs ADD COLUMN due_time TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE jobs ADD COLUMN seen_at TEXT',
  'ALTER TABLE users ADD COLUMN bot_blocked_at TEXT',
  'ALTER TABLE users ADD COLUMN app_ver INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE visits ADD COLUMN sotki REAL',
  "ALTER TABLE jobs ADD COLUMN audience TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE jobs ADD COLUMN claimed_at TEXT',
  "ALTER TABLE jobs ADD COLUMN bcast TEXT NOT NULL DEFAULT '[]'",
  "ALTER TABLE tasks ADD COLUMN audience TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN claimed_at TEXT',
  'ALTER TABLE tasks ADD COLUMN claim_bonus REAL NOT NULL DEFAULT 0',
  "ALTER TABLE tasks ADD COLUMN bcast TEXT NOT NULL DEFAULT '[]'",
  'ALTER TABLE tasks ADD COLUMN sotki REAL',
  'ALTER TABLE users ADD COLUMN bot_warned_at TEXT',
  'ALTER TABLE jobs ADD COLUMN penalty REAL NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN penalty_adjust_id TEXT',
  'ALTER TABLE jobs ADD COLUMN penalized_at TEXT',
  'ALTER TABLE jobs ADD COLUMN ack_alert_at TEXT',
  'ALTER TABLE jobs ADD COLUMN ack_alert_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN ack_msg_id TEXT',
  'ALTER TABLE jobs ADD COLUMN due_alert_at TEXT',
  'ALTER TABLE jobs ADD COLUMN due_alert_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN due_msg_id TEXT',
  'ALTER TABLE jobs ADD COLUMN rev_alert_at TEXT',
  'ALTER TABLE jobs ADD COLUMN rev_alert_count INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE jobs ADD COLUMN rev_msg_id TEXT',
  'ALTER TABLE visits ADD COLUMN geo_lat REAL',
  'ALTER TABLE visits ADD COLUMN geo_lon REAL',
  'ALTER TABLE visits ADD COLUMN geo_km REAL',
  'ALTER TABLE visits ADD COLUMN geo_at TEXT',
  "ALTER TABLE visits ADD COLUMN zone_src TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN quick INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN sent_at TEXT',
  "ALTER TABLE notifications ADD COLUMN remark_type TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE notifications ADD COLUMN remark_points REAL',
  'ALTER TABLE notifications ADD COLUMN adjust_id TEXT',
  "ALTER TABLE visits ADD COLUMN annul_reason TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN annul_at TEXT',
  "ALTER TABLE visits ADD COLUMN docs TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN alert_msg_id TEXT',
  'ALTER TABLE tasks ADD COLUMN alert_at TEXT',
  'ALTER TABLE tasks ADD COLUMN alert_count INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE users ADD COLUMN prefs TEXT NOT NULL DEFAULT '{}'",
  "ALTER TABLE inspections ADD COLUMN condition TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE inspections ADD COLUMN bait_eaten TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN monitoring INTEGER',
  "ALTER TABLE tasks ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE tasks ADD COLUMN cancel_note TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN reschedule_req INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE tasks ADD COLUMN reschedule_to TEXT',
  'ALTER TABLE tasks ADD COLUMN reschedule_has_time INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE tasks ADD COLUMN reschedule_note TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE tasks ADD COLUMN reschedule_count INTEGER NOT NULL DEFAULT 0',
  'CREATE TABLE IF NOT EXISTS task_events (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, tech_tg_id TEXT NOT NULL, kind TEXT NOT NULL, note TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL)',
  'CREATE INDEX IF NOT EXISTS visits_tech_idx ON visits (tech_tg_id)',
  // оплата при завершении выезда: cash (наличные получены) | transfer (перечисление, юрлицо) | none (без оплаты — гарантия) | multi (обработка на несколько дней)
  // большие файлы в S3/R2: ключ объекта; 'uploading' — пока телефон загружает, ready = 0 у файлов поручений
  "ALTER TABLE media_posts ADD COLUMN storage_key TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE media_posts ADD COLUMN name TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE media_posts ADD COLUMN msg_text INTEGER NOT NULL DEFAULT 0',
  "ALTER TABLE job_files ADD COLUMN storage_key TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE job_files ADD COLUMN ready INTEGER NOT NULL DEFAULT 1',
  // контроль баллов: признаки «накрутки» по завершённым актам (status new | ok | fixed)
  "CREATE TABLE IF NOT EXISTS point_flags (id TEXT PRIMARY KEY, visit_id TEXT NOT NULL, tg_id TEXT NOT NULL, tech_name TEXT NOT NULL DEFAULT '', flags TEXT NOT NULL DEFAULT '[]', extra REAL NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'new', note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, decided_by TEXT NOT NULL DEFAULT '', decided_at TEXT)",
  'CREATE INDEX IF NOT EXISTS point_flags_visit_idx ON point_flags (visit_id)',
  // игра: опыт (XP) — каждое начисление один раз (tg_id + ref)
  'CREATE TABLE IF NOT EXISTS xp_events (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, kind TEXT NOT NULL, xp INTEGER NOT NULL, ref TEXT NOT NULL, note TEXT NOT NULL DEFAULT \'\', created_at TEXT NOT NULL)',
  'CREATE UNIQUE INDEX IF NOT EXISTS xp_events_ref_idx ON xp_events (tg_id, ref)',
  'CREATE INDEX IF NOT EXISTS xp_events_user_idx ON xp_events (tg_id, created_at)',
  // смена в эфире: трансляция геопозиции боту (последняя точка и минуты за день)
  "CREATE TABLE IF NOT EXISTS geo_live (tg_id TEXT PRIMARY KEY, msg_id TEXT NOT NULL DEFAULT '', started_at TEXT, live_until TEXT, last_at TEXT, lat REAL, lon REAL, day TEXT NOT NULL DEFAULT '', minutes REAL NOT NULL DEFAULT 0, hours_awarded INTEGER NOT NULL DEFAULT 0, tick_at TEXT, morning_day TEXT NOT NULL DEFAULT '')",
  // координаты адреса заявки (для карты и времени в пути)
  'ALTER TABLE tasks ADD COLUMN dest_lat REAL',
  'ALTER TABLE tasks ADD COLUMN dest_lon REAL',
  "ALTER TABLE tasks ADD COLUMN dest_geo TEXT NOT NULL DEFAULT ''",
  // «Хочу ещё заявку»
  "CREATE TABLE IF NOT EXISTS more_work (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, handled_at TEXT, handled_by TEXT NOT NULL DEFAULT '')",
  "ALTER TABLE visits ADD COLUMN payment TEXT NOT NULL DEFAULT ''",
  'ALTER TABLE visits ADD COLUMN pay_amount REAL',
  "ALTER TABLE visits ADD COLUMN pay_note TEXT NOT NULL DEFAULT ''",
  // KPI менеджеров (v44): кто создал заявку (tg_id), пробелы в заявке, звонки «Звонилки», ручные факты месяца
  "ALTER TABLE tasks ADD COLUMN author_id TEXT NOT NULL DEFAULT ''",
  "CREATE TABLE IF NOT EXISTS task_gaps (task_id TEXT PRIMARY KEY, author_id TEXT NOT NULL, fields TEXT NOT NULL DEFAULT '[]', first_at TEXT NOT NULL, last_ping_at TEXT, pings INTEGER NOT NULL DEFAULT 0, fixed_at TEXT, msg_id TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS task_gaps_author_idx ON task_gaps (author_id, first_at)',
  "CREATE TABLE IF NOT EXISTS mgr_calls (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, outcome TEXT NOT NULL, amount REAL, sub INTEGER NOT NULL DEFAULT 0, b2b INTEGER NOT NULL DEFAULT 0, client TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', note TEXT NOT NULL DEFAULT '', callback_at TEXT, reminded_at TEXT, cb_done_at TEXT, day TEXT NOT NULL, created_at TEXT NOT NULL)",
  'CREATE INDEX IF NOT EXISTS mgr_calls_user_idx ON mgr_calls (tg_id, day)',
  // v47: спор о количестве комнат (дезинсектор нажал «Ошибка»), «Мой авто»
  "CREATE TABLE IF NOT EXISTS rooms_disputes (id TEXT PRIMARY KEY, visit_id TEXT NOT NULL, task_id TEXT NOT NULL DEFAULT '', tg_id TEXT NOT NULL, task_rooms INTEGER, claimed INTEGER, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'new', decided_rooms INTEGER, decided_by TEXT NOT NULL DEFAULT '', decided_at TEXT, msgs TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS cars (tg_id TEXT PRIMARY KEY, make TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', year INTEGER, plate TEXT NOT NULL DEFAULT '', fuel TEXT NOT NULL DEFAULT 'petrol', mileage_start INTEGER NOT NULL DEFAULT 0, mileage INTEGER NOT NULL DEFAULT 0, mileage_at TEXT, service_interval INTEGER NOT NULL DEFAULT 10000, ai_tip TEXT NOT NULL DEFAULT '', ai_tip_km INTEGER, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS car_fuel (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, km INTEGER NOT NULL, amount REAL, liters REAL, mime TEXT NOT NULL DEFAULT '', photo TEXT NOT NULL DEFAULT '', ai_note TEXT NOT NULL DEFAULT '', day TEXT NOT NULL, created_at TEXT NOT NULL)",
  'CREATE INDEX IF NOT EXISTS car_fuel_user_idx ON car_fuel (tg_id, created_at)',
  "CREATE TABLE IF NOT EXISTS car_service (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, item TEXT NOT NULL, km INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', amount REAL, created_at TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS car_checks (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, day TEXT NOT NULL, requested_at TEXT NOT NULL, due_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'requested', ai_verdict TEXT NOT NULL DEFAULT '', ai_score INTEGER, ai_note TEXT NOT NULL DEFAULT '', points REAL, decided_by TEXT NOT NULL DEFAULT '', decided_at TEXT, submitted_at TEXT, msgs TEXT NOT NULL DEFAULT '{}')",
  'CREATE INDEX IF NOT EXISTS car_checks_user_idx ON car_checks (tg_id, day)',
  "CREATE TABLE IF NOT EXISTS car_photos (id TEXT PRIMARY KEY, check_id TEXT NOT NULL, tg_id TEXT NOT NULL, zone TEXT NOT NULL, mime TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL)",
  'CREATE INDEX IF NOT EXISTS car_photos_check_idx ON car_photos (check_id)',
  "CREATE TABLE IF NOT EXISTS mgr_facts (tg_id TEXT NOT NULL, month TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY (tg_id, month))",
  // v49: удаление сотрудника/авто, обязательная геолокация, штрафы менеджеров, CRM-коннектор, язык интерфейса
  "ALTER TABLE users ADD COLUMN lang TEXT NOT NULL DEFAULT 'ru'",
  "CREATE TABLE IF NOT EXISTS car_delete_requests (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT NOT NULL DEFAULT '', msgs TEXT NOT NULL DEFAULT '{}')",
  'CREATE INDEX IF NOT EXISTS car_delete_requests_user_idx ON car_delete_requests (tg_id, status)',
  "CREATE TABLE IF NOT EXISTS mgr_penalties (id TEXT PRIMARY KEY, task_id TEXT NOT NULL, penalty_id TEXT NOT NULL, tg_id TEXT NOT NULL, minutes REAL NOT NULL DEFAULT 0, created_at TEXT NOT NULL)",
  'CREATE UNIQUE INDEX IF NOT EXISTS mgr_penalties_task_idx ON mgr_penalties (task_id, penalty_id)',
  'CREATE INDEX IF NOT EXISTS mgr_penalties_user_idx ON mgr_penalties (tg_id, created_at)',
  "ALTER TABLE tasks ADD COLUMN crm_lead_id TEXT NOT NULL DEFAULT ''",
  // v51: предупреждения (страйки) менеджерам — эскалирующий штраф к бонусной части KPI
  "CREATE TABLE IF NOT EXISTS mgr_strikes (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, month TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS mgr_strikes_user_idx ON mgr_strikes (tg_id, month)',
  // v52: касса — наличные на руках у сотрудника (из выездов), сдача кассы и выдача из кассы под отчёт
  "CREATE TABLE IF NOT EXISTS cash_handovers (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, expected_amount REAL NOT NULL DEFAULT 0, received_amount REAL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS cash_handovers_user_idx ON cash_handovers (tg_id, created_at)',
  "CREATE TABLE IF NOT EXISTS cash_withdrawals (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL, decided_at TEXT, decided_by TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS cash_withdrawals_user_idx ON cash_withdrawals (tg_id, created_at)',
  // v53: ручная правка кассы администратором (± к сумме «на руках», с причиной)
  "CREATE TABLE IF NOT EXISTS cash_adjustments (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, reason TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS cash_adjustments_user_idx ON cash_adjustments (tg_id, created_at)',
  // v58: подготовка ловушек заранее — станция привязана к объекту заявки, но ещё не установлена (prepared = 1)
  'ALTER TABLE traps ADD COLUMN prepared INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE traps ADD COLUMN installed_at TEXT',
  "ALTER TABLE tasks ADD COLUMN prep_object_id TEXT NOT NULL DEFAULT ''",
  // v59: кто подготовил станцию (может быть не тот, кто поедет)
  "ALTER TABLE traps ADD COLUMN prepared_by TEXT NOT NULL DEFAULT ''",
  // v61: клиент отказался от ловушек, но их оставили за ним «на другой раз» — выезд не включает мониторинг сам
  'ALTER TABLE tasks ADD COLUMN prep_skip INTEGER NOT NULL DEFAULT 0',
  // v66: прочие расходы на авто — мойка, AdBlue, парковка, ремонт…
  "CREATE TABLE IF NOT EXISTS car_expenses (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, kind TEXT NOT NULL, amount REAL NOT NULL, liters REAL, km INTEGER, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)",
  'CREATE INDEX IF NOT EXISTS car_expenses_user_idx ON car_expenses (tg_id, created_at)',
  // v67: тип кузова (для иллюстрации) и страховки/документы авто со сроком действия
  "ALTER TABLE cars ADD COLUMN body TEXT NOT NULL DEFAULT ''",
  "CREATE TABLE IF NOT EXISTS car_docs (id TEXT PRIMARY KEY, tg_id TEXT NOT NULL, kind TEXT NOT NULL, number TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', starts TEXT, expires TEXT NOT NULL, amount REAL, note TEXT NOT NULL DEFAULT '', reminded TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '')",
  'CREATE INDEX IF NOT EXISTS car_docs_user_idx ON car_docs (tg_id, expires)',
  // v69: «сколько осталось до ТО» вручную — точка отсчёта: следующая замена на пробеге next_km (дальше считается сама)
  "CREATE TABLE IF NOT EXISTS car_service_set (tg_id TEXT NOT NULL, item TEXT NOT NULL, next_km INTEGER NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL DEFAULT '', PRIMARY KEY (tg_id, item))",
  // v71: в группе под заявкой — физлицо/юрлицо и комментарии офиса; ответы на вопросы бота (force_reply)
  "ALTER TABLE tasks ADD COLUMN client_type TEXT NOT NULL DEFAULT ''",
  "ALTER TABLE tasks ADD COLUMN office_note TEXT NOT NULL DEFAULT ''",
  "CREATE TABLE IF NOT EXISTS bot_prompts (chat_id TEXT NOT NULL, msg_id TEXT NOT NULL, kind TEXT NOT NULL, task_id TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (chat_id, msg_id))",
];

async function migrate(run) {
  for (const sql of MIGRATIONS) {
    try { await run(sql); } catch { /* уже применено */ }
  }
}

async function createPg(url) {
  const { default: pg } = await import('pg');
  const pool = new pg.Pool({
    connectionString: url,
    ssl: process.env.PGSSL === '1' ? { rejectUnauthorized: false } : undefined,
    max: 5,
  });
  await pool.query(SCHEMA);
  await migrate((sql) => pool.query(sql));
  return {
    kind: 'postgres',
    async query(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows;
    },
  };
}

async function createSqlite(file) {
  const { DatabaseSync } = await import('node:sqlite');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  await migrate(async (sql) => db.exec(sql));
  return {
    kind: 'sqlite',
    async query(sql, params = []) {
      const stmt = db.prepare(sql.replace(/\$(\d+)/g, '?$1'));
      return stmt.all(...params.map((p) => (typeof p === 'boolean' ? Number(p) : p ?? null)));
    },
  };
}

export async function createDb() {
  if (process.env.DATABASE_URL) return createPg(process.env.DATABASE_URL);
  const file = process.env.SQLITE_FILE || path.resolve('data/dev.sqlite');
  return createSqlite(file);
}
