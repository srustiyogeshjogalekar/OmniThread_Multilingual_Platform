# OmniThread demo

## Run with SQLite persistence

The discussion demo uses Python's built-in HTTP server and SQLite; no packages need to be installed.

1. From this folder, run `python omnithread_server.py`.
2. Open `http://127.0.0.1:8000/` in your browser.
3. Stop the server with `Ctrl+C`.

The server creates `omnithread.sqlite3` in this folder. Comments, reply threads, edit history, reactions, reports, moderation records, and discussion settings are stored in SQLite. Keep the application open through the server URL for database persistence. Opening `index.html` directly uses the browser-only fallback instead.

The development server binds to localhost and is intended for a local demo, not public deployment. The existing browser demo personas and moderation controls are not authenticated server-side. Registration credentials and sign-in sessions remain in browser storage; they are not stored in this SQLite database.

## Access from another device on your Wi-Fi

For a temporary demo on a trusted private network, start the server with `OMNITHREAD_HOST=0.0.0.0` (in PowerShell: `$env:OMNITHREAD_HOST = "0.0.0.0"; python omnithread_server.py`). If port 8000 is already in use, also set `OMNITHREAD_PORT` to an available port and use that port in the URL. On another device connected to the same Wi-Fi, open `http://<this-computer's-local-IP>:<port>/`. Keep the server bound to localhost for regular use; do not expose this unauthenticated demo to the public internet.

## Translation provider

The Translate action uses the bundled sample phrasebook when a sample phrase matches. Other comments are sent to a configured LibreTranslate-compatible endpoint by the Python server; translation credentials are never sent to the browser. The provider receives the comment text, so configure a service whose privacy terms are suitable for your use.

Set `OMNITHREAD_TRANSLATION_URL` to the provider's `/translate` endpoint before starting the server. If the provider requires an API key, set `OMNITHREAD_TRANSLATION_API_KEY` in the server environment. The endpoint must accept a JSON `POST` with `q`, `source`, `target`, and `format` fields and return a JSON `translatedText` field. Source autodetection and the application's English, Spanish, Japanese, Hindi, French, Russian, Chinese (Simplified), Arabic, German, Portuguese, and Korean target options are supported. Without provider configuration, sample translations continue to work and other translation attempts display an explicit configuration error.
