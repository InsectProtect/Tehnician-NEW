import { useCallback, useEffect, useRef, useState } from 'react';
import { Check, Clapperboard, ImagePlus, ThumbsDown, ThumbsUp, Video } from 'lucide-react';
import { api, uploadMediaAny } from '../api';
import { fmtDate, useConfig } from '../config';
import { compressImage } from '../image';
import { haptic, openLink } from '../telegram';
import { openPhotos } from './PhotoViewer';
import type { MediaPost, MediaSettings, MyMedia } from '../types';
import { Button, Field, Input, Pill, Sheet, Spinner, cx, useToast } from './ui';

const n = (x: number | null | undefined) => String(Math.round((x ?? 0) * 100) / 100).replace('.', ',');

/** Специалист: карточка «Видео и фото с объектов» — сколько баллов за месяц и кнопка «Добавить». */
export function MediaCard({ visitId, compact }: { visitId?: string; compact?: boolean }) {
  const [d, setD] = useState<{ settings: MediaSettings; month_points: number; items: MyMedia[] } | null>(null);
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api.myMedia().then(setD).catch(() => {}); }, []);
  useEffect(() => { load(); }, [load]);
  const s = d?.settings;
  if (compact) {
    return (
      <>
        <Button variant="secondary" icon={<Video size={18} strokeWidth={1.75} />} onClick={() => { haptic.tap(); setOpen(true); }}>
          Добавить видео / фото{s ? ` · +${n(s.per_item)} б` : ''}
        </Button>
        {open && <UploadSheet visitId={visitId} settings={s} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
      </>
    );
  }
  return (
    <div className="mb-6 rounded-[22px] bg-card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent-ink"><Clapperboard size={20} strokeWidth={1.75} /></div>
        <div className="min-w-0 flex-1">
          <div className="text-[16px] font-semibold">Видео и фото с объектов</div>
          <div className="text-[13px] leading-snug text-muted">
            {s ? `Хорошее видео или фото — +${n(s.per_item)} балла, до ${n(s.month_cap)} в месяц.` : 'Снимайте работу на объекте — лучшие оценит офис.'}
          </div>
        </div>
        {d && s && <div className="text-right"><div className="font-dot text-[20px] font-semibold text-accent-ink">{n(d.month_points)}</div><div className="text-[11px] text-muted">из {n(s.month_cap)}</div></div>}
      </div>
      <Button className="mt-3" icon={<Video size={18} strokeWidth={1.75} />} onClick={() => { haptic.tap(); setOpen(true); }}>Добавить видео / фото</Button>
      {d && d.items.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {d.items.slice(0, 6).map((m) => (
            <Pill key={m.id} tone={m.status === 'approved' ? 'green' : m.status === 'rejected' ? 'gray' : 'orange'}>
              {m.kind === 'video' ? '🎬' : '📷'} {m.status === 'approved' ? `+${n(m.points)}` : m.status === 'rejected' ? 'без баллов' : 'на проверке'}
            </Pill>
          ))}
        </div>
      )}
      {open && <UploadSheet visitId={visitId} settings={s} onClose={() => setOpen(false)} onDone={() => { setOpen(false); load(); }} />}
    </div>
  );
}

type Item = { key: string; file: File; preview: string; status: 'wait' | 'up' | 'done' | 'err'; progress: number; err?: string };
const sizeRu = (b: number) => (b >= 1073741824 ? `${String(Math.round((b / 1073741824) * 10) / 10).replace('.', ',')} ГБ` : `${Math.max(1, Math.round(b / 1048576))} МБ`);

/** Можно выбрать сразу несколько видео/фото: каждый файл уходит в офис отдельно и оценивается отдельно. */
function UploadSheet({ visitId, settings, onClose, onDone }: { visitId?: string; settings?: MediaSettings; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const cfg = useConfig();
  const maxMb = cfg.uploadMaxMb || 50;
  const input = useRef<HTMLInputElement | undefined>(undefined);
  const [items, setItems] = useState<Item[]>([]);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  useEffect(() => () => { itemsRef.current.forEach((x) => URL.revokeObjectURL(x.preview)); }, []);
  const patch = (key: string, p: Partial<Item>) => setItems((xs) => xs.map((x) => (x.key === key ? { ...x, ...p } : x)));

  function pick(list: FileList | null) {
    if (!list?.length) return;
    const add: Item[] = [];
    for (const f of Array.from(list)) {
      if (!/^(video|image)\//.test(f.type)) { toast(`${f.name}: можно только видео или фото`, 'error'); continue; }
      if (f.size > maxMb * 1024 * 1024) { toast(`${f.name}: больше ${sizeRu(maxMb * 1024 * 1024)}`, 'error'); continue; }
      add.push({ key: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, file: f, preview: URL.createObjectURL(f), status: 'wait', progress: 0 });
    }
    setItems((xs) => [...xs, ...add].slice(0, 20));
  }

  async function send() {
    setBusy(true);
    let ok = 0; let bad = 0;
    for (const it of itemsRef.current.filter((x) => x.status === 'wait' || x.status === 'err')) {
      patch(it.key, { status: 'up', progress: 0, err: undefined });
      try {
        let blob: Blob = it.file;
        let name = it.file.name || 'file';
        if (it.file.type.startsWith('image/')) {
          const dataUrl = await compressImage(it.file);
          blob = await (await fetch(dataUrl)).blob();
          name = name.replace(/\.[^.]+$/, '') + '.jpg';
        }
        await uploadMediaAny(blob, name, { visitId, caption: caption.trim() }, (p) => patch(it.key, { progress: p }));
        patch(it.key, { status: 'done', progress: 1 });
        ok += 1;
      } catch (e) {
        patch(it.key, { status: 'err', err: (e as Error).message });
        bad += 1;
      }
    }
    setBusy(false);
    if (ok) haptic.success(); else haptic.error();
    if (!bad) { toast(ok > 1 ? `Отправлено ${ok} файлов — офис оценит каждый отдельно` : 'Отправлено в офис на оценку'); onDone(); }
    else toast(`Не загрузилось: ${bad}. Нажмите «Повторить».`, 'error');
  }

  const waiting = items.filter((x) => x.status === 'wait' || x.status === 'err').length;
  const total = items.reduce((s, x) => s + x.file.size, 0);
  return (
    <Sheet open onClose={busy ? () => {} : onClose} title="Видео / фото с объекта">
      <p className="-mt-3 mb-4 text-[14px] leading-snug text-muted">
        Снимите до/после, места обработки, крупные планы. Можно выбрать сразу несколько — каждый файл офис оценит отдельно:
        хорошее — {settings ? `+${n(settings.per_item)} балла (до ${n(settings.month_cap)} в месяц)` : 'баллы в KPI'}. До {sizeRu(maxMb * 1024 * 1024)} на файл.
      </p>
      <input ref={(el) => { input.current = el ?? undefined; }} type="file" accept="video/*,image/*" multiple className="hidden" onChange={(e) => { pick(e.target.files); e.target.value = ''; }} />
      {items.length === 0 ? (
        <button onClick={() => input.current?.click()} className="flex h-40 w-full flex-col items-center justify-center gap-2 rounded-2xl bg-card text-[15px] font-medium ring-1 ring-inset ring-line active:opacity-70">
          <ImagePlus size={30} strokeWidth={1.5} className="text-accent-ink" />
          Снять или выбрать видео / фото
        </button>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {items.map((it) => (
              <div key={it.key} className="relative aspect-square overflow-hidden rounded-xl bg-black">
                {it.file.type.startsWith('video/')
                  ? <video src={it.preview} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                  : <img src={it.preview} alt="" className="h-full w-full object-cover" />}
                <span className="absolute left-1.5 top-1.5 rounded-full bg-black/60 px-1.5 py-0.5 text-[10.5px] text-white">{sizeRu(it.file.size)}</span>
                {it.status === 'wait' && !busy && (
                  <button aria-label="Убрать" onClick={() => { URL.revokeObjectURL(it.preview); setItems((xs) => xs.filter((x) => x.key !== it.key)); }}
                    className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full bg-black/60 text-[15px] text-white">×</button>
                )}
                {it.status === 'up' && (
                  <div className="absolute inset-x-0 bottom-0 bg-black/60 p-1.5">
                    <div className="h-1.5 overflow-hidden rounded-full bg-white/25"><div className="h-full rounded-full bg-accent" style={{ width: `${Math.round(it.progress * 100)}%` }} /></div>
                    <div className="mt-0.5 text-center text-[10.5px] text-white">{Math.round(it.progress * 100)}%</div>
                  </div>
                )}
                {it.status === 'done' && <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-white"><Check size={28} strokeWidth={2.5} /></div>}
                {it.status === 'err' && <div className="absolute inset-x-0 bottom-0 bg-[#D70015]/85 px-1.5 py-1 text-center text-[10.5px] leading-tight text-white">{it.err || 'Ошибка'}</div>}
              </div>
            ))}
            {!busy && items.length < 20 && (
              <button onClick={() => input.current?.click()} className="flex aspect-square flex-col items-center justify-center gap-1 rounded-xl bg-card text-[12.5px] text-muted ring-1 ring-inset ring-line">
                <ImagePlus size={22} strokeWidth={1.5} className="text-accent-ink" />Ещё
              </button>
            )}
          </div>
          <div className="mt-2 px-1 text-[12.5px] text-muted">{items.length} {items.length === 1 ? 'файл' : items.length < 5 ? 'файла' : 'файлов'} · {sizeRu(total)} · загружаются по одному</div>
        </>
      )}
      <div className="mt-4"><Field label="Подпись (необязательно, ко всем файлам)"><Input placeholder="Например: обработка кухни, до/после" value={caption} onChange={(e) => setCaption(e.target.value)} /></Field></div>
      <Button className="mt-4" disabled={!waiting || busy} loading={busy} onClick={send} icon={<Check size={18} strokeWidth={2} />}>
        {items.some((x) => x.status === 'err') ? `Повторить · ${waiting}` : waiting > 1 ? `Отправить в офис · ${waiting} шт.` : 'Отправить в офис'}
      </Button>
      {busy && <p className="mt-2 text-center text-[12.5px] text-muted">Не закрывайте приложение, пока идёт загрузка.</p>}
    </Sheet>
  );
}

/** Администратор: оценка видео/фото — начислить баллы (можно изменить количество) или без баллов; настройки. */
export function MediaReviewWidget({ onAll }: { onAll?: () => void }) {
  const toast = useToast();
  const [d, setD] = useState<{ settings: MediaSettings; items: MediaPost[] } | null>(null);
  const [pts, setPts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [cfgOpen, setCfgOpen] = useState(false);
  const [showOld, setShowOld] = useState(false);
  const load = useCallback(() => { api.adminMedia().then(setD).catch((e: Error) => toast(e.message, 'error')); }, [toast]);
  useEffect(() => { load(); }, [load]);
  const pending = d?.items.filter((m) => m.status === 'proposed') ?? [];
  const old = d?.items.filter((m) => m.status !== 'proposed') ?? [];
  const decide = async (m: MediaPost, approve: boolean) => {
    setBusy(m.id);
    try {
      const v = pts[m.id];
      const r = await api.decideMedia(m.id, approve, approve && v !== undefined && v !== '' ? Number(v.replace(',', '.')) : undefined);
      haptic.success();
      toast(approve ? `Начислено +${n(r.points)}${r.note}` : 'Без баллов');
      load();
    } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  return (
    <div className="rounded-[22px] bg-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <div>
          <div className="text-[16px] font-semibold">Видео и фото от специалистов</div>
          {d && <div className="text-[12.5px] text-muted">хорошее — +{n(d.settings.per_item)} б, до {n(d.settings.month_cap)} в месяц на человека · оценить можно и кнопкой в Telegram</div>}
        </div>
        <button onClick={() => setCfgOpen(true)} className="shrink-0 text-[13px] text-accent-ink">Баллы →</button>
      </div>
      {!d ? <Spinner /> : pending.length === 0 ? <div className="text-[14px] text-muted">Новых нет</div> : (
        <div className="grid gap-3 md:grid-cols-2">
          {pending.map((m) => (
            <div key={m.id} className="overflow-hidden rounded-2xl bg-fill/60">
              <div className="bg-black">
                {m.kind === 'video'
                  ? (!m.stored && m.size > 20 * 1024 * 1024 ? <div className="p-6 text-center text-[13px] text-white/70">Видео больше 20 МБ — смотрите в чате Telegram</div> : <video src={m.url} controls playsInline preload="metadata" className="max-h-64 w-full" />)
                  : <img src={m.url} alt="" onClick={() => openPhotos(pending.filter((x) => x.kind !== 'video').map((x) => x.url), pending.filter((x) => x.kind !== 'video').indexOf(m))} className="max-h-64 w-full object-contain" />}
              </div>
              <div className="p-3">
                <div className="font-semibold">{m.name} <span className="font-normal text-muted">· {fmtDate(m.created_at)}</span></div>
                {(m.object || m.caption) && <div className="text-[12.5px] text-muted">{[m.object, m.caption].filter(Boolean).join(' · ')}</div>}
                <div className="mt-2 grid grid-cols-[88px_1fr_1fr] gap-2">
                  <Input inputMode="decimal" className="text-center font-dot" value={pts[m.id] ?? n(d.settings.per_item)} onChange={(e) => setPts({ ...pts, [m.id]: e.target.value })} />
                  <Button variant="secondary" className="h-[44px] text-[14px]" disabled={!!busy} icon={<ThumbsDown size={16} strokeWidth={1.75} />} onClick={() => decide(m, false)}>Нет</Button>
                  <Button className="h-[44px] text-[14px]" loading={busy === m.id} icon={<ThumbsUp size={16} strokeWidth={1.75} />} onClick={() => decide(m, true)}>Начислить</Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {onAll && <button onClick={onAll} className="mt-3 block px-1 text-[13px] font-medium text-accent-ink">Все фото и видео — скачать, фильтры →</button>}
      {old.length > 0 && <button onClick={() => setShowOld(!showOld)} className="mt-3 px-1 text-[13px] text-accent-ink">{showOld ? 'Скрыть историю' : `История · ${old.length}`}</button>}
      {showOld && (
        <div className="mt-2 space-y-1.5">
          {old.map((m) => (
            <div key={m.id} className="flex items-center justify-between gap-2 rounded-xl bg-fill/40 px-3 py-2 text-[13px]">
              <span className="truncate">{m.kind === 'video' ? '🎬' : '📷'} {m.name} · {fmtDate(m.created_at)}</span>
              <span className={cx('shrink-0 font-dot', m.status === 'approved' ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-muted')}>{m.status === 'approved' ? `+${n(m.points)}` : 'без баллов'}</span>
            </div>
          ))}
        </div>
      )}
      {cfgOpen && d && <MediaSettingsSheet initial={d.settings} onClose={() => setCfgOpen(false)} onSaved={() => { setCfgOpen(false); load(); }} />}
    </div>
  );
}

function MediaSettingsSheet({ initial, onClose, onSaved }: { initial: MediaSettings; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [per, setPer] = useState(n(initial.per_item));
  const [cap, setCap] = useState(n(initial.month_cap));
  const [busy, setBusy] = useState(false);
  return (
    <Sheet open onClose={onClose} title="Баллы за видео и фото">
      <div className="grid grid-cols-2 gap-2.5">
        <Field label="За одно хорошее"><Input inputMode="decimal" value={per} onChange={(e) => setPer(e.target.value)} /></Field>
        <Field label="Максимум в месяц"><Input inputMode="decimal" value={cap} onChange={(e) => setCap(e.target.value)} /></Field>
      </div>
      <p className="mt-2 px-1 text-[12.5px] text-muted">При оценке количество можно изменить для конкретного видео. Сверх лимита месяца баллы не начисляются.</p>
      <Button className="mt-4" loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.saveMediaSettings({ per_item: Number(per.replace(',', '.')), month_cap: Number(cap.replace(',', '.')) }); haptic.success(); toast('Сохранено'); onSaved(); }
        catch (e) { toast((e as Error).message, 'error'); setBusy(false); }
      }}>Сохранить</Button>
    </Sheet>
  );
}

/** Админ-панель → «Фото / видео»: галерея со статистикой, фильтрами, просмотром, скачиванием и оценкой. */
export function MediaGallery() {
  const toast = useToast();
  const [status, setStatus] = useState('proposed');
  const [tech, setTech] = useState('');
  const [kind, setKind] = useState('');
  const [month, setMonth] = useState('');
  const [d, setD] = useState<Awaited<ReturnType<typeof api.adminMedia>> | null>(null);
  const [pts, setPts] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [view, setView] = useState<MediaPost | null>(null);
  const [cfgOpen, setCfgOpen] = useState(false);
  const cur = new Date().toISOString().slice(0, 7);
  const prev = new Date(Date.UTC(Number(cur.slice(0, 4)), Number(cur.slice(5, 7)) - 2, 15)).toISOString().slice(0, 7);

  const load = useCallback(() => {
    api.adminMedia({ status: status === 'all' ? '' : status, tech, kind, month }).then(setD).catch((e: Error) => toast(e.message, 'error'));
  }, [status, tech, kind, month, toast]);
  useEffect(() => { setD(null); load(); }, [load]);

  const run = async (key: string, fn: () => Promise<unknown>, ok?: string) => {
    setBusy(key);
    try { await fn(); haptic.success(); if (ok) toast(ok); load(); } catch (e) { toast((e as Error).message, 'error'); } finally { setBusy(''); }
  };
  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button key={label} onClick={() => { haptic.tap(); onClick(); }}
      className={cx('h-8 shrink-0 rounded-full px-3.5 text-[13px] font-medium', on ? 'bg-accent text-black' : 'bg-fill')}>{label}</button>
  );

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-2.5 md:grid-cols-5">
        {[
          ['Всего', d?.stats.total], ['На оценке', d?.stats.proposed], ['Хорошие', d?.stats.approved], ['Без баллов', d?.stats.rejected], ['Начислено баллов', d ? n(d.stats.points) : undefined],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-2xl bg-card p-3.5">
            <div className="font-dot text-[26px] font-semibold leading-none">{v ?? '—'}</div>
            <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">{l}</div>
          </div>
        ))}
      </div>

      <div className="mb-2 flex flex-wrap gap-1.5">
        {chip(status === 'proposed', `На оценке${d?.stats.proposed ? ` · ${d.stats.proposed}` : ''}`, () => setStatus('proposed'))}
        {chip(status === 'approved', 'Хорошие', () => setStatus('approved'))}
        {chip(status === 'rejected', 'Без баллов', () => setStatus('rejected'))}
        {chip(status === 'all', 'Все', () => setStatus('all'))}
        <span className="mx-1 w-px self-stretch bg-line" />
        {chip(kind === '', 'Видео и фото', () => setKind(''))}
        {chip(kind === 'video', '🎬 Видео', () => setKind('video'))}
        {chip(kind === 'photo', '📷 Фото', () => setKind('photo'))}
      </div>
      <div className="mb-4 flex flex-wrap gap-1.5">
        {chip(month === '', 'Всё время', () => setMonth(''))}
        {chip(month === cur, 'Этот месяц', () => setMonth(cur))}
        {chip(month === prev, 'Прошлый', () => setMonth(prev))}
        {d && d.techs.length > 0 && <span className="mx-1 w-px self-stretch bg-line" />}
        {d && d.techs.length > 0 && chip(tech === '', 'Все сотрудники', () => setTech(''))}
        {d?.techs.map((t) => chip(tech === t.id, t.name, () => setTech(t.id)))}
        <button onClick={() => setCfgOpen(true)} className="ml-auto h-8 px-2 text-[13px] text-accent-ink">Баллы за видео →</button>
      </div>

      {!d ? <Spinner /> : d.items.length === 0 ? (
        <div className="rounded-2xl bg-card p-5 text-[15px] text-muted">{status === 'proposed' ? 'Всё оценено — новых файлов нет' : 'Ничего не найдено'}</div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {d.items.map((m) => (
            <div key={m.id} className="flex flex-col overflow-hidden rounded-[22px] bg-card">
              <button onClick={() => setView(m)} className="relative block bg-black">
                {m.kind === 'video'
                  ? (!m.stored && m.size > 20 * 1024 * 1024
                    ? <div className="flex h-48 items-center justify-center p-4 text-center text-[13px] text-white/70">🎬 Видео {Math.round(m.size / 1048576)} МБ — «В Telegram», чтобы посмотреть</div>
                    : <video src={m.url} preload="metadata" muted playsInline className="h-48 w-full object-cover" />)
                  : <img src={m.url} alt="" loading="lazy" className="h-48 w-full object-cover" />}
                <span className="absolute left-2 top-2 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white">{m.kind === 'video' ? '🎬 видео' : '📷 фото'} · {Math.max(1, Math.round(m.size / 1048576))} МБ</span>
              </button>
              <div className="flex flex-1 flex-col p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate font-semibold">{m.name}</span>
                  <span className="shrink-0 text-[12px] text-muted">{fmtDate(m.created_at)}</span>
                </div>
                {(m.object || m.caption) && <div className="mt-0.5 line-clamp-2 text-[12.5px] text-muted">{[m.object, m.caption].filter(Boolean).join(' · ')}</div>}
                <div className="mt-2 flex gap-2">
                  <button onClick={() => openLink(m.download_url || m.url)} className="h-9 flex-1 rounded-full bg-fill text-[13px] font-medium">⬇ Скачать</button>
                  <button disabled={!!busy} onClick={() => run(`tg${m.id}`, () => api.mediaSendMe(m.id), 'Файл в вашем чате с ботом')} className="h-9 flex-1 rounded-full bg-fill text-[13px] font-medium">✈ В Telegram</button>
                </div>
                <div className="mt-auto pt-3">
                  {m.status === 'proposed' ? (
                    <div className="grid grid-cols-[76px_1fr_1fr] gap-2">
                      <Input inputMode="decimal" className="h-[44px] text-center font-dot" value={pts[m.id] ?? n(d.settings.per_item)} onChange={(e) => setPts({ ...pts, [m.id]: e.target.value })} />
                      <Button variant="secondary" className="h-[44px] text-[14px]" disabled={!!busy} onClick={() => run(m.id, () => api.decideMedia(m.id, false), 'Без баллов')}>👎 Нет</Button>
                      <Button className="h-[44px] text-[14px]" loading={busy === m.id} onClick={() => run(m.id, async () => {
                        const v = pts[m.id];
                        const r = await api.decideMedia(m.id, true, v !== undefined && v !== '' ? Number(v.replace(',', '.')) : undefined);
                        toast(`Начислено +${n(r.points)}${r.note}`);
                      })}>👍 Начислить</Button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between gap-2 rounded-xl bg-fill/60 px-3 py-2">
                      <span className={cx('font-dot text-[15px] font-semibold', m.status === 'approved' ? 'text-[#248A3D] dark:text-[#30D158]' : 'text-muted')}>
                        {m.status === 'approved' ? `👍 +${n(m.points)} б` : '👎 без баллов'}
                      </span>
                      <span className="truncate text-[12px] text-muted">{m.decided_by}</span>
                      <button disabled={!!busy} onClick={() => run(`r${m.id}`, () => api.mediaReset(m.id), 'Вернули на оценку')} className="shrink-0 text-[12.5px] text-accent-ink">Переоценить</button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {view && (
        <Sheet open onClose={() => setView(null)} title={view.name}>
          <div className="overflow-hidden rounded-2xl bg-black">
            {view.kind === 'video' ? <video src={view.url} controls autoPlay playsInline className="max-h-[65dvh] w-full" /> : <img src={view.url} alt="" onClick={() => openPhotos(d!.items.filter((x) => x.kind !== 'video').map((x) => x.url), d!.items.filter((x) => x.kind !== 'video').indexOf(view))} className="max-h-[65dvh] w-full object-contain" />}
          </div>
          <div className="mt-2 text-[13px] text-muted">{[fmtDate(view.created_at), view.object, view.caption].filter(Boolean).join(' · ')}</div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Button variant="secondary" onClick={() => openLink(view.download_url || view.url)}>⬇ Скачать</Button>
            <Button variant="secondary" onClick={() => run(`tg${view.id}`, () => api.mediaSendMe(view.id), 'Файл в вашем чате с ботом')}>✈ В Telegram</Button>
          </div>
        </Sheet>
      )}
      {cfgOpen && d && <MediaSettingsSheet initial={d.settings} onClose={() => setCfgOpen(false)} onSaved={() => { setCfgOpen(false); load(); }} />}
    </>
  );
}
