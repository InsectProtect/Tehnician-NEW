import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload } from 'lucide-react';
import { api } from '../api';
import { plural } from '../config';
import { haptic, openLink } from '../telegram';
import type { ImportStats } from '../types';
import { Button, Sheet, useToast } from '../components/ui';

function toBase64(buf: ArrayBuffer) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function ClientsSheet({ count, onClose, onImported }: {
  count: number; onClose: () => void; onImported: (added: number) => void;
}) {
  const toast = useToast();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportStats | null>(null);

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      toast('Файл больше 10 МБ', 'error');
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const stats = await api.importClients(file.name, toBase64(await file.arrayBuffer()));
      haptic.success();
      setResult(stats);
      onImported(stats.created);
    } catch (e) {
      haptic.error();
      toast((e as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <Sheet open onClose={onClose} title="База клиентов">
      <p className="-mt-3 mb-6 text-[15px] text-muted">
        Сейчас в базе {count} {plural(count, ['юрлицо', 'юрлица', 'юрлиц'])}.
      </p>

      <div className="rounded-2xl bg-card p-4 text-[15px] leading-relaxed">
        <div className="mb-2 flex items-center gap-2 font-semibold">
          <FileSpreadsheet size={18} strokeWidth={1.75} className="text-accent-ink" /> Формат файла
        </div>
        <div className="text-muted">
          Excel (.xlsx) или CSV. Колонки: <b className="font-medium text-ink dark:text-white">Юрлицо</b>, ИНН, <b className="font-medium text-ink dark:text-white">Адрес</b>, Контактное лицо, Телефон.
          Несколько объектов у клиента — несколько строк или колонки «Адрес 1», «Адрес 2». Повторная загрузка обновляет данные без дублей.
        </div>
      </div>

      {result && (
        <div className="mt-4 flex gap-3 rounded-2xl bg-[#34C759]/12 p-4 text-[15px]">
          <CheckCircle2 size={20} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#248A3D] dark:text-[#30D158]" />
          <div>
            Загружено строк: {result.total}.
            <div className="text-muted">
              Новых юрлиц: {result.created}, обновлено: {result.updated}, новых адресов: {result.addresses}
              {result.skipped ? `, пропущено строк без названия: ${result.skipped}` : ''}.
            </div>
          </div>
        </div>
      )}

      <input ref={input} type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
        className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

      <div className="mt-6 space-y-2.5">
        <Button loading={busy} onClick={() => input.current?.click()} icon={<Upload size={19} strokeWidth={1.75} />}>
          Загрузить Excel
        </Button>
        <Button variant="plain" onClick={() => openLink('/clients-template.xlsx')} icon={<Download size={18} strokeWidth={1.75} />}>
          Скачать шаблон
        </Button>
      </div>
    </Sheet>
  );
}
