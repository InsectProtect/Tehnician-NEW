// Короткие звуки для ключевых событий. Файлы лежат в web/public/sounds/*.mp3.
// Воспроизведение всегда best-effort: если браузер блокирует автозвук (ещё не было
// пользовательского жеста) или звук выключен в настройках — просто молча пропускаем.

export type SoundName = 'qr' | 'task' | 'job' | 'deal' | 'kpi';

const FILES: Record<SoundName, string> = {
  qr: '/sounds/qr.mp3',
  task: '/sounds/task.mp3',
  job: '/sounds/job.mp3',
  deal: '/sounds/deal.mp3',
  kpi: '/sounds/kpi.mp3',
};

const cache = new Map<SoundName, HTMLAudioElement>();

function soundsEnabled(): boolean {
  try {
    return localStorage.getItem('sounds_off') !== '1';
  } catch {
    return true;
  }
}

export function setSoundsEnabled(on: boolean) {
  try {
    localStorage.setItem('sounds_off', on ? '0' : '1');
  } catch {
    /* ignore */
  }
}

export function playSound(name: SoundName) {
  if (!soundsEnabled()) return;
  try {
    let a = cache.get(name);
    if (!a) {
      a = new Audio(FILES[name]);
      a.volume = 0.6;
      cache.set(name, a);
    }
    a.currentTime = 0;
    void a.play().catch(() => {});
  } catch {
    /* ignore — звук не критичен */
  }
}

/** Разово в месяц/сутки проигрывает звук по ключу (чтобы не повторялся при каждом открытии экрана). */
export function playOnce(storageKey: string, name: SoundName) {
  try {
    if (localStorage.getItem(storageKey) === '1') return;
    localStorage.setItem(storageKey, '1');
  } catch {
    /* если localStorage недоступен — просто проигрываем один раз за сессию через cache выше */
  }
  playSound(name);
}
