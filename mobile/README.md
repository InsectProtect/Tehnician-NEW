# APK для Android (InsectProtect)

Тонкая обёртка (Capacitor) над сайтом приложения на Render. Интерфейс грузится с сервера, поэтому
обновления приложения (vNN) приходят сами — новый APK нужен только при смене иконки/названия/адреса.

Вход — только через Telegram: «Войти через Telegram» → бот → «✅ Войти». Дальше PIN, как обычно.

## Сборка
APK собирается на GitHub только вручную: Actions → Android APK → Run workflow
(сейчас основной режим — Telegram). Готовый файл — в Releases (скачивается с телефона).

Адрес сервера: переменная репозитория `APP_URL` (Settings → Secrets and variables → Actions → Variables)
или файл `mobile/app-url.txt`.

Подпись: ключ хранится только в GitHub Secrets (`ANDROID_KEYSTORE_B64`, `ANDROID_KEYSTORE_PASSWORD`,
`ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`), в репозиторий не кладётся. Пока ключ тот же — новые APK ставятся поверх старых.
