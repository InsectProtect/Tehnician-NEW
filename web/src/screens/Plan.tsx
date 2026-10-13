import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { Camera, Check, DoorOpen, Warehouse, Eraser, ImagePlus, Layers, MapPin, Minus, Move, Pencil, Plus, Square, Trash2, Type, Undo2, X, ZoomIn, ZoomOut } from 'lucide-react';
import { api } from '../api';
import { useConfig } from '../config';
import { compressImage } from '../image';
import { haptic } from '../telegram';
import type { ObjectPlan, PlanShape, PlanTrap, PlansRes, Trap } from '../types';
import { Button, Input, Spinner, cx, useToast } from '../components/ui';

/* ================================================================================================
 * План объекта (v78): чертёж (фото/скан) и/или план, нарисованный здесь же, + точки станций.
 * Режимы: «Смотреть» (цвет точки — результат проверки в этом выезде), «Станции» (поставить/передвинуть),
 * «Рисовать» (помещения, стены, двери, подписи, ластик, отмена). Координаты — в единицах плана (ширина 1000).
 * ================================================================================================ */

type Mode = 'view' | 'place' | 'draw';
type Tool = 'move' | 'rect' | 'line' | 'door' | 'gate' | 'text' | 'spot' | 'erase';
/** Что ставим заранее (без QR): назначение + устройство. */
const SPOT_TYPES = [
  { id: 'rod', target: 'rodents', kind: 'Родентицидная станция', label: '● Грызуны · яд' },
  { id: 'rglue', target: 'rodents', kind: 'Клеевая ловушка', label: '● Грызуны · липучка' },
  { id: 'eco', target: 'rodents', kind: 'Эко-станция (картон, клей)', label: '● Грызуны · эко' },
  { id: 'glue', target: 'crawling', kind: 'Клеевая ловушка', label: '◆ Ползающие · липучка' },
  { id: 'fer', target: 'crawling', kind: 'Феромонная ловушка', label: '◆ Ползающие · феромон' },
  { id: 'fly', target: 'flying', kind: 'Феромонная ловушка', label: '▲ Летающие · феромон' },
  { id: 'lamp', target: 'flying', kind: 'Инсектицидная лампа', label: '✦ Лампа' },
];
const isLamp = (kind: string) => /ламп/i.test(kind || '');
/** Устройство станции → цвет обводки и подпись на плане. */
export function deviceStyle(kind: string): { color: string; tag: string; name: string } {
  const k = kind || '';
  if (/ламп/i.test(k)) return { color: '#E0A100', tag: 'лампа', name: 'лампа' };
  if (/эко/i.test(k)) return { color: '#A2845E', tag: 'эко', name: 'эко-картон с липучкой' };
  if (/родентиц|яд|отрав/i.test(k)) return { color: '#7D3CFF', tag: 'яд', name: 'с отравой' };
  if (/феромон/i.test(k)) return { color: '#1FA6BF', tag: 'фер', name: 'феромон' };
  if (/клеев|липуч/i.test(k)) return { color: '#0A84FF', tag: 'клей', name: 'с липучкой' };
  return { color: '#636366', tag: '', name: k };
}
const LEGEND_DEVICES = ['Родентицидная станция', 'Клеевая ловушка', 'Эко-станция (картон, клей)', 'Феромонная ловушка', 'Инсектицидная лампа'];

const STATUS_FILL: Record<string, string> = { ok: '#34C759', replaced: '#34C759', activity: '#FF3B30', damaged: '#1D1D1F', missing: '#1D1D1F', no_access: '#FF9500' };
const R0 = 28; // радиус точки станции в единицах плана (× размер значков плана)
const snap = (v: number) => Math.round(v / 10) * 10;

/** Значок станции: грызуны — круг, ползающие — ромб, летающие — треугольник. */
function Marker({ t, x, y, fill: fill0, ring, dim, onClick, ms = 1 }: { t: PlanTrap; x: number; y: number; fill: string; ring?: boolean; dim?: boolean; onClick?: () => void; ms?: number }) {
  const R = R0 * ms;
  const dev = deviceStyle(t.kind);
  let fill = fill0;
  // без результатов проверки (подготовка, план) — заливка цветом устройства
  if (fill === '#0066CC') fill = dev.color;
  const txt = fill === '#E5E5EA' || fill === '#FFFFFF' ? '#1D1D1F' : '#FFFFFF';
  const sw = 6 * ms;
  const shape = isLamp(t.kind)
    ? <g><circle cx={x} cy={y} r={R * 1.05} fill={fill} stroke={dev.color} strokeWidth={sw} />{[0, 45, 90, 135, 180, 225, 270, 315].map((a) => <line key={a} x1={x + Math.cos((a * Math.PI) / 180) * R * 1.25} y1={y + Math.sin((a * Math.PI) / 180) * R * 1.25} x2={x + Math.cos((a * Math.PI) / 180) * R * 1.65} y2={y + Math.sin((a * Math.PI) / 180) * R * 1.65} stroke={fill === '#FFFFFF' || fill === '#E5E5EA' ? '#8E8E93' : fill} strokeWidth={5} strokeLinecap="round" />)}</g>
    : t.target === 'crawling'
    ? <rect x={x - R * 0.85} y={y - R * 0.85} width={R * 1.7} height={R * 1.7} rx={5} transform={`rotate(45 ${x} ${y})`} fill={fill} stroke={dev.color} strokeWidth={sw} />
    : t.target === 'flying'
      ? <path d={`M${x} ${y - R * 1.15} L${x + R * 1.1} ${y + R * 0.8} L${x - R * 1.1} ${y + R * 0.8} Z`} fill={fill} stroke={dev.color} strokeWidth={sw} strokeLinejoin="round" />
      : <circle cx={x} cy={y} r={R} fill={fill} stroke={dev.color} strokeWidth={sw} />;
  return (
    <g onClick={onClick ? (e) => { e.stopPropagation(); onClick(); } : undefined} style={{ cursor: onClick ? 'pointer' : undefined }} opacity={dim ? 0.45 : 1}>
      {ring && <circle cx={x} cy={y} r={R * 2} fill="#0066CC" opacity={0.18}><animate attributeName="r" values={`${R * 1.4};${R * 2.3};${R * 1.4}`} dur="1.6s" repeatCount="indefinite" /></circle>}
      {ring && <circle cx={x} cy={y} r={R * 1.45} fill="none" stroke="#0066CC" strokeWidth={5} />}
      {shape}
      <text x={x} y={y + 9.5 * ms} textAnchor="middle" fontSize={27 * ms} fontWeight={800} fill={txt} fontFamily="-apple-system,system-ui,sans-serif" style={{ pointerEvents: 'none' }}>{t.number || '•'}</text>
      {dev.tag && (
        <g style={{ pointerEvents: 'none' }}>
          <rect x={x - ((dev.tag.length * 12.5 + 16) * ms) / 2} y={y + R + 7 * ms} width={(dev.tag.length * 12.5 + 16) * ms} height={30 * ms} rx={15 * ms} fill={dev.color} stroke="#fff" strokeWidth={3 * ms} />
          <text x={x} y={y + R + 29 * ms} textAnchor="middle" fontSize={22 * ms} fontWeight={700} fill="#fff" fontFamily="-apple-system,system-ui,sans-serif">{dev.tag}</text>
        </g>
      )}
    </g>
  );
}

function Drawing({ shapes, h, onErase, onDown, ms = 1 }: { shapes: PlanShape[]; h: number; onErase?: (i: number) => void; onDown?: (i: number, e: RPointerEvent<SVGElement>) => void; ms?: number }) {
  const R = R0 * ms;
  return (
    <g>
      {shapes.map((s, i) => {
        const click = onErase ? () => onErase(i) : undefined;
        const hit = onErase ? { style: { cursor: 'pointer' } } : onDown ? { style: { cursor: 'move' }, onPointerDown: (e: RPointerEvent<SVGElement>) => onDown(i, e) } : {};
        if (s.t === 'rect') {
          return (
            <g key={i} onClick={click} {...hit}>
              <rect x={s.x} y={s.y} width={s.w} height={s.h} fill="#FFFFFF" fillOpacity={0.55} stroke="#1D1D1F" strokeWidth={6} />
              {s.label && <text x={s.x + s.w / 2} y={s.y + s.h / 2 + 8} textAnchor="middle" fontSize={Math.max(16, Math.min(30, s.w / 8))} fontWeight={700} fill="#8E8E93" fontFamily="-apple-system,system-ui,sans-serif">{s.label.toUpperCase()}</text>}
            </g>
          );
        }
        if (s.t === 'spot') {
          // запланированная станция: пунктирный контур с номером
          const pt0 = { id: s.id, code: '', number: s.n, kind: s.kind, target: s.target, location: '', prepared: false, plan_id: null, plan_x: s.x, plan_y: s.y };
          return (
            <g key={i} onClick={click} {...hit}>
              <circle cx={s.x} cy={s.y} r={R * 1.25} fill="#FFFFFF" fillOpacity={0.85} stroke="#0066CC" strokeWidth={4 * ms} strokeDasharray={`${7 * ms} ${6 * ms}`} />
              <g opacity={0.55}><Marker t={pt0} x={s.x} y={s.y} fill="#8E8E93" ms={ms} /></g>
            </g>
          );
        }
        if (s.t === 'gate') {
          const dx = s.x2 - s.x1; const dy = s.y2 - s.y1; const len = Math.hypot(dx, dy) || 1;
          const nx = (-dy / len) * 14; const ny = (dx / len) * 14;
          return (
            <g key={i} onClick={click} {...hit}>
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#FFFFFF" strokeWidth={14} />
              <line x1={s.x1 + nx} y1={s.y1 + ny} x2={s.x2 + nx} y2={s.y2 + ny} stroke="#FF9500" strokeWidth={6} strokeDasharray="16 8" />
              <line x1={s.x1} y1={s.y1} x2={s.x1 + nx * 2} y2={s.y1 + ny * 2} stroke="#FF9500" strokeWidth={6} />
              <line x1={s.x2} y1={s.y2} x2={s.x2 + nx * 2} y2={s.y2 + ny * 2} stroke="#FF9500" strokeWidth={6} />
              <text x={(s.x1 + s.x2) / 2} y={(s.y1 + s.y2) / 2 + 7} textAnchor="middle" fontSize={20} fontWeight={700} fill="#C93400" fontFamily="-apple-system,system-ui,sans-serif">ворота</text>
            </g>
          );
        }
        if (s.t === 'line') return <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#1D1D1F" strokeWidth={8} strokeLinecap="round" onClick={click} {...hit} />;
        if (s.t === 'door') {
          const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1);
          return (
            <g key={i} onClick={click} {...hit}>
              <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke="#FFFFFF" strokeWidth={12} />
              <path d={`M${s.x1} ${s.y1} L${s.x2} ${s.y2} A${len} ${len} 0 0 0 ${s.x1 + (s.y2 - s.y1)} ${s.y1 - (s.x2 - s.x1)} Z`} fill="#0066CC" fillOpacity={0.06} stroke="#0066CC" strokeWidth={3} strokeDasharray="8 6" />
            </g>
          );
        }
        return <text key={i} x={s.x} y={s.y} textAnchor="middle" fontSize={26} fontWeight={700} fill="#1D1D1F" fontFamily="-apple-system,system-ui,sans-serif" onClick={click} {...hit}>{s.s}</text>;
      })}
      <rect width={1000} height={h} fill="none" />
    </g>
  );
}

/** Привязка заранее нарисованного плана: юрлицо/физлицо + фактический адрес объекта. */
function AttachForm({ draft, onDone, onCancel }: { draft: string; onDone: (o: { company_name: string; address: string }) => void; onCancel: () => void }) {
  const toast = useToast();
  const [kind, setKind] = useState<'company' | 'person'>('company');
  const [company, setCompany] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = address.trim().length >= 3 && (kind === 'company' ? company.trim().length >= 2 : phone.replace(/\D/g, '').length >= 6);
  async function save() {
    setBusy(true);
    try {
      const r = await api.attachPlan({ draft, kind, company: company.trim(), phone: phone.trim(), address: address.trim() });
      haptic.success();
      onDone(r.object);
    } catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
  }
  return (
    <div className="fixed inset-0 z-[55] flex items-end bg-black/40" onClick={onCancel}>
      <div className="w-full rounded-t-[26px] bg-page px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between"><div className="text-[18px] font-semibold">Чей это объект?</div><button onClick={onCancel} className="p-1 text-muted"><X size={18} /></button></div>
        <div className="mb-3 text-[13.5px] leading-snug text-muted">Когда по этому клиенту и адресу начнётся обработка — план подтянется в выезд сам.</div>
        <div className="mb-3 flex rounded-xl bg-fill p-1">
          {([['company', 'Юрлицо'], ['person', 'Физлицо']] as const).map(([k, l]) => (
            <button key={k} onClick={() => { haptic.tap(); setKind(k); }} className={cx('flex-1 rounded-lg py-2 text-[14px] font-semibold', kind === k ? 'bg-card shadow-sm' : 'text-muted')}>{l}</button>
          ))}
        </div>
        <div className="space-y-2">
          {kind === 'company'
            ? <Input autoFocus placeholder="Название юрлица (SRL «…»)" value={company} onChange={(e) => setCompany(e.target.value)} />
            : <Input autoFocus inputMode="tel" placeholder="Телефон клиента" value={phone} onChange={(e) => setPhone(e.target.value)} />}
          <Input placeholder="Фактический адрес объекта (str. …, nr.)" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <Button className="mt-4" loading={busy} disabled={!ok} onClick={save} icon={<Check size={19} />}>Привязать план</Button>
      </div>
    </div>
  );
}

export function PlanSheet({ objectId, title, traps: visitTraps, focusId, placeId, onOpenTrap, onClose, draft: isDraftPlan }: {
  objectId: string; title?: string;
  /** план рисуют заранее, без клиента: после рисования — «Чей это объект?» */
  draft?: boolean;
  /** станции выезда (с результатами проверки) — для цвета точек */
  traps?: Trap[];
  /** подсветить станцию (только что отсканирована) */
  focusId?: string;
  /** сразу поставить эту станцию на план */
  placeId?: string;
  onOpenTrap?: (trapId: string) => void;
  onClose: () => void;
}) {
  const cfg = useConfig();
  const toast = useToast();
  const [d, setD] = useState<PlansRes | null>(null);
  const [planId, setPlanId] = useState('');
  const [mode, setMode] = useState<Mode>(placeId ? 'place' : 'view');
  const [sel, setSel] = useState<string>(placeId || '');
  const [card, setCard] = useState<string>(focusId || '');
  const [zoom, setZoom] = useState(1);
  const [msLocal, setMsLocal] = useState<number | null>(null); // размер значков (пока не сохранён)
  const canvasRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth - 24, h: el.clientHeight - 8 }));
    ro.observe(el);
    return () => ro.disconnect();
  }, [d?.plans.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  // рисование
  const [tool, setTool] = useState<Tool>('rect');
  const [spotType, setSpotType] = useState(SPOT_TYPES[0].id);
  const [shapes, setShapes] = useState<PlanShape[]>([]);
  const [hist, setHist] = useState<PlanShape[][]>([]);
  const [draft, setDraft] = useState<PlanShape | null>(null);
  const [ask, setAsk] = useState<{ kind: 'rect'; i: number } | { kind: 'text'; x: number; y: number } | null>(null);
  const [askText, setAskText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [newOpen, setNewOpen] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [rename, setRename] = useState<string | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const svgRef = useRef<SVGSVGElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const camRef = useRef<HTMLInputElement>(null);
  const galRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);

  const apply = (r: PlansRes, keep?: string) => {
    setD(r);
    const want = keep || planId;
    const pid = r.plans.find((p) => p.id === want)?.id
      || r.plans.find((p) => p.id === r.traps.find((t) => t.id === (focusId || placeId))?.plan_id)?.id
      || r.plans[0]?.id || '';
    setPlanId(pid);
  };
  useEffect(() => { api.objectPlans(objectId).then((r) => apply(r)).catch((e: Error) => toast(e.message, 'error')); }, [objectId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, []);

  // в режиме «Станции» сразу выбрана первая неотмеченная
  useEffect(() => {
    if (mode === 'place' && !sel && d) { const u = d.traps.find((t) => !t.plan_id); if (u) setSel(u.id); }
  }, [mode, d]); // eslint-disable-line react-hooks/exhaustive-deps
  const plan: ObjectPlan | undefined = d?.plans.find((p) => p.id === planId);
  const ms = msLocal ?? plan?.mscale ?? 0.8;
  // план вписывается в экран целиком (и на телефоне, и на большом мониторе); зум — от этого размера
  const baseW = plan && box.w > 0 ? Math.min(box.w, box.h > 120 ? (box.h * 1000) / plan.h : box.w) : 0;
  const msSave = useRef<number | undefined>(undefined);
  function changeMs(delta: number) {
    if (!plan) return;
    const v = Math.round(Math.max(0.3, Math.min(2, ms + delta)) * 100) / 100;
    setMsLocal(v); haptic.tap();
    window.clearTimeout(msSave.current);
    msSave.current = window.setTimeout(() => {
      api.savePlan(plan.id, { mscale: v }).then((r) => { setD((x) => (x ? { ...x, plans: x.plans.map((p) => (p.id === plan.id ? r.plan : p)) } : x)); setMsLocal(null); }).catch(() => {});
    }, 600);
  }
  useEffect(() => { setShapes(plan?.drawing || []); setHist([]); setDirty(false); }, [plan?.id, plan?.updated_at]); // eslint-disable-line react-hooks/exhaustive-deps

  const inspOf = (id: string) => visitTraps?.find((t) => t.id === id);
  const fillOf = (t: PlanTrap) => {
    if (t.prepared) return '#FFFFFF';
    if (!visitTraps) return '#0066CC';
    const i = inspOf(t.id)?.inspection;
    return i ? STATUS_FILL[i.status] || '#34C759' : '#E5E5EA';
  };
  const targetLabel = (id: string) => cfg.stationTargets.find((x) => x.id === id)?.label ?? '';
  const traps = d?.traps || [];
  const onPlan = traps.filter((t) => t.plan_id === planId && t.plan_x != null && t.plan_y != null);
  const unplaced = traps.filter((t) => !t.plan_id);
  const otherPlan = traps.filter((t) => t.plan_id && t.plan_id !== planId);

  /** Точка экрана → координаты плана. */
  function pt(e: { clientX: number; clientY: number }) {
    const svg = svgRef.current;
    if (!svg || !plan) return { x: 0, y: 0 };
    const m = svg.getScreenCTM();
    if (!m) return { x: 0, y: 0 };
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return { x: Math.max(0, Math.min(1000, p.x)), y: Math.max(0, Math.min(plan.h, p.y)) };
  }

  /** Ближайшая запланированная точка (тап рядом с ней — станция встаёт в неё). */
  const spots = (plan?.drawing || []).filter((x) => x.t === 'spot') as Extract<PlanShape, { t: 'spot' }>[];
  const nearSpot = (x: number, y: number) => spots
    .map((sp) => ({ sp, dist: Math.hypot(sp.x - x, sp.y - y) }))
    .filter((o) => o.dist < 60).sort((a, b) => a.dist - b.dist)[0]?.sp;
  async function place(trapId: string, x0: number, y0: number) {
    if (!plan) return;
    haptic.tap();
    const sp = nearSpot(x0, y0);
    const x = sp ? sp.x : x0; const y = sp ? sp.y : y0;
    // сразу на экране, потом сервер
    setD((r) => (r ? { ...r, traps: r.traps.map((t) => (t.id === trapId ? { ...t, plan_id: plan.id, plan_x: x, plan_y: y } : t)) } : r));
    try {
      const r = await api.placeTrap(trapId, { plan_id: plan.id, x, y, spot: sp?.id });
      apply(r, plan.id);
      const next = r.traps.find((t) => !t.plan_id && t.id !== trapId);
      if (placeId) { haptic.success(); toast('Станция отмечена на плане'); onClose(); return; }
      setSel(next?.id || '');
      if (!next) { haptic.success(); toast('Все станции на плане'); }
    } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function unplace(trapId: string) {
    try { apply(await api.placeTrap(trapId, { plan_id: null }), planId); setCard(''); toast('Убрана с плана'); } catch (e) { toast((e as Error).message, 'error'); }
  }

  // ---------- перетаскивание фигур (инструмент «Двигать») ----------
  const drag = useRef<{ i: number; x: number; y: number; orig: PlanShape } | null>(null);
  function startDrag(i: number, e: RPointerEvent<SVGElement>) {
    if (mode !== 'draw' || tool !== 'move') return;
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const p = pt(e);
    setHist((h) => [...h.slice(-40), shapes]);
    drag.current = { i, x: p.x, y: p.y, orig: shapes[i] };
  }
  const shift = (sh: PlanShape, dx: number, dy: number): PlanShape => {
    if (sh.t === 'line' || sh.t === 'door' || sh.t === 'gate') return { ...sh, x1: sh.x1 + dx, y1: sh.y1 + dy, x2: sh.x2 + dx, y2: sh.y2 + dy };
    return { ...sh, x: (sh as { x: number }).x + dx, y: (sh as { y: number }).y + dy } as PlanShape;
  };

  // ---------- рисование ----------
  const commit = (next: PlanShape[]) => { setHist((h) => [...h.slice(-40), shapes]); setShapes(next); setDirty(true); };
  function down(e: RPointerEvent<SVGSVGElement>) {
    if (mode !== 'draw' || tool === 'erase' || tool === 'move') return;
    const p = pt(e);
    if (tool === 'text') { setAsk({ kind: 'text', x: snap(p.x), y: snap(p.y) }); setAskText(''); return; }
    if (tool === 'spot') {
      const st = SPOT_TYPES.find((x) => x.id === spotType) || SPOT_TYPES[0];
      const used = [...(d?.traps || []).map((t) => t.number), ...shapes.filter((x) => x.t === 'spot').map((x) => (x as { n: number }).n)];
      const n = (used.length ? Math.max(...used) : 0) + 1;
      haptic.tap();
      commit([...shapes, { t: 'spot', id: Math.random().toString(36).slice(2, 10), x: Math.round(p.x), y: Math.round(p.y), target: st.target, kind: st.kind, n }]);
      return;
    }
    (e.target as Element).setPointerCapture?.(e.pointerId);
    start.current = { x: snap(p.x), y: snap(p.y) };
  }
  function move(e: RPointerEvent<SVGSVGElement>) {
    if (drag.current) {
      const p = pt(e); const g = drag.current;
      const dx = snap(p.x - g.x); const dy = snap(p.y - g.y);
      setShapes((all) => all.map((sh, j) => (j === g.i ? shift(g.orig, dx, dy) : sh)));
      return;
    }
    if (mode !== 'draw' || !start.current) return;
    const p = pt(e); const s = start.current;
    let x = snap(p.x); let y = snap(p.y);
    if (tool === 'rect') setDraft({ t: 'rect', x: Math.min(s.x, x), y: Math.min(s.y, y), w: Math.abs(x - s.x), h: Math.abs(y - s.y) });
    else {
      // стены и двери — строго горизонтально/вертикально, если почти ровно
      if (Math.abs(x - s.x) < Math.abs(y - s.y) * 0.25) x = s.x;
      if (Math.abs(y - s.y) < Math.abs(x - s.x) * 0.25) y = s.y;
      setDraft({ t: tool as 'line' | 'door' | 'gate', x1: s.x, y1: s.y, x2: x, y2: y });
    }
  }
  function up() {
    if (drag.current) { drag.current = null; setDirty(true); haptic.tap(); return; }
    if (mode !== 'draw' || !start.current) return;
    start.current = null;
    const dr = draft;
    setDraft(null);
    if (!dr) return;
    if (dr.t === 'rect' && (dr.w < 20 || dr.h < 20)) return;
    if ((dr.t === 'line' || dr.t === 'door' || dr.t === 'gate') && Math.hypot(dr.x2 - dr.x1, dr.y2 - dr.y1) < 20) return;
    haptic.tap();
    commit([...shapes, dr]);
    if (dr.t === 'rect') { setAsk({ kind: 'rect', i: shapes.length }); setAskText(''); }
  }
  function answer() {
    if (!ask) return;
    const v = askText.trim();
    if (ask.kind === 'text') { if (v) commit([...shapes, { t: 'text', x: ask.x, y: ask.y, s: v }]); }
    else if (v) setShapes((all) => all.map((s, i) => (i === ask.i && s.t === 'rect' ? { ...s, label: v } : s)));
    setAsk(null);
  }
  async function saveDrawing(then?: Mode) {
    if (!plan) return;
    setBusy(true);
    try {
      const r = await api.savePlan(plan.id, { drawing: shapes });
      setD((x) => (x ? { ...x, plans: x.plans.map((p) => (p.id === plan.id ? r.plan : p)) } : x));
      setDirty(false); haptic.success(); toast('План сохранён');
      if (then) setMode(then);
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }

  // ---------- новый план / чертёж ----------
  async function addPlan(body: { image?: string; orient?: 'land' | 'port' }) {
    setBusy(true);
    try {
      const r = await api.addPlan(objectId, { ...body, title: d?.plans.length ? `План ${d.plans.length + 1}` : 'План' });
      apply(r, r.plan?.id);
      setNewOpen(false);
      setMode(body.image ? (unplaced.length ? 'place' : 'view') : 'draw');
      if (!body.image) setTool('rect');
      haptic.success();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(false); }
  }
  async function pickImage(files: FileList | null, replace = false) {
    const f = files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { toast('Нужна картинка. PDF-чертёж — откройте и сделайте скриншот', 'error'); return; }
    try {
      const data = await compressImage(f, 2000, 0.82);
      if (replace && plan) {
        setBusy(true);
        const r = await api.savePlan(plan.id, { image: data });
        setD((x) => (x ? { ...x, plans: x.plans.map((p) => (p.id === plan.id ? r.plan : p)) } : x));
        toast('Чертёж заменён'); setBusy(false);
      } else await addPlan({ image: data });
    } catch (e) { setBusy(false); toast((e as Error).message, 'error'); }
  }
  async function removePlan() {
    if (!plan) return;
    if (!confirmDel) { setConfirmDel(true); haptic.tap(); return; }
    try { apply(await api.deletePlan(plan.id)); setConfirmDel(false); setMode('view'); toast('План удалён'); } catch (e) { toast((e as Error).message, 'error'); }
  }
  async function saveTitle() {
    if (!plan || rename == null) return;
    try {
      const r = await api.savePlan(plan.id, { title: rename });
      setD((x) => (x ? { ...x, plans: x.plans.map((p) => (p.id === plan.id ? r.plan : p)) } : x));
      setRename(null);
    } catch (e) { toast((e as Error).message, 'error'); }
  }

  const cardTrap = traps.find((t) => t.id === card);
  const selTrap = traps.find((t) => t.id === sel);
  const tools: { id: Tool; icon: JSX.Element; label: string }[] = [
    { id: 'move', icon: <Move size={18} />, label: 'Двигать' },
    { id: 'rect', icon: <Square size={18} />, label: 'Комната' },
    { id: 'line', icon: <Minus size={18} className="-rotate-45" />, label: 'Стена' },
    { id: 'door', icon: <DoorOpen size={18} />, label: 'Дверь' },
    { id: 'gate', icon: <Warehouse size={18} />, label: 'Ворота' },
    { id: 'spot', icon: <MapPin size={18} />, label: 'Станция' },
    { id: 'text', icon: <Type size={18} />, label: 'Текст' },
    { id: 'erase', icon: <Eraser size={18} />, label: 'Ластик' },
  ];

  const inputs = (
    <>
      <input ref={camRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { pickImage(e.target.files); e.target.value = ''; }} />
      <input ref={galRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickImage(e.target.files); e.target.value = ''; }} />
      <input ref={replaceRef} type="file" accept="image/*" className="hidden" onChange={(e) => { pickImage(e.target.files, true); e.target.value = ''; }} />
    </>
  );

  const newChoices = (
    <div className="space-y-2.5">
      <button disabled={busy} onClick={() => camRef.current?.click()} className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-inset ring-line active:opacity-70">
        <Camera size={24} strokeWidth={1.6} className="shrink-0 text-accent-ink" />
        <span><span className="block text-[16px] font-semibold">Сфотографировать чертёж</span><span className="text-[13px] text-muted">схема со стены, бумажный план</span></span>
      </button>
      <button disabled={busy} onClick={() => galRef.current?.click()} className="flex w-full items-center gap-3 rounded-2xl bg-card p-4 text-left ring-1 ring-inset ring-line active:opacity-70">
        <ImagePlus size={24} strokeWidth={1.6} className="shrink-0 text-accent-ink" />
        <span><span className="block text-[16px] font-semibold">Загрузить картинку</span><span className="text-[13px] text-muted">чертёж от клиента (PDF — скриншотом)</span></span>
      </button>
      <div className="rounded-2xl bg-card p-4 ring-1 ring-inset ring-line">
        <div className="flex items-center gap-3"><Pencil size={24} strokeWidth={1.6} className="shrink-0 text-accent-ink" />
          <span><span className="block text-[16px] font-semibold">Нарисовать самому</span><span className="text-[13px] text-muted">комнаты, стены, двери, подписи</span></span></div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <Button variant="secondary" className="h-[44px] text-[14px]" disabled={busy} onClick={() => addPlan({ orient: 'land' })}>Альбомный</Button>
          <Button variant="secondary" className="h-[44px] text-[14px]" disabled={busy} onClick={() => addPlan({ orient: 'port' })}>Книжный</Button>
        </div>
      </div>
      <div className="px-1 text-[12.5px] leading-snug text-muted">На чертеже тоже можно дорисовать комнаты и подписи.</div>
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-50 flex flex-col bg-page animate-fade">
      {inputs}
      {/* шапка */}
      <div className="flex items-center gap-2 px-3 pb-2" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <button onClick={() => { if (dirty) saveDrawing(); onClose(); }} aria-label="Закрыть" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card ring-1 ring-inset ring-line"><X size={18} /></button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[17px] font-semibold leading-tight">План объекта</div>
          <div className="truncate text-[12.5px] text-muted">{isDraftPlan ? 'Нарисован заранее · ещё не привязан к клиенту' : title || d?.object?.company_name || ''}</div>
        </div>
        {plan && (
          <>
            <button onClick={() => setZoom((z) => Math.max(1, z - 0.5))} aria-label="Меньше" className="flex h-10 w-10 items-center justify-center rounded-full bg-card ring-1 ring-inset ring-line"><ZoomOut size={18} /></button>
            <button onClick={() => setZoom((z) => Math.min(4, z + 0.5))} aria-label="Больше" className="flex h-10 w-10 items-center justify-center rounded-full bg-card ring-1 ring-inset ring-line"><ZoomIn size={18} /></button>
          </>
        )}
      </div>

      {!d ? <div className="flex-1"><Spinner /></div> : !d.plans.length ? (
        <div className="flex-1 overflow-y-auto px-4 pb-8">
          <div className="mb-4 mt-2 text-[15px] leading-relaxed text-muted">У объекта ещё нет плана. Добавьте чертёж или нарисуйте — и отметьте, где стоят станции{traps.length ? ` (${traps.length})` : ''}.</div>
          {newChoices}
        </div>
      ) : (
        <>
          {/* планы объекта */}
          <div className="flex gap-1.5 overflow-x-auto px-3 pb-2">
            {d.plans.map((p) => (
              <button key={p.id} onClick={() => { if (dirty) saveDrawing(); setPlanId(p.id); setCard(''); }}
                className={cx('shrink-0 rounded-full px-3.5 py-1.5 text-[13.5px] font-medium', p.id === planId ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                <Layers size={13} className="mr-1 inline -translate-y-px" />{p.title}
              </button>
            ))}
            <button onClick={() => setNewOpen(true)} className="shrink-0 rounded-full bg-card px-3 py-1.5 text-[13.5px] font-medium text-accent-ink ring-1 ring-inset ring-line"><Plus size={14} className="inline -translate-y-px" /> План</button>
          </div>
          {/* режимы */}
          <div className="mx-3 mb-2 flex rounded-xl bg-fill p-1">
            {([['view', 'Смотреть'], ['place', `Станции${unplaced.length ? ` · ${unplaced.length}` : ''}`], ['draw', 'Рисовать']] as [Mode, string][]).map(([m, l]) => (
              <button key={m} onClick={() => { haptic.tap(); if (mode === 'draw' && dirty) saveDrawing(); setMode(m); setCard(''); if (m === 'place' && !sel) setSel(unplaced[0]?.id || ''); }}
                className={cx('flex-1 rounded-lg py-2 text-[13.5px] font-semibold', mode === m ? 'bg-card shadow-sm' : 'text-muted')}>{l}</button>
            ))}
          </div>

          {/* холст */}
          {plan && (
            <div className="mx-3 mb-1.5 flex items-center justify-end gap-1.5 text-[12.5px] text-muted">
              <span className="mr-auto">Размер значков</span>
              <button onClick={() => changeMs(-0.1)} aria-label="Меньше значки" className="flex h-8 w-8 items-center justify-center rounded-full bg-card ring-1 ring-inset ring-line"><Minus size={15} /></button>
              <span className="w-10 text-center font-mono text-ink">{Math.round(ms * 100)}%</span>
              <button onClick={() => changeMs(0.1)} aria-label="Больше значки" className="flex h-8 w-8 items-center justify-center rounded-full bg-card ring-1 ring-inset ring-line"><Plus size={15} /></button>
            </div>
          )}
          <div ref={canvasRef} className="relative min-h-0 flex-1 overflow-auto px-3" style={{ touchAction: mode === 'draw' ? 'none' : 'auto' }}>
            {plan && (
              <div style={{ width: baseW ? `${Math.round(baseW * zoom)}px` : `${zoom * 100}%` }} className="mx-auto overflow-hidden rounded-2xl bg-white ring-1 ring-line">
                <svg ref={svgRef} viewBox={`0 0 1000 ${plan.h}`} className="block w-full select-none" style={{ touchAction: mode === 'draw' ? 'none' : 'manipulation' }}
                  onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                  onClick={(e) => {
                    if (mode === 'place' && sel) { const p = pt(e); place(sel, Math.round(p.x), Math.round(p.y)); }
                  }}>
                  <rect width={1000} height={plan.h} fill="#FBFBFD" />
                  {plan.image_url && <image href={plan.image_url} width={1000} height={plan.h} preserveAspectRatio="xMidYMid meet" opacity={mode === 'draw' ? 0.7 : 1} />}
                  {!plan.image_url && (
                    <g stroke="#E5E5EA" strokeWidth={1}>
                      {Array.from({ length: 21 }, (_, i) => <line key={`v${i}`} x1={i * 50} y1={0} x2={i * 50} y2={plan.h} />)}
                      {Array.from({ length: Math.ceil(plan.h / 50) + 1 }, (_, i) => <line key={`h${i}`} x1={0} y1={i * 50} x2={1000} y2={i * 50} />)}
                    </g>
                  )}
                  <Drawing shapes={mode === 'draw' ? shapes : plan.drawing} h={plan.h} ms={ms}
                    onErase={mode === 'draw' && tool === 'erase' ? (i) => { haptic.tap(); commit(shapes.filter((_, j) => j !== i)); } : undefined}
                    onDown={mode === 'draw' && tool === 'move' ? startDrag : undefined} />
                  {draft && <Drawing shapes={[draft]} h={plan.h} ms={ms} />}
                  {onPlan.map((t) => (
                    <Marker key={t.id} ms={ms} t={t} x={t.plan_x!} y={t.plan_y!} fill={fillOf(t)} ring={t.id === card || t.id === sel || t.id === focusId} dim={mode === 'draw'}
                      onClick={mode === 'draw' ? undefined : () => {
                        if (mode === 'place') { setSel(t.id); haptic.tap(); return; }
                        setCard(t.id); haptic.tap();
                      }} />
                  ))}
                </svg>
              </div>
            )}
          </div>

          {/* нижняя панель */}
          <div className="border-t border-line bg-page px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2.5">
            {isDraftPlan && mode !== 'draw' && (
              <Button className="mb-2.5" onClick={() => { if (dirty) saveDrawing(); setAttachOpen(true); }} icon={<Check size={19} />}>Готово — указать клиента и адрес</Button>
            )}
            {mode === 'view' && (cardTrap ? (
              <div className="rounded-2xl bg-card p-3.5">
                <div className="flex items-start gap-3">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-fill font-mono text-[17px] font-bold">{cardTrap.number}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[16px] font-semibold">{cardTrap.location || cardTrap.kind}</div>
                    <div className="truncate text-[13px] text-muted">{[targetLabel(cardTrap.target), cardTrap.kind, cardTrap.code].filter(Boolean).join(' · ')}</div>
                    {visitTraps && <div className="mt-0.5 text-[13px]">{inspOf(cardTrap.id)?.inspection ? cfg.statuses.find((s) => s.id === inspOf(cardTrap.id)!.inspection!.status)?.label : cardTrap.prepared ? 'подготовлена, не установлена' : 'ещё не проверена'}</div>}
                  </div>
                  <button onClick={() => setCard('')} className="p-1 text-muted"><X size={18} /></button>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {onOpenTrap && <Button className="h-[44px] text-[14px]" onClick={() => onOpenTrap(cardTrap.id)}>Открыть</Button>}
                  <Button variant="secondary" className={cx('h-[44px] text-[14px]', !onOpenTrap && 'col-span-2')} onClick={() => { setMode('place'); setSel(cardTrap.id); setCard(''); }} icon={<Move size={16} />}>Передвинуть</Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-[12.5px] text-muted">
                {visitTraps ? (
                  <>
                    <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#34C759]" />чисто</span>
                    <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#FF3B30]" />активность</span>
                    <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#E5E5EA] ring-1 ring-line" />не проверена</span>
                    <span><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-[#1D1D1F]" />повреждена</span>
                  </>
                ) : <span>Тап по станции — подробности</span>}
                <span className="ml-auto">● грызуны ◆ ползающие ▲ летающие</span>
                <span className="flex w-full flex-wrap gap-x-3.5 gap-y-1 pt-0.5">
                  {LEGEND_DEVICES.map((k) => { const st = deviceStyle(k); return <span key={k}><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full" style={{ background: st.color }} />{st.name}</span>; })}
                </span>
                {spots.length > 0 && <span className="w-full"><i className="mr-1 inline-block h-2.5 w-2.5 rounded-full border-2 border-dashed border-[#0066CC]" />запланировано, ещё без QR: {spots.length}</span>}
                {unplaced.length > 0 && <button onClick={() => { setMode('place'); setSel(unplaced[0].id); }} className="w-full pt-1 text-left font-medium text-accent-ink"><MapPin size={13} className="inline -translate-y-px" /> Не на плане: {unplaced.length} — отметить</button>}
              </div>
            ))}

            {mode === 'place' && (
              <div>
                <div className="mb-2 px-1 text-[13.5px] leading-snug">
                  {selTrap ? <>Тапните на плане, где стоит <b>№ {selTrap.number || '—'}</b> ({targetLabel(selTrap.target).toLowerCase() || selTrap.kind}){selTrap.plan_id ? ' — передвинется' : ''}{spots.length ? '. Тап по пунктирной точке — станция встанет в неё и возьмёт её номер' : ''}</> : traps.length ? 'Выберите станцию ниже или тапните точку на плане, чтобы передвинуть' : 'На объекте пока нет станций — отсканируйте QR в выезде или подготовьте ловушки.'}
                </div>
                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {[...unplaced, ...otherPlan, ...onPlan].map((t) => (
                    <button key={t.id} onClick={() => { haptic.tap(); setSel(t.id); }}
                      className={cx('shrink-0 rounded-xl px-3 py-2 text-[13.5px] font-semibold', t.id === sel ? 'bg-accent text-white' : t.plan_id ? 'bg-card text-muted ring-1 ring-inset ring-line' : 'bg-card ring-2 ring-inset ring-[#FF9500]')}>
                      {t.target === 'crawling' ? '◆' : t.target === 'flying' ? '▲' : '●'} № {t.number || '—'}{!t.plan_id ? '' : t.plan_id === planId ? ' ✓' : ' · др.'}
                    </button>
                  ))}
                </div>
                {selTrap?.plan_id && <button onClick={() => unplace(selTrap.id)} className="mt-1 px-1 text-[13px] text-[#D70015]">Убрать № {selTrap.number} с плана</button>}
              </div>
            )}

            {mode === 'draw' && (
              ask ? (
                <form onSubmit={(e) => { e.preventDefault(); answer(); }} className="flex gap-2">
                  <Input autoFocus placeholder={ask.kind === 'rect' ? 'Название помещения (кухня, склад…)' : 'Подпись'} value={askText} onChange={(e) => setAskText(e.target.value)} />
                  <button type="submit" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white"><Check size={20} /></button>
                  <button type="button" onClick={() => setAsk(null)} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-card ring-1 ring-inset ring-line"><X size={18} /></button>
                </form>
              ) : (
                <>
                  <div className="-mx-3 flex gap-1.5 overflow-x-auto px-3">
                    {tools.map((t) => (
                      <button key={t.id} onClick={() => { haptic.tap(); setTool(t.id); }}
                        className={cx('flex min-w-[58px] flex-1 shrink-0 flex-col items-center gap-0.5 rounded-xl py-2 text-[11px] font-medium', tool === t.id ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                        {t.icon}{t.label}
                      </button>
                    ))}
                    <button onClick={() => { if (hist.length) { setShapes(hist[hist.length - 1]); setHist((h) => h.slice(0, -1)); setDirty(true); haptic.tap(); } }} disabled={!hist.length}
                      className="flex flex-col items-center gap-0.5 rounded-xl bg-card px-2.5 py-2 text-[11px] font-medium ring-1 ring-inset ring-line disabled:opacity-40"><Undo2 size={18} />Назад</button>
                  </div>
                  {tool === 'spot' && (
                    <div className="mt-2 flex gap-1.5 overflow-x-auto">
                      {SPOT_TYPES.map((x) => (
                        <button key={x.id} onClick={() => { haptic.tap(); setSpotType(x.id); }}
                          className={cx('shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium', spotType === x.id ? 'bg-ink text-card' : 'bg-card ring-1 ring-inset ring-line')}>
                          <i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full" style={{ background: deviceStyle(x.kind).color }} />{x.label.slice(2)}</button>
                      ))}
                    </div>
                  )}
                  <div className="mt-1.5 px-1 text-[12px] text-muted">
                    {tool === 'move' ? 'Потяните комнату, стену, дверь, подпись или точку станции — она переедет' : tool === 'spot' ? 'Тапайте, где будут станции — номера идут по порядку. На объекте отсканируете QR и тапнете точку' : tool === 'gate' ? 'Проведите по ширине ворот' : tool === 'rect' ? 'Проведите пальцем по диагонали — получится комната' : tool === 'line' ? 'Проведите пальцем — стена (ровняется сама)' : tool === 'door' ? 'Проведите по ширине проёма' : tool === 'text' ? 'Тапните, где поставить подпись' : 'Тапните по фигуре, чтобы удалить'}
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto_auto] gap-2">
                    <Button className="h-[44px] text-[14px]" loading={busy} disabled={!dirty} onClick={() => saveDrawing('place')}>Сохранить → станции</Button>
                    <button onClick={() => setRename(plan?.title || '')} className="rounded-2xl bg-card px-3 text-[13px] ring-1 ring-inset ring-line">Имя</button>
                    <button onClick={removePlan} className={cx('rounded-2xl px-3 text-[13px] ring-1 ring-inset', confirmDel ? 'bg-[#FF3B30] text-white ring-[#FF3B30]' : 'bg-card text-[#D70015] ring-line')}>{confirmDel ? 'Удалить?' : <Trash2 size={16} />}</button>
                  </div>
                  {plan?.image_url && <button onClick={() => replaceRef.current?.click()} className="mt-1.5 px-1 text-[12.5px] text-accent-ink">Заменить чертёж</button>}
                  {rename != null && (
                    <form onSubmit={(e) => { e.preventDefault(); saveTitle(); }} className="mt-2 flex gap-2">
                      <Input autoFocus value={rename} onChange={(e) => setRename(e.target.value)} placeholder="Этаж 1, склад, территория…" />
                      <button type="submit" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent text-white"><Check size={20} /></button>
                    </form>
                  )}
                </>
              )
            )}
          </div>
        </>
      )}

      {attachOpen && (
        <AttachForm draft={objectId} onCancel={() => setAttachOpen(false)}
          onDone={(o) => { setAttachOpen(false); toast(`План привязан: ${o.company_name} · ${o.address}`); onClose(); }} />
      )}
      {newOpen && (
        <div className="fixed inset-0 z-[55] flex items-end bg-black/40" onClick={() => setNewOpen(false)}>
          <div className="w-full rounded-t-[26px] bg-page px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between"><div className="text-[18px] font-semibold">Новый план</div><button onClick={() => setNewOpen(false)} className="p-1 text-muted"><X size={18} /></button></div>
            {newChoices}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
