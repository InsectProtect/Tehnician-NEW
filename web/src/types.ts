export type User = {
  id: string;
  name: string;
  tg_name: string;
  username: string;
  phone: string;
  role: 'admin' | 'manager' | 'tech' | 'specialist';
  status: 'active' | 'pending' | 'blocked';
  isAdmin: boolean;
  isOwner?: boolean;
  perms?: string[];
  bot_blocked?: boolean;
  pin_set: boolean;
  created_at: string;
  last_seen: string | null;
  lang?: 'ru' | 'ro';
};
export type StaffUser = User & { visits: number; last_visit: string | null };
export type StatusOption = { id: string; label: string };
export type OfficeChat = { id: string; title: string; type?: string; thread_id?: string };

export type BootstrapPartial = { user: User; pin?: { set: boolean; locked_until: string | null } };

export type Task = {
  id: string; task_no: number; tech_id: string; tech_name: string; company_name: string; address: string;
  planned_at: string | null; has_time: boolean; procedure: string; pests: string[]; phone: string; comment: string;
  status: 'open' | 'pending' | 'new' | 'in_progress' | 'done' | 'cancelled'; visit_id: string | null; created_at: string; author: string;
  call_url: string | null;
  cancel_reason: '' | 'client' | 'office';
  reschedule: { to: string | null; has_time: boolean; note: string } | null;
  reschedule_count: number;
  ack_at: string | null;
  alert_count?: number;
  call_status?: '' | 'called' | 'not_needed';
  en_route_at?: string | null;
  call_undo?: boolean;
  route_undo?: boolean;
  mult?: number | null; mult_eff?: number; mult_why?: string;
  point_cat?: string; point_zone?: string; sotki?: number | null;
  audience?: Audience | ''; claimed_at?: string | null; claim_bonus?: number;
  team?: { id: string; name: string }[];
  sent_at?: string;
  cancel_note?: string;
  cancelled_at?: string;
  rooms?: number | null;
  stage?: string;
  price?: number | null;
  crm_lead_id?: string;
  /** физлицо / юрлицо (выбрано кнопкой в группе или по названию фирмы) */
  client_type?: 'person' | 'company';
  /** комментарии офиса из группы (по строке «Имя: текст») */
  office_note?: string;
};

export type CompanySettings = {
  name: string; fiscal: string; seat: string; rep: string; func: string; tagline: string; declarations: string; annex_declaration?: string;
};

export type Invite = { code: string; name: string; role: 'admin' | 'manager' | 'tech' | 'specialist'; expires_at: string; link: string | null };

export type AdminVisit = {
  id: string; act_no: string; company_name: string; address: string; procedure: string; status: 'open' | 'done';
  tech_id: string; tech_name: string; started_at: string; finished_at: string | null; pests: string[];
  infestation: string; preparation: string; comment: string; notes: number; photos: number;
  traps_total: number; traps_checked: number; traps_activity: number; office_sent_at: string | null; revision: number;
};

export type AdminStats = {
  from: string; to: string; total: number; done: number; open: number; notes: number; photos: number;
  high: number; unprepared: number;
  by_procedure: { name: string; n: number }[]; by_tech: { name: string; n: number }[]; by_pest: { name: string; n: number }[];
  daily: { date: string; n: number }[]; alerts: AdminVisit[];
};

export type AuditItem = { id: string; at: string; actor_id: string; actor_name: string; action: string; target: string; details: string };

export type Bootstrap = {
  user: User;
  isAdmin: boolean;
  clients: number | null;
  pendingUsers: number;
  unread: number;
  office: OfficeChat | null;
  amo: boolean;
  bot: string;
  leads: boolean;
  procedures: string[];
  assessProcedures: string[];
  pestsByProcedure: Record<string, string[]>;
  products: Record<string, string[]>;
  actTemplate: 'ro' | 'modern';
  taskApproval?: boolean;
  company: CompanySettings | null;
  infestation: StatusOption[];
  preparation: StatusOption[];
  obsCategories: string[];
  trapKinds: string[];
  stationTargets: { id: string; label: string; devices: string[]; pests: string[] }[];
  pointCats: PointCat[];
  pointZones: { id: string; label: string }[];
  multCfg?: { weekday: number[]; special: SpecialPeriod[]; windows?: BoostWindow[] };
  features?: Features;
  pestMult?: Record<string, number>;
  pointExtras?: PointExtras;
  uploadMaxMb?: number; storage?: boolean;
  crowns?: string[];
  premises: StatusOption[];
  reentryOptions: StatusOption[];
  prefs?: { all_tasks?: boolean; theme?: 'dark' | 'light' | 'auto'; overview?: string[]; overview_known?: string[]; tabs_order?: string[]; tabs_hidden?: string[] };
  conditions: StatusOption[];
  baitLevels: StatusOption[];
  rodenticide: string;
  pests: string[];
  statuses: StatusOption[];
};

export type Lead = {
  id: string;
  name: string;
  company_id: string;
  company_name: string;
  address: string;
  procedure: string;
  planned_at: string | null;
  stage: 'assigned' | 'in_progress' | 'done';
  visit_id: string | null;
};

export type Company = { id: string; name: string; addresses: string[] };
export type SiteObject = { id: string; address: string; traps: number };

export type Inspection = {
  status: string;
  condition: string;
  bait_eaten: string;
  pest: string;
  count: number;
  bait_replaced: boolean;
  comment: string;
  checked_at: string;
};

export type Trap = {
  id: string;
  code: string;
  number: number;
  kind: string;
  location: string;
  target: string;
  /** подготовлена заранее, ещё не установлена на объекте */
  prepared?: boolean;
  inspection: Inspection | null;
};

/** Оплата при завершении: наличные / перечисление / без оплаты (гарантия) / несколько дней. */
export type Payment = 'cash' | 'transfer' | 'none' | 'multi';
export type VisitSummary = {
  id: string;
  mult_eff?: number;
  company_name: string;
  address: string;
  procedure: string;
  lead_id: string | null;
  status: 'open' | 'done';
  tech_name: string;
  started_at: string;
  finished_at: string | null;
  total: number;
  checked: number;
  notes: number;
  mine: boolean;
  approval: '' | 'pending' | 'rejected';
};

export type Visit = {
  id: string;
  company_id: string;
  company_name: string;
  address: string;
  procedure: string;
  status: 'open' | 'done';
  comment: string;
  tech_name: string;
  started_at: string;
  finished_at: string | null;
  report_url: string | null;
  lead_id: string | null;
  act_no: string;
  revision: number;
  can_reopen: boolean;
  can_delete: boolean;
  infestation: string;
  preparation: string;
  needs_assessment: boolean;
  pests: string[];
  recommendations: RecBlock[];
  area: string;
  location: string;
  products: string[];
  client_rep: string;
  client_rep_function: string;
  locality: string;
  office_sent_at: string | null;
  office_configured: boolean;
  is_company: boolean;
  approval: '' | 'pending' | 'rejected';
  approval_note: string;
  approved_by: string;
  unplanned_reason: string;
  rooms: number | null;
  rooms_task?: number | null;
  rooms_dispute?: { id: string; status: 'new' | 'ok' | 'fixed'; claimed: number | null; decided_rooms: number | null; decided_by: string } | null;
  stage?: string;
  price?: number | null;
  payment?: Payment | ''; pay_amount?: number | null; pay_note?: string;
  can_approve: boolean;
  can_undo_start?: boolean;
  annul_pending?: boolean;
  annul_reason?: string;
  can_annul?: boolean;
  point_cat?: string;
  point_zone?: string;
  points?: number | null;
  points_detail?: string;
  points_manual?: boolean;
  mult?: number | null; mult_now?: number;
  team?: { id: string; name: string }[]; points_total?: number | null; sotki?: number | null;
  geo?: { km: number; lat: number; lon: number; at: string; zone: string; map: string } | null; zone_src?: string;
  quick?: boolean;
  premises: string[];
  reentry: string;
  reentry_custom: boolean;
  reentry_default: string;
  monitoring: boolean | null;
  journal_url: string | null;
};

export type RecBlock = { title: string; items: string[]; accent?: boolean };

export type Observation = {
  id: string;
  category: string;
  comment: string;
  created_at: string;
  photos: { id: string; url: string }[];
};

export type ScanResult =
  | { state: 'found'; trap: Trap }
  | { state: 'new'; code: string; next_number: number }
  | { state: 'other_object'; code: string; object?: { company_name: string; address: string } }
  | { state: 'inactive'; code: string }
  | { state: 'replaced'; code: string; number: number; new_code: string };

export type LabelSize = 's' | 'm' | 'l';
export interface LabelOpts { size: LabelSize; brand: string; phone: string; warn: boolean; lines: boolean }
export interface LabelBatch { id: string; kind: 'new' | 'reprint'; count: number; size: LabelSize; first: string; created_at: string; created_by: string; url: string }
export interface LabelsInfo { sizes: { id: LabelSize; title: string; hint: string; per_sheet: number }[]; opts: LabelOpts; batches: LabelBatch[] }
export type LabelsInput = Partial<LabelOpts> & { count?: number; start?: number; trap_ids?: string[] };

export type InspectionInput = {
  trap_id: string;
  status?: string;
  condition?: string;
  bait_eaten?: string;
  pest: string;
  count: number;
  bait_replaced: boolean;
  comment: string;
};

export type ImportStats = { created: number; updated: number; addresses: number; skipped: number; total: number };

export type MonthSummary = { month_start: string; done: number; from_tasks: number; open: number; remarks: number; unread: number; points?: number };

export type NotificationItem = {
  id: string; kind: 'remark' | 'task_new' | 'task_update' | 'task_cancel' | 'act_reopened' | string; text: string;
  visit_id: string | null; task_id: string | null; author: string; created_at: string; read: boolean;
};
export type NotificationsRes = { month_start: string; month: MonthSummary; remarks: number; unread: number; items: NotificationItem[] };

export type RemarkType = { id: string; label: string; points: number };
export type RemarkItem = { id: string; tech_id: string; tech_name: string; text: string; visit_id: string | null; author: string; created_at: string; read: boolean; type?: string; points?: number | null };
export type RemarksRes = { month_start: string; by_tech: { name: string; n: number }[]; items: RemarkItem[]; types?: RemarkType[] };

export type TasksStats = {
  from: string; to: string; total: number; new: number; in_progress: number; done: number; cancelled: number;
  overdue: number; open_now: number; avg_hours: number | null; client_cancelled: number; reschedule_pending: number;
  by_tech: { name: string; total: number; done: number; open: number; cancelled: number }[];
  by_pest: { name: string; n: number }[]; daily: { date: string; n: number }[]; overdue_items: Task[];
};

export type PestsStats = {
  from: string; to: string; visits: number; total: number;
  pests: { name: string; n: number; share: number; high: number; objects: number }[];
  by_procedure: { name: string; n: number }[];
  repeat_objects: { company_name: string; address: string; n: number; pests: string[]; last: string }[];
  traps: { name: string; n: number; count: number }[];
  trend: ({ month: string } & Record<string, number | string>)[];
  trend_keys: string[];
};

export type BotStatus = {
  enabled: boolean; expected_url: string; error: string | null; last_update_at: string | null;
  webhook: { url: string; pending: number; last_error: string; last_error_at: string | null; allowed: string[] } | null;
  bot: { username: string; can_read_all_group_messages: boolean; id: number } | null;
  bindings: {
    key: string; chat_id: string; chat_title: string; thread_id: string | null; topic: string; tech_id: string; tech_name: string;
    tech_exists: boolean; bot_status: string; tasks: number;
  }[];
  recent: { at: string; chat: string; chat_id: string; thread: string | null; from: string; text: string; result: string }[];
};

export type KpiMonth = {
  month: string; received: number; done: number; on_time: number; late: number; cancelled: number; client_cancelled: number; reschedules: number;
  visits: number; remarks: number; revenue?: number; points?: number;
  on_time_pct: number | null; avg_hours: number | null;
};
export type KpiRes = { months: string[]; current: string; techs: { id: string; name: string; total_done: number; months: KpiMonth[] }[] };

export type AnnulRequest = { id: string; company_name: string; address: string; tech_name: string; act_no: string; reason: string; at: string };

export type PointZones = { city: number; near: number; far: number };
export type PointCat = { id: string; label: string; zoned?: boolean; points: number; zones: PointZones | null };
export type SpecialPeriod = { label: string; from: string; to: string; mult: number };
/** Окно повышенного коэффициента: дни (0 = Пн … 6 = Вс) и время «с–по» (24:00 — до полуночи; «по» раньше «с» — через полночь). */
export type BoostWindow = { days: number[]; from: string; to: string; mult: number | string; label: string };
export type PointsConfig = { cats: PointCat[]; night: number; night_from: number; weekday?: number[]; special?: SpecialPeriod[]; windows?: BoostWindow[]; pest_mult?: Record<string, number>; extras?: PointExtras };
export type PointExtras = { free_rooms: number; per_room: number; free_sotki: number; per_sotka: number };

export type KpiSettings = {
  base_points: number; season: number[]; w_plan: number; w_on_time: number; w_quality: number;
  on_time_target: number; remark_penalty: number; cap: number; remind_minutes: number; min_plan_pct: number;
};
export type KpiPlanRow = {
  id: string; name: string; plan: number; plan_custom: boolean; points: number; done: number; received: number;
  on_time_pct: number | null; late: number; remarks: number; plan_pct: number; on_time_score: number; quality_score: number; score: number;
  score_raw?: number; below_min?: boolean; min_points?: number; adjust?: number;
  sent_at: string | null; ack_at: string | null; remind_count: number;
};
export type KpiPlanRes = { month: string; month_label: string; coef: number; auto_plan: number; settings: KpiSettings; rows: KpiPlanRow[] };
export type MyPlan = KpiPlanRow & { month: string; month_label: string; weights: { plan: number; on_time: number; quality: number } };

export type Specialist = KpiPlanRow & {
  username: string; phone: string; last_seen: string | null;
  open: number; today: number; overdue: number; unacked: number; client_cancelled: number; reschedules: number; revenue: number; avg_hours: number | null;
  on_site: { company_name: string; address: string; started_at: string } | null; last_done_at: string | null; total_done: number; total_points: number;
  office_call: { id: string; created_at: string; count: number } | null;
};
export type SpecialistDetail = {
  user: { id: string; name: string; username: string; phone: string; created_at: string; last_seen: string | null };
  months: { month: string; label: string; plan: number; points: number; plan_pct: number; score: number; done: number; on_time_pct: number | null; remarks: number; ack_at: string | null }[];
  tasks: Task[];
  visits: { id: string; company_name: string; address: string; procedure: string; status: 'open' | 'done'; started_at: string; finished_at: string | null; points: number | null; act_no: string }[];
};

export type TimelinessRow = {
  id: string; name: string; tasks: number; ack_fast_pct: number | null; ack_avg_min: number | null; unacked: number; reminders_avg: number | null;
  soon_total: number; soon_ok_pct: number | null; soon_reminders_avg: number | null; started: number; start_on_time_pct: number | null;
  plan_ack_hours: number | null; plan_sent: boolean; plan_acked: boolean; office_calls: number; office_ok_pct: number | null; score: number | null;
};
export type OfficeCall = { id: string; tg_id: string; name: string; note: string; by_name: string; created_at: string; ack_at: string | null; count: number };

export type AdjRule = { id: string; kind: 'bonus' | 'penalty'; label: string; points: number; threshold: number; unit: string; per_unit?: boolean; enabled: boolean };
export type KpiAdjust = { id: string; month: string; tg_id: string; name: string; rule: string; points: number; reason: string; status: 'proposed' | 'applied' | 'rejected'; decided_by: string; decided_at: string | null };

export type CoachMsg = { id: string; week: string; tg_id: string; name: string; kind: 'praise' | 'improve'; text: string; status: 'proposed' | 'sent' | 'rejected'; created_at: string; decided_at: string | null; decided_by: string; metrics: Partial<TimelinessRow> };

export type MediaSettings = { per_item: number; month_cap: number };
export type MyMedia = { id: string; kind: 'video' | 'photo'; status: 'proposed' | 'approved' | 'rejected'; points: number | null; created_at: string; caption: string };
export type MediaPost = { id: string; tg_id: string; name: string; kind: 'video' | 'photo'; size: number; caption: string; status: 'proposed' | 'approved' | 'rejected'; points: number | null; created_at: string; decided_by: string; decided_at?: string | null; object: string; url: string; download_url?: string; visit_id: string | null; stored?: boolean };
export type MediaStats = { total: number; proposed: number; approved: number; rejected: number; points: number };

export type JobStatus = 'open' | 'new' | 'in_progress' | 'submitted' | 'returned' | 'accepted' | 'cancelled';
export type Job = {
  id: string; job_no: number; tg_id: string; tech_name?: string; title: string; descr: string; due_at: string | null;
  points: number; target: number | null; done_count: number; status: JobStatus; report: string; admin_note: string;
  author_name: string; ack_at: string | null; submitted_at: string | null; decided_at: string | null; decided_by: string;
  awarded: number | null; overdue: boolean; created_at: string; updated_at: string;
  reviewer_id?: string; reviewer_name?: string | null; due_time?: string;
  penalty?: number; penalized?: boolean; late?: boolean; seen_at?: string | null;
  files?: JobFile[]; tech_bot_blocked?: boolean;
  audience?: Audience | ''; claimed_at?: string | null;
};
export type JobFile = { id: string; name: string; mime: string; size: number; kind: string; tg_id: string; created_at: string; url: string; download_url: string; stored?: boolean };
export type Assignee = { id: string; name: string; role: 'tech' | 'specialist' | 'manager'; bot_blocked?: boolean };
export type Audience = 'all' | 'tech' | 'specialist' | 'manager';
export type JobInput = { title: string; descr: string; due_at: string | null; due_time?: string; penalty?: number | string; points: number | string; target: number | string | null; reviewer_id?: string };
export type AdminTaskInput = {
  tech: string; company: string; address: string; phone: string; date: string; time: string; procedure: string; pests: string[];
  comment: string; rooms: string; stage: string; price: string; mult: string; point_cat: string; point_zone: string; team: string[]; sotki?: string;
  audience?: Audience; claim_bonus?: string;
};

export type Features = { team: boolean; job_reviewer: boolean; managers: boolean; contest: boolean; one_open: boolean; game?: boolean; geo_shift?: boolean; require_geo_start?: boolean };
export type ContestSettings = { bonus: number; show_staff: boolean; min_points: number };
export type ContestRow = { id: string; name: string; points: number; visits: number; rank: number; crown: boolean; me: boolean };
export type ContestRes = {
  month: string; label: string; settings: ContestSettings; items: ContestRow[]; days_left: number;
  history: { month: string; label: string; names: string[]; points: number; bonus: number }[];
};

export type RecalcRes = {
  ok: true; month: string; label: string; total: number; changed: number; manual: number; before: number; after: number; dry: boolean;
  items: { id: string; act_no: string; company_name: string; tech_name: string; before: number; after: number }[];
};

export type AnnColor = 'info' | 'boost' | 'alert' | 'good';
export type Announcement = { id: string; title: string; body: string; color: AnnColor; author_name: string; created_at: string; expires_at: string | null; acked: boolean };
export type AnnouncementAdmin = Omit<Announcement, 'acked'> & { audience: Audience | 'everyone'; total: number; read: number; unread: string[] };
export type AnnouncementInput = { title: string; body: string; color: AnnColor; audience: Audience | 'everyone'; expires_at: string | null };

export type GuardSettings = { enabled: boolean; mode: 'instant' | 'digest'; min_minutes: number; max_unplanned_day: number; digest_hour: number; notify_min_extra: number };
export type GuardFlag = {
  id: string; visit_id: string; tg_id: string; tech_name: string; flags: { kind: string; text: string }[]; extra: number; status: 'new' | 'ok' | 'fixed'; note: string;
  company_name: string; address: string; points: number | null; started_at: string | null; finished_at: string | null; created_at: string; decided_by: string;
};
export type GuardStat = { id: string; name: string; visits: number; flagged: number; confirmed: number; extra: number; minutes: number | null; share: number; warn: string[] };
export type GuardRes = { settings: GuardSettings; kinds: Record<string, string>; stats: { team_minutes: number | null; items: GuardStat[] }; items: GuardFlag[] };

/* ---------- игра, смена в эфире, входящие ---------- */
export type Quest = { id: string; title: string; target: number; progress: number; xp: number; done: boolean; icon?: string; hint?: string; action?: 'checkin' | null };
type QuestToggle = { on: boolean; xp: number };
/** Настройки квестов дня (админка → «🎯 Квесты»). */
export type QuestsSettings = {
  coffee: QuestToggle & { from: string; to: string };
  first_ontime: QuestToggle; ontime: QuestToggle; visits: QuestToggle; photos: QuestToggle;
  shift: QuestToggle & { hours: number };
  office: { lat: number | null; lon: number | null; radius: number; label: string };
};
export type Badge = { id: string; title: string; hint: string; icon: string; got: boolean; progress: [number, number] | null };
export type ShiftState = { live: boolean; since: string | null; until: string | null; last_at: string | null; minutes: number; hours: number; max_hours: number; xp_per_hour: number; from_hour: number; to_hour: number };
export type GameState = {
  enabled: boolean; xp: number; today_xp: number; level: number; from: number; to: number; title: string; max?: boolean; max_level?: number;
  quests: Quest[]; streak: number; best_streak: number; badges: Badge[];
  recent: { kind: string; xp: number; note: string; at: string }[]; shift: ShiftState;
};
export type InboxItem = {
  key: string; type: 'call' | 'task' | 'note' | 'job' | 'ann'; kind?: string; color: 'red' | 'orange' | 'purple' | 'blue' | 'green'; urgent?: boolean;
  title: string; text: string; at: string; action: string; task_id?: string | null; visit_id?: string | null; job_id?: string; author?: string;
  steps?: { label: string; ok: boolean }[]; done_at?: string;
};
export type InboxRes = { new: InboxItem[]; work: InboxItem[]; done: InboxItem[]; counts: { new: number; work: number } };
export type GeoPoint = { lat: number; lon: number };
export type RouteInfo = {
  me: (GeoPoint & { at: string; live: boolean }) | null; dest: GeoPoint | null; km: number | null; eta_min: number | null; arrive_at: string | null;
  late: boolean; near: boolean; zone: { km: number; zone: string } | null; nav_url: string | null; planned_at: string | null; has_time: boolean;
};
export type LiveItem = { id: string; name: string; role: string; pos: (GeoPoint & { at: string; live: boolean }) | null; last?: (GeoPoint & { at: string; live: boolean }) | null; site?: (GeoPoint & { label: string }) | null; state: 'route' | 'onsite' | 'free'; text: string; late: boolean; eta_min: number | null; shift_hours: number };
export type Reward = {
  xp: number; xp_total: number; level: number; title: string; level_from: number; level_to: number;
  points: number; detail: string; on_time: boolean; quests: Quest[]; streak: number;
  plan: { points: number; plan: number; pct: number; min: number | null } | null;
};
export type GeoSettings = { from_hour: number; to_hour: number; max_hours: number; morning: boolean; morning_hour: number };

/* ---------- KPI менеджеров (v44) ---------- */
export interface SalesKpi { id: string; label: string; unit: string; dir: 'up' | 'down'; src: 'auto' | 'manual'; weight: number; target: number; value: number | null; manual: boolean; ratio: number; score: number; lost: number }
export interface SalesSuper { id: string; label: string; count: number; amount: number; total: number; note: string }
export interface SalesPenaltyHit { id: string; label: string; count: number; amount: number; total: number }
export interface SalesStrikes { on: boolean; count: number; tier: number; pct: number; cut: number; label: string }
export interface SalesCalc {
  month: string; plan: number; revenue: number; pct: number; kkpi: number; k: number; below_cutoff: boolean; critical: boolean;
  premium: number; bonus: number; supers: SalesSuper[]; supers_total: number; fine: number; penalties: SalesPenaltyHit[]; strikes: SalesStrikes; salary: number; total: number; kpis: SalesKpi[];
  structure: { id: string; label: string; share: number; plan: number }[];
  auto: { revenue: number; revenue_b2c: number; revenue_b2b: number; done: number; calls: number; reached: number; deals: number; subs: number; b2b_new: number; tasks: number; tasks_bad: number; pings: number };
}
export interface SalesStrikeEntry { id: string; note: string; created_at: string; created_by: string }
export interface SalesWhatIf { pct: number; revenue: number; need: number; premium: number; bonus: number; total: number; reached: boolean }
export interface SalesTip { kpi: string; title: string; text: string }
export interface SalesGap { task_id: string; task_no: number; fields: string[]; first_at: string; pings: number; company: string; address: string; phone: string; planned_at: string | null; has_time: boolean; price: number | null; procedure: string; point_cat: string }
export interface SalesCfgShort { preset: string; base_plan: number; rate: number; salary: number; cutoff: number; ladder: [number, number][]; bonus: { from: number; amount: number }; crit: { below: number; cut: number }; gap_fine: number; supers: { id: string; label: string; amount: number; param: number | null; hint: string }[]; penalties: { id: string; label: string; amount: number; param: number | null; hint: string }[] }
export interface SalesFull {
  month: string; month_label: string; calc: SalesCalc; what_if: SalesWhatIf[]; tips: SalesTip[]; gaps: SalesGap[]; strikes_list: SalesStrikeEntry[];
  manual: Record<string, number | string>; manual_at: string | null; manual_by: string; cfg: SalesCfgShort;
}
export interface MgrGame {
  today: { calls: number; reached: number; deals: number; amount: number };
  quests: { id: string; title: string; have: number; need: number; xp: number; done: boolean }[];
  combo: number; streak: number; best_day: number; xp: number; xp_today: number; level: { level: number; from: number; to: number; title: string };
  recent: { id: string; outcome: CallOutcome; amount: number | null; sub: boolean; b2b: boolean; client: string; created_at: string }[];
  callbacks: { id: string; client: string; phone: string; note: string; at: string; overdue: boolean }[];
}
export type CallOutcome = 'deal' | 'callback' | 'refuse' | 'no_answer';
export interface MgrMe extends SalesFull { game: MgrGame; league: { name: string; pct: number; xp: number; me: boolean }[]; settings: { calls_day: number; reached_day: number; deals_day: number }; gap_labels: Record<string, string> }
export interface SalesCfgKpi { id: string; weight: number; target: number; label: string; unit: string; dir: 'up' | 'down'; src: 'auto' | 'manual'; custom: boolean }
export interface SalesCfg {
  preset: string; base_plan: number; rate: number; salary: number; cutoff: number; cap: number; season: number[]; plan_override: Record<string, number>;
  kpis: SalesCfgKpi[]; ladder: [number, number][]; bonus: { from: number; amount: number }; crit: { below: number; cut: number };
  structure: { id: string; label: string; share: number }[]; supers: Record<string, { on: boolean; amount: number; param: number | null }>; gap_fine: number;
  penalties: Record<string, { on: boolean; amount: number; param: number | null }>;
}
export interface SalesSettings {
  gaps: { on: boolean; fields: string[]; every_min: number; grace_min: number; max_pings: number; from_hour: number; to_hour: number; admins_too: boolean };
  coach: { on: boolean; hour: number; weekdays: boolean };
  game: { calls_day: number; reached_day: number; deals_day: number };
  strikes: { on: boolean; pct: number[] };
}
export interface SalesListItem { tg_id: string; name: string; preset: string; plan: number; revenue: number; pct: number; kkpi: number; k: number; premium: number; bonus: number; supers: number; fine: number; total: number; gaps: number; calls: number; deals: number; weak: string; strikes: number }
export interface SalesList {
  month: string; items: SalesListItem[]; settings: SalesSettings;
  catalog: Record<string, { label: string; unit: string; dir: 'up' | 'down'; target: number; src: 'auto' | 'manual' }>;
  presets: Record<string, string>; supers: Record<string, { label: string; amount: number; param: number | null; hint: string }>;
  penalties: Record<string, { label: string; amount: number; param: number | null; param_unit: string; hint: string }>;
  gap_fields: Record<string, string>;
}
export interface SalesMonthRow { month: string; label: string; plan: number; future?: boolean; revenue?: number; pct?: number; kkpi?: number; k?: number; premium?: number; bonus?: number; supers?: number; fine?: number; salary?: number; total?: number; values?: Record<string, number | null> }
export interface SalesDetail extends SalesFull {
  user: { tg_id: string; name: string; role: string }; months: SalesMonthRow[];
  year: { plan: number; revenue: number; pct: number; kkpi: number; k: number; premium: number; bonus: number; salary: number; total: number; months_100: number; months_below: number };
  raw_cfg: SalesCfg;
}

/* ---------- v47: комнаты, «Мой авто» ---------- */
export interface RoomsDispute { id: string; visit_id: string; task_no: number; client: string; tech_name: string; task_rooms: number; claimed: number; note: string; created_at: string }
export interface CarCheck { id: string; day: string; status: 'requested' | 'checking' | 'review' | 'flagged' | 'ok' | 'rejected' | 'missed'; requested_at: string; due_at: string; submitted_at: string | null; ai_verdict: string; ai_score: number | null; ai_note: string; points: number | null; decided_by: string; photos?: { id: string; zone: 'ext' | 'int' | 'box'; url: string }[]; name?: string; tg_id?: string }
export interface CarService { id: string; label: string; interval: number; last_km: number | null; next_km: number; left: number; state: 'ok' | 'soon' | 'overdue'; manual?: boolean; estimated?: boolean }
export interface CarFuel { id: string; km: number; amount: number | null; liters: number | null; ai_note: string; created_at: string; photo: string | null }
export interface CarInfo { make: string; model: string; year: number | null; plate: string; fuel: string; mileage: number; mileage_start: number; mileage_at: string | null; service_interval: number; body?: string; body_auto?: boolean }
export interface CarDoc { id: string; kind: string; label: string; icon: string; number: string; company: string; starts: string | null; expires: string; amount: number | null; note: string; days_left: number; state: 'ok' | 'soon' | 'urgent' | 'expired'; created_at: string }
export interface CarServiceCosts { total: number; month: number; year: number; docs_year: number; count: number; by_item: { id: string; label: string; amount: number }[] }
export interface CarStats { mileage: number; km_total: number; km_month: number; fuel_month: number; fuel_total: number; refuels_month: number; expenses_month?: number; expenses_by_kind?: Record<string, number>; expenses_prev_month?: number; service_month?: number; docs_month?: number; spend_month?: number; month_label?: string; prev_month_label?: string; fuel_prev_month?: number; liters_month: number; per100: number | null; cost_km: number | null; last_refuel: string | null }
export interface CarDeleteRequest { id: string; tg_id: string; name: string; label: string; created_at: string }
export interface CarRes {
  on: boolean; ai: boolean; photos_need: Record<'ext' | 'int' | 'box', [number, number]>; fuels: Record<string, string>; items: { id: string; label: string }[];
  car: CarInfo | null; to?: { left: number; next_km: number; interval: number; state: string } | null; stats?: CarStats; service?: CarService[];
  tips?: { id: string; title: string; text: string; ai?: boolean }[]; fuel?: CarFuel[]; pending: CarCheck | null; checks?: CarCheck[]; xp?: number;
  delete_request?: { status: 'pending' | 'approved' | 'rejected' } | null;
  expenses?: CarExpense[]; expense_kinds?: Record<string, { label: string; icon: string; liters?: boolean }>;
  bodies?: Record<string, string>; doc_kinds?: Record<string, { label: string; icon: string }>; docs?: CarDoc[]; service_costs?: CarServiceCosts;
}
export interface CarSettings { on: boolean; checks_per_week: number; from_hour: number; to_hour: number; deadline_hour: number; points_min: number; points_max: number; photos: Record<'ext' | 'int' | 'box', [number, number]>; service_interval: number; service_km?: Record<string, number> }
export interface CarExpense { id: string; kind: string; amount: number; liters: number | null; km: number | null; note: string; created_at: string }
export interface CarFleetItem { tg_id: string; name: string; car: string | null; body?: string; service_due?: { overdue: number; soon: number; first: string; left: number } | null; docs_alert?: { label: string; days_left: number; state: string; count: number } | null; year?: number | null; plate?: string; mileage?: number; to_left?: number | null; fuel_month?: number; expenses_month?: number; spend_month?: number; km_month?: number; cost_km?: number | null; last_check?: { status: string; day: string; points: number | null } | null }
export interface CarFleet { settings: CarSettings; service_items?: { id: string; label: string; km: number; fuels: string[] | null }[]; ai: boolean; items: CarFleetItem[]; queue: CarCheck[]; delete_requests: CarDeleteRequest[] }
export interface CarDetail extends CarRes { user: { tg_id: string; name: string }; service_log: { item: string; label: string; km: number; note: string; amount: number | null; created_at: string }[] }

/* ---------- v49: CRM-коннектор ---------- */
export type CrmProvider = 'amocrm' | 'bitrix24' | 'webhook';
export interface CrmSettings {
  provider: CrmProvider | null; enabled: boolean;
  amocrm: { domain: string; token_set: boolean; token_masked: string };
  bitrix24: { url_set: boolean; url_masked: string; won_stage: string };
  webhook: { url: string; secret_set: boolean; secret_masked: string; include_pdf: boolean };
  inbound: { enabled: boolean; url: string };
}

/* ---------- v52: Касса ---------- */
export interface CashHandover { id: string; expected_amount: number; created_at: string }
export interface CashHandoverDone { id: string; expected_amount: number; received_amount: number | null; status: 'ok' | 'short'; created_at: string; decided_at: string | null }
export interface CashWithdrawal { id: string; amount: number; reason: string; status?: 'pending' | 'approved' | 'rejected'; created_at: string; decided_at?: string | null }
export interface CashAdjustment { id: string; amount: number; reason: string; created_at: string; created_by: string }
export interface CashMe {
  balance: number; pending: CashHandover | null; pending_withdrawals: CashWithdrawal[]; withdrawals: CashWithdrawal[]; history: CashHandoverDone[]; adjustments: CashAdjustment[];
  /** лимит наличных на руках (null — без лимита) */
  limit?: number | null; over?: boolean;
  last_handover?: { amount: number | null; status: string; at: string | null } | null;
}
export interface CashOverviewItem { tg_id: string; name: string; balance: number; pending_handover: CashHandover | null; pending_withdrawals: number; limit?: number | null; own_limit?: boolean; over?: boolean }
export interface CashWithdrawalReq extends CashWithdrawal { tg_id: string; name: string }
export interface CashOverview { items: CashOverviewItem[]; withdrawals: CashWithdrawalReq[]; limit?: number; total?: number }

/* ---------- v56: скан QR с главной ---------- */
export interface ScanLookup {
  state: 'found' | 'new' | 'inactive'; code: string;
  object: { id: string; company_name: string; address: string } | null;
  trap: { number: number; kind: string; location: string; prepared?: boolean } | null;
  task_ids: string[]; visit_id: string | null;
  /** станция лежит в запасе (без объекта) */
  stock?: boolean;
}

/** Подготовка ловушек к заявке (до выезда). */
export interface PrepState {
  object: { id: string; company_name: string; address: string };
  traps: { id: string; code: string; number: number; kind: string; target: string; location: string; prepared: boolean; prepared_by?: string }[];
  next_number: number;
  /** станций в запасе (без объекта) */
  stock: number;
  /** клиент отказался, станции оставлены за ним «на другой раз» */
  skip: boolean;
  moved?: number; taken?: number; missing?: number; from_stock?: boolean; new_code?: boolean; busy?: string;
}
export type PrepTrap = PrepState['traps'][number];
/** Заявка в списке «Подготовить ловушки»: свои и коллег. */
export type PrepTask = Task & { mine: boolean; prepared: number };
