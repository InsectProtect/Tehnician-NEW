# APK для Android (InsectProtect)

Тонкая обёртка (Capacitor) над сайтом приложения на Render. Интерфейс грузится с сервера, поэтому
обновления приложения (vNN) приходят сами — новый APK нужен только при смене иконки/названия/адреса.

Вход — только через Telegram: «Войти через Telegram» → бот → «✅ Войти». Дальше PIN, как обычно.

## Сборка
APK собирается автоматически на GitHub (Actions → «Android APK») при изменениях в папке `mobile/`
или вручную: Actions → Android APK → Run workflow. Готовый файл — в Releases (скачивается с телефона).

Адрес сервера: переменная репозитория `APP_URL` (Settings → Secrets and variables → Actions → Variables)
или файл `mobile/app-url.txt`.

Подпись: `keystore/insectprotect.keystore` (один и тот же ключ — новые APK ставятся поверх старых).
