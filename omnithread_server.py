import json
import os
import sqlite3
import urllib.error
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Dict
from urllib.parse import urlsplit

import sqlite_store


HOST = os.environ.get("OMNITHREAD_HOST", "127.0.0.1")
PORT = int(os.environ.get("OMNITHREAD_PORT", "8000"))
ROOT = Path(__file__).resolve().parent
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_TRANSLATION_TEXT_LENGTH = 1000
MAX_TRANSLATION_RESPONSE_BYTES = 64 * 1024
TRANSLATION_TIMEOUT_SECONDS = 8
SUPPORTED_LANGUAGES = {"en", "es", "ja", "hi", "fr", "ru"}


class OmniThreadHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self) -> None:
        request_path = urlsplit(self.path).path
        if request_path == "/api/state":
            try:
                state = sqlite_store.load_state()
                self._send_json(200, {"state": state})
            except (sqlite3.Error, json.JSONDecodeError, KeyError, TypeError) as error:
                self.log_error("Unable to read application state: %s", error)
                self._send_json(500, {"error": "The database could not load the application state."})
            return
        if request_path.endswith((".py", ".sqlite3", ".sqlite3-shm", ".sqlite3-wal")):
            self.send_error(404)
            return
        super().do_GET()

    def do_PUT(self) -> None:
        if urlsplit(self.path).path != "/api/state":
            self._send_json(404, {"error": "Not found."})
            return
        try:
            state = self._read_json()
            sqlite_store.save_state(state)
            self._send_json(200, {"saved": True})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
        except sqlite3.Error as error:
            self.log_error("Unable to persist application state: %s", error)
            self._send_json(500, {"error": "The database could not save the application state."})

    def do_POST(self) -> None:
        if urlsplit(self.path).path != "/api/translate":
            self._send_json(404, {"error": "Not found."})
            return
        endpoint = os.environ.get("OMNITHREAD_TRANSLATION_URL", "").strip()
        if not endpoint:
            self._send_json(503, {"error": "Translation is not configured on this server."})
            return
        try:
            payload = self._read_json()
            text = payload.get("text")
            source = payload.get("source", "auto")
            target = payload.get("target")
            if not isinstance(text, str) or not text.strip():
                raise ValueError("Text to translate is required.")
            if len(text) > MAX_TRANSLATION_TEXT_LENGTH:
                raise ValueError(f"Text must be {MAX_TRANSLATION_TEXT_LENGTH} characters or fewer.")
            if source != "auto" and source not in SUPPORTED_LANGUAGES:
                raise ValueError("The source language is not supported.")
            if target not in SUPPORTED_LANGUAGES:
                raise ValueError("The target language is not supported.")
            translated_text = self._translate_text(endpoint, text, source, target)
            self._send_json(200, {"translatedText": translated_text})
        except (ValueError, KeyError, TypeError, json.JSONDecodeError) as error:
            self._send_json(400, {"error": str(error)})
        except RuntimeError as error:
            self.log_error("Translation provider request failed: %s", error)
            self._send_json(502, {"error": str(error)})

    def _translate_text(self, endpoint: str, text: str, source: str, target: str) -> str:
        if urlsplit(endpoint).scheme not in {"http", "https"} or not urlsplit(endpoint).netloc:
            raise RuntimeError("The translation endpoint configuration is invalid.")
        provider_payload = {
            "q": text,
            "source": source,
            "target": target,
            "format": "text",
        }
        api_key = os.environ.get("OMNITHREAD_TRANSLATION_API_KEY")
        if api_key:
            provider_payload["api_key"] = api_key
        request = urllib.request.Request(
            endpoint,
            data=json.dumps(provider_payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json", "Accept": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=TRANSLATION_TIMEOUT_SECONDS) as response:
                body = response.read(MAX_TRANSLATION_RESPONSE_BYTES + 1)
        except urllib.error.HTTPError as error:
            raise RuntimeError(f"The translation provider returned HTTP {error.code}.") from error
        except (urllib.error.URLError, TimeoutError) as error:
            raise RuntimeError("The translation provider could not be reached.") from error
        if len(body) > MAX_TRANSLATION_RESPONSE_BYTES:
            raise RuntimeError("The translation provider response was too large.")
        try:
            result = json.loads(body)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise RuntimeError("The translation provider returned an invalid response.") from error
        translated_text = result.get("translatedText") if isinstance(result, dict) else None
        if not isinstance(translated_text, str) or not translated_text.strip():
            raise RuntimeError("The translation provider did not return translated text.")
        return translated_text

    def _read_json(self) -> Dict[str, Any]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request length.") from error
        if length <= 0 or length > MAX_REQUEST_BYTES:
            raise ValueError("Request body must be between 1 byte and 2 MiB.")
        payload = json.loads(self.rfile.read(length))
        if not isinstance(payload, dict):
            raise ValueError("The application state must be a JSON object.")
        return payload

    def _send_json(self, status: int, payload: Dict[str, Any]) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format: str, *args: Any) -> None:
        print(f"{self.log_date_time_string()} - {format % args}")


def main() -> None:
    sqlite_store.initialize()
    server = ThreadingHTTPServer((HOST, PORT), OmniThreadHandler)
    print(f"OmniThread is running at http://{HOST}:{PORT}/")
    print(f"SQLite database: {sqlite_store.DATABASE_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping OmniThread.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
