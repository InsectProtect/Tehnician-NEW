import { authHeader, setAppToken } from './telegram';
import type {
  AdminStats, AdminVisit, BotStatus, KpiRes, MonthSummary, NotificationsRes, RemarksRes, TasksStats, PestsStats, AuditItem, Bootstrap, CompanySettings, Task, BootstrapPartial, Company, ImportStats, Invite, Lead, Observation, OfficeChat,
  RecBlock, StaffUser, AnnulRequest, PointsConfig, KpiPlanRes, KpiSettings, MyPlan, Specialist, SpecialistDetail, KpiPlanRow, TimelinessRow, OfficeCall, AdjRule, KpiAdjust, RemarkType, CoachMsg, MediaSettings, MyMedia, MediaPost, MediaStats, Job, Assignee, JobInput, AdminTaskInput, Features, ContestRes, ContestSettings, RecalcRes, Payment, GameState, ShiftState, InboxRes, RouteInfo, LiveItem, Reward, GeoSettings, GuardRes, GuardSettings, Announcement, AnnouncementAdmin, MgrMe, MgrGame, RoomsDispute, CarRes, CarFleet, CarDetail, CarSettings, CrmSettings, CallOutcome, SalesList, SalesDetail, SalesCfg, SalesSettings, AnnouncementInput, Audience, InspectionInput, ScanResult, SiteObject, Trap, Visit, VisitSummary, CashMe, CashOverview, ScanLookup,
} from './types';

// Сессия после ввода PIN хранится только в памяти: закрыли приложение — PIN спросят снова.
let session = '';
let onLocked: (() => void) | null = null;
export const setSession = (t: string) => { session = t; };
export const onSessionLost = (fn: () => void) => { onLocked = fn; };
let onAppLogin: (() => void) | null = null;
export const onAppLoginNeeded = (fn: () => void) => { onAppLogin = fn; };

export class ApiError extends Error {
  constructor(message: string, public code?: string, public data?: Record<string, unknown>) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      Authorization: authHeader(),
      ...(session ? { 'X-Session': session } : {}),
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && data.code === 'app_login') { setAppToken(''); onAppLogin?.(); }
    if (res.status === 401 && data.code === 'pin') {
      session = '';
      onLocked?.();
    }
    throw new ApiError(data.error || `Ошибка ${res.status}`, data.code, data);
  }
  return data as T;
}

const qs = (o: Record<string, string | undefined>) =>
  Object.entries(o).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join('&');

export const api = {
  appLoginStart: (device: string) => request<{ code: string; link: string; tg_link: string; expires_in: number }>('POST', '/api/app/login', { device }),
  appLoginPoll: (code: string) => request<{ status: 'pending' | 'ok' | 'denied' | 'expired'; token?: string }>('GET', `/api/app/login/${code}`),
  appLogoutAll: () => request<{ ok: true }>('POST', '/api/app/logout-all'),
  bootstrap: () => request<Bootstrap | BootstrapPartial>('GET', '/api/bootstrap'),
  setPin: (pin: string) => request<{ token: string }>('POST', '/api/pin/set', { pin }),
  verifyPin: (pin: string) => request<{ token: string }>('POST', '/api/pin/verify', { pin }),
  invites: () => request<{ items: Invite[] }>('GET', '/api/admin/invites'),
  createInvite: (name: string, role: string) => request<Invite>('POST', '/api/admin/invites', { name, role }),
  deleteInvite: (code: string) => request<{ ok: true }>('DELETE', `/api/admin/invites/${code}`),
  adminStats: (p: { from?: string; to?: string }) => request<AdminStats>('GET', `/api/admin/stats?${qs(p)}`),
  adminVisits: (p: { from?: string; to?: string; tech?: string; procedure?: string; status?: string; q?: string }) =>
    request<{ from: string; to: string; items: AdminVisit[] }>('GET', `/api/admin/visits?${qs(p)}`),
  exportVisits: (p: Record<string, string | undefined>) => request<{ url: string }>('POST', '/api/admin/export', p),
  audit: () => request<{ items: AuditItem[] }>('GET', '/api/admin/audit'),
  reopenVisit: (id: string) => request<{ ok: true }>('POST', `/api/visits/${id}/reopen`),
  deleteVisit: (id: string, reason: string) => request<{ ok: true }>('DELETE', `/api/visits/${id}`, { reason }),
  requestAccess: (name: string, phone: string) => request<{ ok: true }>('POST', '/api/me/request', { name, phone }),
  users: () => request<{ items: StaffUser[] }>('GET', '/api/admin/users'),
  updateUser: (id: string, data: { status?: string; role?: string; name?: string; reset_pin?: boolean; perms?: string[] }) =>
    request<{ ok: true }>('PATCH', `/api/admin/users/${id}`, data),
  deleteUser: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/users/${id}`),
  setLang: (lang: 'ru' | 'ro') => request<{ ok: true; lang: string }>('PUT', '/api/me/lang', { lang }),
  officeChats: () => request<{ items: OfficeChat[]; webhook: boolean }>('GET', '/api/admin/office/chats'),
  setOffice: (chat: OfficeChat) => request<{ office: OfficeChat }>('POST', '/api/admin/office', chat),
  patchVisit: (id: string, data: {
    infestation?: string; preparation?: string; pests?: string[]; area?: string; location?: string; products?: string[];
    client_rep?: string; client_rep_function?: string; locality?: string; premises?: string[]; reentry?: string; address?: string; point_cat?: string; point_zone?: string; quick?: boolean; rooms?: number | null; sotki?: number | string | null;
  }) =>
    request<{ ok: true; recommendations: RecBlock[]; reentry: string; reentry_default: string }>('PATCH', `/api/visits/${id}`, data),
  addObservation: (visitId: string, data: { category: string; comment: string; photos: string[] }) =>
    request<{ observations: Observation[] }>('POST', `/api/visits/${visitId}/observations`, data),
  deleteObservation: (id: string) => request<{ ok: true }>('DELETE', `/api/observations/${id}`),
  shareVisit: (visitId: string, via: 'link' | 'bot' | 'qr' | 'file' | 'whatsapp' | 'telegram' | 'copy' = 'link') =>
    request<{ ok: true; url: string; text: string; phone: string; file_name: string; bot: string; qr_svg: string }>('POST', `/api/visits/${visitId}/share`, { via }),
  annulVisit: (visitId: string, reason: string) => request<{ ok: true; annulled?: boolean; requested?: boolean }>('POST', `/api/visits/${visitId}/annul`, { reason }),
  rejectAnnul: (visitId: string) => request<{ ok: true }>('POST', `/api/visits/${visitId}/annul/reject`),
  pointsConfig: () => request<{ config: PointsConfig; all_pests?: string[] }>('GET', '/api/admin/points'),
  recalcPoints: (month: string, dry: boolean) => request<RecalcRes>('POST', '/api/admin/points/recalc', { month, dry }),
  savePoints: (c: PointsConfig) => request<{ ok: true; config: PointsConfig }>('PUT', '/api/admin/points', c),
  setVisitPoints: (id: string, data: { points: number | null; reason?: string; point_cat?: string; point_zone?: string; mult?: number | string | null }) => request<{ ok: true; points: number | null }>('PUT', `/api/visits/${id}/points`, data),
  specialists: (month?: string) => request<{ month: string; month_label: string; items: Specialist[] }>('GET', `/api/admin/specialists${month ? `?month=${month}` : ''}`),
  specialist: (id: string) => request<SpecialistDetail>('GET', `/api/admin/specialists/${id}`),
  kpiPlan: (month?: string) => request<KpiPlanRes>('GET', `/api/admin/kpi-plan${month ? `?month=${month}` : ''}`),
  saveKpiSettings: (k: Partial<KpiSettings>) => request<{ ok: true; settings: KpiSettings }>('PUT', '/api/admin/kpi-settings', k),
  setPlan: (month: string, tgId: string, points: number | null) => request<{ ok: true }>('PUT', '/api/admin/kpi-plan', { month, tg_id: tgId, points }),
  sendPlans: (month: string, tgId?: string) => request<{ ok: true; sent: number }>('POST', '/api/admin/kpi-plan/send', { month, tg_id: tgId }),
  kpiAdjust: (month: string) => request<{ month: string; rules: AdjRule[]; items: KpiAdjust[] }>('GET', `/api/admin/kpi-adjust?month=${month}`),
  suggestAdjust: (month: string) => request<{ ok: true; proposed: number }>('POST', '/api/admin/kpi-adjust/suggest', { month }),
  addAdjust: (month: string, tgId: string, points: number, reason: string) => request<{ ok: true }>('POST', '/api/admin/kpi-adjust', { month, tg_id: tgId, points, reason }),
  decideAdjust: (id: string, data: { apply?: boolean; points?: number; undo?: boolean }) => request<{ ok: true }>('POST', `/api/admin/kpi-adjust/${id}/decide`, data),
  applyAllAdjust: (month: string) => request<{ ok: true; applied: number }>('POST', '/api/admin/kpi-adjust/apply-all', { month }),
  saveAdjRules: (rules: AdjRule[]) => request<{ ok: true; rules: AdjRule[] }>('PUT', '/api/admin/kpi-rules', { rules }),
  coach: () => request<{ week: string; items: CoachMsg[] }>('GET', '/api/admin/coach'),
  coachPrepare: () => request<{ ok: true; week: string; n: number }>('POST', '/api/admin/coach/prepare'),
  coachDecide: (id: string, send: boolean, text?: string) => request<{ ok: true }>('POST', `/api/admin/coach/${id}`, { send, text }),
  coachSendAll: () => request<{ ok: true; sent: number }>('POST', '/api/admin/coach-send-all'),
  myMedia: () => request<{ settings: MediaSettings; month_points: number; items: MyMedia[] }>('GET', '/api/me/media'),
  adminMedia: (f: { status?: string; tech?: string; kind?: string; month?: string } = {}) =>
    request<{ settings: MediaSettings; stats: MediaStats; techs: { id: string; name: string }[]; items: MediaPost[] }>('GET', `/api/admin/media?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}`),
  mediaSendMe: (id: string) => request<{ ok: true }>('POST', `/api/admin/media/${id}/send-me`),
  mediaReset: (id: string) => request<{ ok: true }>('POST', `/api/admin/media/${id}/reset`),
  decideMedia: (id: string, approve: boolean, points?: number) => request<{ ok: true; points: number; note: string }>('POST', `/api/admin/media/${id}/decide`, { approve, points }),
  saveMediaSettings: (m: MediaSettings) => request<{ ok: true }>('PUT', '/api/admin/media-settings', m),
  myPlan: () => request<{ plan: MyPlan | null }>('GET', '/api/me/plan'),
  ackPlan: () => request<{ ok: boolean }>('POST', '/api/me/plan/ack'),
  undoStart: (visitId: string) => request<{ ok: true; task_id: string }>('POST', `/api/visits/${visitId}/undo-start`),
  sendOffice: (visitId: string) => request<{ ok: true; office_sent_at: string }>('POST', `/api/visits/${visitId}/send-office`),
  companies: (q: string) => request<{ items: Company[] }>('GET', `/api/companies?q=${encodeURIComponent(q)}`),
  objects: (companyId: string) => request<{ items: SiteObject[] }>('GET', `/api/companies/${companyId}/objects`),
  addObject: (companyId: string, companyName: string, address: string) =>
    request<SiteObject>('POST', `/api/companies/${companyId}/objects`, { address, company_name: companyName }),
  leads: () => request<{ enabled: boolean; items: Lead[] }>('GET', '/api/leads'),
  startLead: (leadId: string, data: { procedure?: string; address?: string }) =>
    request<{ id: string }>('POST', `/api/leads/${leadId}/start`, data),
  visitGeo: (id: string, lat: number, lon: number) => request<{ ok: true; km: number; zone: string; zone_label: string }>('POST', `/api/visits/${id}/geo`, { lat, lon }),
  geoReverse: (lat: number, lon: number) => request<{ city: string; street: string; full: string; source: string }>('GET', `/api/geo/reverse?lat=${lat}&lon=${lon}`),
  approveTask: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${id}/approve`),
  createIndividual: (data: { contact: string; phone: string; city: string; street: string }) =>
    request<Company & { object: SiteObject }>('POST', '/api/clients', { individual: true, ...data }),
  approveVisit: (id: string, approve: boolean, note = '') => request<{ ok: true }>('POST', `/api/visits/${id}/approve`, { approve, note }),
  createClient: (data: { name: string; inn: string; legal_address?: string; contact?: string; rep_function?: string }) =>
    request<Company>('POST', '/api/clients', data),
  saveSettings: (data: { company?: CompanySettings; products?: Record<string, string[]>; act_template?: string; task_approval?: boolean }) =>
    request<{ company: CompanySettings; products: Record<string, string[]>; actTemplate: string }>('PUT', '/api/admin/settings', data),
  importClients: (filename: string, data: string) => request<ImportStats>('POST', '/api/clients/import', { filename, data }),
  visits: () => request<{ items: VisitSummary[] }>('GET', '/api/visits'),
  doneByTech: (period: 'month' | 'prev' | 'all', tech = '') =>
    request<{ period: string; total: number; revenue: number; points?: number; cash?: number; pay_counts?: Record<Payment, number>; techs: { id: string; name: string; count: number; revenue: number; points?: number; cash?: number }[]; items: (VisitSummary & { price: number | null; points?: number | null; payment?: Payment | ''; pay_amount?: number | null })[] }>(
      'GET', `/api/admin/done?period=${period}${tech ? `&tech=${encodeURIComponent(tech)}` : ''}`),
  createVisit: (objectId: string, procedure: string, extra: { reason?: string; pests?: string[]; premises?: string[]; rooms?: number } = {}) =>
    request<{ id: string; approval: string }>('POST', '/api/visits', { object_id: objectId, procedure, ...extra }),
  visit: (id: string) => request<{ visit: Visit; traps: Trap[]; observations: Observation[]; task: Task | null }>('GET', `/api/visits/${id}`),
  tasks: (all = false) => request<{ items: Task[]; cancelled: Task[]; month: MonthSummary; all_tasks: boolean; pending: Task[]; unacked: Task[]; annul_requests?: AnnulRequest[]; open_tasks?: Task[] }>('GET', `/api/tasks${all ? '?all=1' : ''}`),
  taskProgress: (id: string, data: { call?: string; en_route?: boolean }) => request<{ ok: true; task: Task }>('POST', `/api/tasks/${id}/progress`, data),
  ackTask: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${id}/ack`),
  setPrefs: (p: { all_tasks?: boolean; theme?: string; overview?: string[]; tabs_order?: string[]; tabs_hidden?: string[] }) => request<{ prefs: { all_tasks?: boolean; theme?: string; overview?: string[] } }>('POST', '/api/me/prefs', p),
  efficiency: () => request<{ month_label: string; min_plan_pct: number; items: KpiPlanRow[] }>('GET', '/api/admin/efficiency'),
  timeliness: (days = 30) => request<{ days: number; items: TimelinessRow[] }>('GET', `/api/admin/timeliness?days=${days}`),
  officeCall: (tgId: string, note: string) => request<{ ok: true; id: string }>('POST', '/api/admin/office-call', { tg_id: tgId, note }),
  cancelOfficeCall: (id: string) => request<{ ok: true }>('POST', `/api/admin/office-call/${id}/cancel`),
  officeCalls: () => request<{ items: OfficeCall[] }>('GET', '/api/admin/office-calls'),
  myOfficeCall: () => request<{ call: { id: string; note: string; by_name: string; created_at: string } | null }>('GET', '/api/me/office-call'),
  ackOfficeCall: (id: string) => request<{ ok: boolean }>('POST', `/api/me/office-call/${id}/ack`),
  botStatus: () => request<BotStatus>('GET', '/api/admin/bot-status'),
  resetWebhook: () => request<{ ok: true }>('POST', '/api/admin/bot-webhook'),
  kpi: (p: { months?: string; tech?: string } = {}) => request<KpiRes>('GET', `/api/kpi?${qs(p)}`),
  exportKpi: (months: number) => request<{ url: string }>('POST', '/api/admin/kpi/export', { months }),
  notifications: () => request<NotificationsRes>('GET', '/api/notifications'),
  readNotifications: () => request<{ ok: true }>('POST', '/api/notifications/read'),
  remarks: () => request<RemarksRes>('GET', '/api/admin/remarks'),
  saveRemarkTypes: (types: RemarkType[]) => request<{ ok: true; types: RemarkType[] }>('PUT', '/api/admin/remark-types', { types }),
  addRemark: (data: { tech_id?: string; visit_id?: string; text: string; type?: string }) => request<{ ok: true; tech: string }>('POST', '/api/admin/remarks', data),
  deleteRemark: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/remarks/${id}`),
  tasksStats: (p: { from?: string; to?: string }) => request<TasksStats>('GET', `/api/admin/tasks-stats?${qs(p)}`),
  pestsStats: (p: { from?: string; to?: string }) => request<PestsStats>('GET', `/api/admin/pests-stats?${qs(p)}`),
  startTask: (id: string, data: { procedure?: string; address?: string }) => request<{ id: string }>('POST', `/api/tasks/${id}/start`, data),
  taskPhone: (id: string) => request<{ ok: true; phone: string; bot: string }>('POST', `/api/tasks/${id}/phone`),
  clientCancel: (id: string, data: { reason: string; note: string }) => request<{ ok: true }>('POST', `/api/tasks/${id}/client-cancel`, data),
  reschedule: (id: string, data: { date: string; time: string; note: string }) => request<{ ok: true }>('POST', `/api/tasks/${id}/reschedule`, data),
  confirmReschedule: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${id}/reschedule/confirm`),
  restoreTask: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${id}/restore`),
  cancelTask: (id: string) => request<{ ok: true }>('POST', `/api/tasks/${id}/cancel`),
  scan: (visitId: string, text: string) => request<ScanResult>('POST', `/api/visits/${visitId}/scan`, { text }),
  registerTrap: (visitId: string, data: { code: string; number: number; kind: string; location: string; target?: string }) =>
    request<{ trap: Trap }>('POST', `/api/visits/${visitId}/traps`, data),
  saveInspection: (visitId: string, data: InspectionInput) =>
    request<{ ok: true }>('POST', `/api/visits/${visitId}/inspections`, data),
  cancelledCount: () => request<{ week: number; month: number }>('GET', '/api/admin/cancelled/count'),
  resetCancelled: (period: 'week' | 'month') => request<{ ok: true; count: number }>('POST', '/api/admin/cancelled/reset', { period }),
  setMonitoring: (visitId: string, enabled: boolean) => request<{ ok: true }>('POST', `/api/visits/${visitId}/monitoring`, { enabled }),
  finish: (visitId: string, comment: string, extra: { docs?: { proces: boolean; anexa: boolean; obs?: boolean; traps?: boolean }; signature?: string; payment?: Payment; pay_amount?: string; pay_note?: string } = {}) =>
    request<{ ok: true; report_url: string; amo_error: string | null; office_sent: boolean; office_error: string | null; office_none?: boolean; reward?: Reward | null }>('POST', `/api/visits/${visitId}/finish`, { comment, ...extra }),
  stamp: () => request<{ mode: 'default' | 'custom' | 'off'; image: string | null }>('GET', '/api/admin/stamp'),
  setStamp: (data: { mode: 'default' | 'custom' | 'off'; image?: string }) => request<{ ok: true }>('PUT', '/api/admin/stamp', data),
  labels: (count: number) => request<{ url: string }>('POST', '/api/labels', { count }),
  jobs: (all = false) => request<{ items: Job[] }>('GET', `/api/jobs${all ? '' : '?all=0'}`),
  assignees: () => request<{ items: Assignee[] }>('GET', '/api/admin/assignees'),
  createJob: (tg_ids: string[], data: JobInput, audience?: Audience) => request<{ items: Job[] }>('POST', '/api/admin/jobs', audience ? { audience, ...data } : { tg_ids, ...data }),
  guard: (all = false) => request<GuardRes>('GET', `/api/admin/guard${all ? '?status=all' : ''}`),
  saveGuard: (s: Partial<GuardSettings>) => request<{ ok: true; settings: GuardSettings }>('PUT', '/api/admin/guard', s),
  decideGuard: (id: string, status: 'ok' | 'fixed' | 'new', note = '') => request<{ ok: true }>('POST', `/api/admin/guard/${id}`, { status, note }),
  guardScan: () => request<{ ok: true; checked: number; found: number }>('POST', '/api/admin/guard-scan'),
  game: () => request<GameState>('GET', '/api/me/game'),
  shift: () => request<ShiftState>('GET', '/api/me/shift'),
  inbox: () => request<InboxRes>('GET', '/api/inbox'),
  inboxAck: (key: string) => request<{ ok: true; xp: number }>('POST', '/api/inbox/ack', { key }),
  moreWork: () => request<{ ok: true }>('POST', '/api/me/more-work'),
  taskRoute: (id: string) => request<RouteInfo>('GET', `/api/tasks/${id}/route`),
  adminLive: () => request<{ items: LiveItem[] }>('GET', '/api/admin/live'),
  geoSettings: () => request<{ settings: GeoSettings }>('GET', '/api/admin/geo-settings'),
  saveGeoSettings: (s: Partial<GeoSettings>) => request<{ ok: true; settings: GeoSettings }>('PUT', '/api/admin/geo-settings', s),
  claimJob: (id: string) => request<{ ok: true; name: string }>('POST', `/api/jobs/${id}/claim`),
  claimTask: (id: string) => request<{ ok: true; name: string }>('POST', `/api/tasks/${id}/claim`),
  announcements: () => request<{ items: Announcement[] }>('GET', '/api/announcements'),
  ackAnnouncement: (id: string) => request<{ ok: true }>('POST', `/api/announcements/${id}/ack`),
  adminAnnouncements: () => request<{ items: AnnouncementAdmin[] }>('GET', '/api/admin/announcements'),
  createAnnouncement: (a: AnnouncementInput) => request<{ ok: true; id: string; sent: number }>('POST', '/api/admin/announcements', a),
  deleteAnnouncement: (id: string) => request<{ ok: true }>('DELETE', `/api/admin/announcements/${id}`),
  updateJob: (id: string, data: Partial<JobInput>) => request<{ ok: true }>('PATCH', `/api/admin/jobs/${id}`, data),
  cancelJob: (id: string) => request<{ ok: true }>('POST', `/api/admin/jobs/${id}/cancel`),
  reopenJob: (id: string) => request<{ ok: true }>('POST', `/api/admin/jobs/${id}/reopen`),
  decideJob: (id: string, accept: boolean, points?: number | string, note?: string) => request<{ ok: true; points: number }>('POST', `/api/admin/jobs/${id}/decide`, { accept, points, note }),
  seenJob: (id: string) => request<{ ok: true }>('POST', `/api/jobs/${id}/seen`),
  deleteJobFile: (id: string, fid: string) => request<{ ok: true }>('DELETE', `/api/jobs/${id}/files/${fid}`),
  jobFileSendMe: (id: string, fid: string) => request<{ ok: true }>('POST', `/api/jobs/${id}/files/${fid}/send-me`),
  ackJob: (id: string) => request<{ ok: true }>('POST', `/api/jobs/${id}/ack`),
  jobProgress: (id: string, done_count: number) => request<{ ok: true; done_count: number }>('POST', `/api/jobs/${id}/progress`, { done_count }),
  submitJob: (id: string, report: string, done_count?: number) => request<{ ok: true }>('POST', `/api/jobs/${id}/submit`, { report, done_count }),
  setTaskMult: (id: string, mult: number | string | null) => request<{ ok: true; mult: number | null }>('POST', `/api/tasks/${id}/mult`, { mult }),
  setTaskTeam: (id: string, team: string[]) => request<{ ok: true }>('POST', `/api/tasks/${id}/team`, { team }),
  reviewJob: (id: string, accept: boolean, note?: string) => request<{ ok: true; points: number }>('POST', `/api/jobs/${id}/review`, { accept, note }),
  saveFeatures: (f: Partial<Features>) => request<{ ok: true; features: Features }>('PUT', '/api/admin/features', f),
  contest: () => request<ContestRes>('GET', '/api/contest'),
  saveContest: (c: Partial<ContestSettings>) => request<{ ok: true; settings: ContestSettings }>('PUT', '/api/admin/contest', c),
  createAdminTask: (data: AdminTaskInput) => request<{ ok: true; id: string; task_no: number; open?: boolean }>('POST', '/api/admin/tasks', data),
  // KPI менеджеров, «Звонилка»
  mgrMe: (month?: string) => request<MgrMe>('GET', `/api/mgr/me${month ? `?month=${month}` : ''}`),
  mgrCall: (d: { outcome: CallOutcome; amount?: string; sub?: boolean; b2b?: boolean; client?: string; phone?: string; note?: string; callback_at?: string; from_callback?: string }) =>
    request<{ ok: true; id: string; xp: number; events: { kind: string; text: string }[]; game: MgrGame }>('POST', '/api/mgr/calls', d),
  mgrCallUndo: (id: string) => request<{ ok: true; game: MgrGame }>('DELETE', `/api/mgr/calls/${id}`),
  mgrCallbackDone: (id: string) => request<{ ok: true }>('POST', `/api/mgr/callbacks/${id}/done`),
  taskFill: (id: string, d: Record<string, string>) => request<{ ok: true; missing: string[] }>('POST', `/api/tasks/${id}/fill`, d),
  adminSales: (month?: string) => request<SalesList>('GET', `/api/admin/sales${month ? `?month=${month}` : ''}`),
  adminSalesOne: (tg: string, month?: string) => request<SalesDetail>('GET', `/api/admin/sales/${tg}${month ? `?month=${month}` : ''}`),
  saveSalesConfig: (tg: string, d: { cfg?: Partial<SalesCfg>; preset?: string; all?: boolean }) => request<{ ok: true; cfg: SalesCfg }>('PUT', `/api/admin/sales/${tg}/config`, d),
  saveSalesFacts: (tg: string, month: string, data: Record<string, string | number>) => request<{ ok: true }>('PUT', `/api/admin/sales/${tg}/facts/${month}`, { data }),
  saveSalesSettings: (s: Partial<SalesSettings>) => request<{ ok: true; settings: SalesSettings }>('PUT', '/api/admin/sales-settings', s),
  addStrike: (tg: string, note: string, month?: string) => request<{ ok: true; id: string; tier: number; pct: number }>('POST', `/api/admin/sales/${tg}/strike`, { note, month }),
  removeStrike: (tg: string, id: string) => request<{ ok: true }>('DELETE', `/api/admin/sales/${tg}/strike/${id}`),
  // v47: комнаты, «Мой авто»
  roomsError: (visitId: string, rooms: number, note: string) => request<{ ok: true }>('POST', `/api/visits/${visitId}/rooms-error`, { rooms, note }),
  roomsDisputes: () => request<{ items: RoomsDispute[] }>('GET', '/api/rooms-disputes'),
  decideRooms: (id: string, d: { ok?: boolean; rooms?: number }) => request<{ ok: true }>('POST', `/api/rooms-disputes/${id}`, d),
  car: () => request<CarRes>('GET', '/api/car'),
  saveCar: (d: Record<string, string | number | null>) => request<CarRes>('PUT', '/api/car', d),
  carFuel: (d: { km: string; amount: string; liters: string; photo: string }) => request<CarRes & { xp: number }>('POST', '/api/car/fuel', d),
  carMileage: (km: string) => request<CarRes & { xp: number }>('POST', '/api/car/mileage', { km }),
  carService: (d: { item: string; km: string; note?: string }) => request<CarRes & { xp: number }>('POST', '/api/car/service', d),
  carCheckSubmit: (id: string, d: { ext: string[]; int: string[]; box: string[] }) => request<{ ok: true; xp: number }>('POST', `/api/car/checks/${id}/submit`, d),
  adminCars: () => request<CarFleet>('GET', '/api/admin/cars'),
  adminCar: (tg: string) => request<CarDetail>('GET', `/api/admin/cars/${tg}`),
  decideCarCheck: (id: string, d: { ok: boolean; points?: number; note?: string }) => request<{ ok: true }>('POST', `/api/admin/car-checks/${id}`, d),
  requestCarCheck: (tg: string) => request<{ ok: true }>('POST', `/api/admin/car-request/${tg}`),
  saveCarSettings: (s: Partial<CarSettings>) => request<{ ok: true; settings: CarSettings }>('PUT', '/api/admin/car-settings', s),
  carDeleteRequest: () => request<{ ok: true; id: string }>('POST', '/api/car/delete-request'),
  adminCarDelete: (tg: string) => request<{ ok: true }>('DELETE', `/api/admin/cars/${tg}`),
  decideCarDelete: (id: string, ok: boolean) => request<{ ok: true }>('POST', `/api/admin/car-delete-requests/${id}`, { ok }),
  getCrm: () => request<CrmSettings>('GET', '/api/admin/crm'),
  saveCrm: (d: { provider?: 'amocrm' | null; enabled?: boolean; amocrm?: { domain?: string; access_token?: string } }) => request<{ ok: true }>('PUT', '/api/admin/crm', d),
  disconnectCrm: () => request<{ ok: true }>('POST', '/api/admin/crm/disconnect'),
  setTaskCrmLead: (id: string, crm_lead_id: string) => request<{ ok: true; crm_lead_id: string }>('PUT', `/api/tasks/${id}/crm-lead`, { crm_lead_id }),
  cashMe: () => request<CashMe>('GET', '/api/cash/me'),
  cashHandover: () => request<{ ok: true; id: string; expected: number }>('POST', '/api/cash/handover'),
  cashWithdraw: (amount: string, reason: string) => request<{ ok: true; id: string }>('POST', '/api/cash/withdraw', { amount, reason }),
  cashOverview: () => request<CashOverview>('GET', '/api/admin/cash'),
  cashConfirm: (id: string, received_amount: string) => request<{ ok: true; status: 'ok' | 'short'; shortfall: number }>('POST', `/api/admin/cash/handover/${id}/confirm`, { received_amount }),
  cashDecideWithdraw: (id: string, ok: boolean) => request<{ ok: true }>('POST', `/api/admin/cash/withdraw/${id}/decide`, { ok }),
  scanLookup: (text: string) => request<ScanLookup>('POST', '/api/scan', { text }),
  cashAdjust: (tg: string, balance: string, reason: string) => request<{ ok: true; balance: number }>('POST', '/api/admin/cash/adjust', { tg, balance, reason }),
};

/** Загрузка видео/фото «как есть» (без JSON), с прогрессом. */
export function uploadMedia(file: Blob, name: string, opts: { visitId?: string; caption?: string }, onProgress?: (p: number) => void): Promise<{ ok: true; id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const q = new URLSearchParams();
    if (opts.visitId) q.set('visit_id', opts.visitId);
    if (opts.caption) q.set('caption', opts.caption);
    xhr.open('POST', `/api/media${q.toString() ? `?${q}` : ''}`);
    xhr.setRequestHeader('Authorization', authHeader());
    if (session) xhr.setRequestHeader('X-Session', session);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data: { error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as { ok: true; id: string });
      else reject(new ApiError(data.error || `Ошибка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError('Нет связи — попробуйте ещё раз'));
    xhr.send(file);
  });
}

/** Файл к поручению (видео, фото, документ) — «как есть», с прогрессом. */
export function uploadJobFile(jobId: string, file: Blob, name: string, onProgress?: (p: number) => void): Promise<{ ok: true; id: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `/api/jobs/${jobId}/files`);
    xhr.setRequestHeader('Authorization', authHeader());
    if (session) xhr.setRequestHeader('X-Session', session);
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(name));
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => {
      let data: { error?: string } = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as { ok: true; id: string });
      else reject(new ApiError(data.error || `Ошибка ${xhr.status}`));
    };
    xhr.onerror = () => reject(new ApiError('Нет связи — попробуйте ещё раз'));
    xhr.send(file);
  });
}

/* ---------- большие файлы: прямо в хранилище (S3/R2), если оно подключено; иначе — как раньше через сервер в Telegram ---------- */
type StartRes = { mode: 'telegram' | 's3'; id?: string; put_url?: string; max?: number };
function putDirect(url: string, file: Blob, onProgress?: (p: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    if (file.type) xhr.setRequestHeader('Content-Type', file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new ApiError(`Хранилище не приняло файл (${xhr.status})`)));
    xhr.onerror = () => reject(new ApiError('Связь прервалась — загрузите этот файл ещё раз'));
    xhr.send(file);
  });
}
/** Видео/фото с объекта: каждый файл — отдельная запись и отдельная оценка офиса. */
export async function uploadMediaAny(file: Blob, name: string, opts: { visitId?: string; caption?: string }, onProgress?: (p: number) => void): Promise<{ ok: true; id: string }> {
  const s = await request<StartRes>('POST', '/api/media/start', { name, mime: file.type, size: file.size, visit_id: opts.visitId, caption: opts.caption });
  if (s.mode !== 's3' || !s.id || !s.put_url) return uploadMedia(file, name, opts, onProgress);
  try { await putDirect(s.put_url, file, onProgress); } catch (e) { request('DELETE', `/api/media/${s.id}/upload`).catch(() => {}); throw e; }
  return request<{ ok: true; id: string }>('POST', `/api/media/${s.id}/complete`);
}
/** Файл к поручению (любой тип). */
export async function uploadJobFileAny(jobId: string, file: Blob, name: string, onProgress?: (p: number) => void): Promise<{ ok: true; id: string }> {
  const s = await request<StartRes>('POST', `/api/jobs/${jobId}/files/start`, { name, mime: file.type, size: file.size });
  if (s.mode !== 's3' || !s.id || !s.put_url) return uploadJobFile(jobId, file, name, onProgress);
  try { await putDirect(s.put_url, file, onProgress); } catch (e) { request('DELETE', `/api/jobs/${jobId}/files/${s.id}/upload`).catch(() => {}); throw e; }
  return request<{ ok: true; id: string }>('POST', `/api/jobs/${jobId}/files/${s.id}/complete`);
}
