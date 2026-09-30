import { type ReactNode, useEffect, useState } from 'react';
import { Copy, FileDown, MessageCircle, QrCode, Send, Share2 } from 'lucide-react';
import { api } from '../api';
import { copyText, haptic, openLink, openTgChat, prettyPhone, shareLink } from '../telegram';
import { Group, IconBadge, Row, Sheet, useToast } from './ui';

type Info = { url: string; text: string; phone: string; file_name: string; bot: string; qr_svg: string };

/**
 * «Поделиться с клиентом»: PDF-файлом через системное меню (WhatsApp, Viber, почта…),
 * WhatsApp на номер клиента, Telegram, PDF себе в бот для пересылки или ссылкой.
 */
export function ShareSheet({ visitId, onClose }: { visitId: string; onClose: () => void }) {
  const toast = useToast();
  const [info, setInfo] = useState<Info | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState('');
  const [showQr, setShowQr] = useState(false);

  useEffect(() => {
    let alive = true;
    api.shareVisit(visitId, 'link').then(async (r) => {
      if (!alive) return;
      setInfo(r);
      // файл готовим заранее: iOS разрешает меню «Поделиться» только сразу после нажатия
      try {
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
        if (!nav.share || !nav.canShare) return;
        const blob = await (await fetch(r.url, { cache: 'no-store' })).blob();
        const f = new File([blob], r.file_name, { type: 'application/pdf' });
        if (alive && nav.canShare({ files: [f] })) setFile(f);
      } catch { /* нет поддержки — остаются другие способы */ }
    }).catch((e) => { toast((e as Error).message, 'error'); onClose(); });
    return () => { alive = false; };
  }, [visitId]); // eslint-disable-line react-hooks/exhaustive-deps

  const log = (via: 'qr' | 'file' | 'whatsapp' | 'telegram' | 'copy') => { api.shareVisit(visitId, via).catch(() => undefined); };
  const message = info ? `${info.text}\n${info.url}` : '';

  async function shareFile() {
    if (!file || !info) return;
    haptic.tap();
    try {
      await navigator.share({ files: [file], title: info.file_name, text: info.text });
      log('file');
      haptic.success();
    } catch (e) {
      if ((e as Error).name !== 'AbortError') toast('Не получилось открыть меню — отправьте PDF через бот', 'error');
    }
  }

  async function viaBot() {
    setBusy('bot');
    try {
      const r = await api.shareVisit(visitId, 'bot');
      haptic.success();
      toast('PDF в чате с ботом — перешлите его клиенту');
      if (r.bot) openTgChat(r.bot);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy('');
    }
  }

  const icon = (el: ReactNode, tone: 'green' | 'gray' | 'blue' | 'orange' = 'gray') => <IconBadge tone={tone}>{el}</IconBadge>;

  return (
    <Sheet open onClose={onClose} title="Поделиться с клиентом">
      <p className="-mt-3 mb-4 text-[14px] leading-snug text-muted">
        Клиент получит те документы, что вы выбрали при завершении. Ссылка действует 90 дней, вход не нужен.
      </p>
      {!info ? (
        <div className="py-10 text-center text-[15px] text-muted">Готовлю документ…</div>
      ) : showQr ? (
        <div className="pb-2">
          <div className="mx-auto w-full max-w-[300px] rounded-2xl bg-white p-3 ring-1 ring-inset ring-line">
            <img alt="QR-код для скачивания акта" className="block aspect-square w-full"
              src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(info.qr_svg)}`} />
          </div>
          <p className="mt-4 text-center text-[15px] leading-snug">
            Пусть клиент наведёт камеру телефона на код и откроет ссылку — PDF скачается.
          </p>
          <p className="mt-1 text-center text-[13px] text-muted">Работает 90 дней, приложение клиенту не нужно.</p>
          <button onClick={() => setShowQr(false)} className="mt-5 w-full text-center text-[15px] font-semibold text-accent-ink">
            Другие способы
          </button>
        </div>
      ) : (
        <Group>
          <Row left={icon(<QrCode size={18} strokeWidth={1.75} />, 'orange')} title="Показать QR-код"
            subtitle="Клиент сканирует камерой и скачивает PDF"
            onClick={() => { haptic.tap(); log('qr'); setShowQr(true); }} />
          {file && (
            <Row left={icon(<FileDown size={18} strokeWidth={1.75} />, 'orange')} title="Отправить PDF-файл"
              subtitle="WhatsApp, Viber, почта — через меню телефона" onClick={shareFile} />
          )}
          {info.phone && (
            <Row left={icon(<MessageCircle size={18} strokeWidth={1.75} />, 'green')} title="WhatsApp клиенту"
              subtitle={prettyPhone(info.phone)}
              onClick={() => { haptic.tap(); log('whatsapp'); openLink(`https://wa.me/${info.phone.replace(/\D/g, '')}?text=${encodeURIComponent(message)}`); }} />
          )}
          <Row left={icon(<Share2 size={18} strokeWidth={1.75} />, 'blue')} title="Telegram" subtitle="Выбрать чат клиента"
            onClick={() => { haptic.tap(); log('telegram'); shareLink(info.url, info.text); }} />
          <Row left={icon(<Send size={18} strokeWidth={1.75} />)} title={busy === 'bot' ? 'Отправляю…' : 'Прислать PDF мне в бот'}
            subtitle="Потом «Переслать» клиенту в любой мессенджер" onClick={busy ? undefined : viaBot} />
          <Row left={icon(<Copy size={18} strokeWidth={1.75} />)} title="Скопировать ссылку" subtitle="Вставить в SMS или Viber"
            onClick={async () => { haptic.tap(); if (await copyText(message)) { log('copy'); toast('Текст со ссылкой скопирован'); } else toast(info.url); }} />
        </Group>
      )}
    </Sheet>
  );
}
