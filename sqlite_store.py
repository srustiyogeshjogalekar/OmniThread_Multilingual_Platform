import json
import sqlite3
from pathlib import Path
from typing import Any, Dict, Optional


DATABASE_PATH = Path(__file__).with_name("omnithread.sqlite3")


def connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DATABASE_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA journal_mode = WAL")
    return connection


def initialize() -> None:
    with connect() as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS comments (
                id TEXT PRIMARY KEY,
                parent_id TEXT REFERENCES comments(id),
                user_key TEXT NOT NULL,
                text TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                lang TEXT NOT NULL,
                likes_json TEXT NOT NULL,
                dislikes_json TEXT NOT NULL,
                version INTEGER NOT NULL,
                history_json TEXT NOT NULL,
                is_deleted INTEGER NOT NULL DEFAULT 0,
                translated_cache_json TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS reports (
                id TEXT PRIMARY KEY,
                comment_id TEXT NOT NULL,
                comment_text TEXT NOT NULL,
                reported_by TEXT NOT NULL,
                reason TEXT NOT NULL,
                status TEXT NOT NULL,
                timestamp TEXT NOT NULL,
                reviewed_by TEXT,
                reviewed_at TEXT
            );
            CREATE TABLE IF NOT EXISTS moderation_records (
                id TEXT PRIMARY KEY,
                action TEXT NOT NULL,
                details TEXT NOT NULL,
                actor TEXT NOT NULL,
                timestamp TEXT NOT NULL
            );
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value_json TEXT NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_id);
            CREATE INDEX IF NOT EXISTS idx_comments_timestamp ON comments(timestamp);
            CREATE INDEX IF NOT EXISTS idx_reports_status ON reports(status);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_reporter_comment
                ON reports(comment_id, reported_by);
            """
        )


def load_state() -> Optional[Dict[str, Any]]:
    with connect() as connection:
        if connection.execute("SELECT 1 FROM settings WHERE key = 'initialized'").fetchone() is None:
            return None

        settings = {
            row["key"]: json.loads(row["value_json"])
            for row in connection.execute("SELECT key, value_json FROM settings")
            if row["key"] != "initialized"
        }
        comments = []
        for row in connection.execute("SELECT * FROM comments ORDER BY timestamp, id"):
            comments.append(
                {
                    "id": row["id"],
                    "parent_id": row["parent_id"],
                    "user_key": row["user_key"],
                    "text": row["text"],
                    "timestamp": row["timestamp"],
                    "lang": row["lang"],
                    "likes": json.loads(row["likes_json"]),
                    "dislikes": json.loads(row["dislikes_json"]),
                    "version": row["version"],
                    "history": json.loads(row["history_json"]),
                    "is_deleted": bool(row["is_deleted"]),
                    "translated_cache": json.loads(row["translated_cache_json"]),
                }
            )
        reports = [
            {
                "id": row["id"],
                "comment_id": row["comment_id"],
                "comment_text": row["comment_text"],
                "reported_by": row["reported_by"],
                "reason": row["reason"],
                "status": row["status"],
                "timestamp": row["timestamp"],
                "reviewed_by": row["reviewed_by"],
                "reviewed_at": row["reviewed_at"],
            }
            for row in connection.execute("SELECT * FROM reports ORDER BY timestamp DESC, id")
        ]
        moderation_records = [
            dict(row)
            for row in connection.execute(
                "SELECT id, action, details, actor, timestamp FROM moderation_records ORDER BY timestamp DESC, id"
            )
        ]
    return {**settings, "comments": comments, "reports": reports, "moderationRecords": moderation_records}


def save_state(state: Dict[str, Any]) -> None:
    comments = state.get("comments", [])
    reports = state.get("reports", [])
    moderation_records = state.get("moderationRecords", [])
    if not isinstance(comments, list) or not isinstance(reports, list) or not isinstance(moderation_records, list):
        raise ValueError("Comments, reports, and moderation records must be arrays.")

    with connect() as connection:
        connection.execute("BEGIN IMMEDIATE")
        for comment in comments:
            connection.execute(
                """
                INSERT INTO comments (
                    id, parent_id, user_key, text, timestamp, lang, likes_json,
                    dislikes_json, version, history_json, is_deleted, translated_cache_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    parent_id = excluded.parent_id,
                    user_key = excluded.user_key,
                    text = excluded.text,
                    timestamp = excluded.timestamp,
                    lang = excluded.lang,
                    likes_json = excluded.likes_json,
                    dislikes_json = excluded.dislikes_json,
                    version = excluded.version,
                    history_json = excluded.history_json,
                    is_deleted = excluded.is_deleted,
                    translated_cache_json = excluded.translated_cache_json
                """,
                (
                    comment["id"],
                    comment.get("parent_id"),
                    comment["user_key"],
                    comment["text"],
                    comment["timestamp"],
                    comment.get("lang", "en"),
                    json.dumps(comment.get("likes", []), ensure_ascii=False),
                    json.dumps(comment.get("dislikes", []), ensure_ascii=False),
                    int(comment.get("version", 1)),
                    json.dumps(comment.get("history", []), ensure_ascii=False),
                    int(bool(comment.get("is_deleted", False))),
                    json.dumps(comment.get("translated_cache", {}), ensure_ascii=False),
                ),
            )

        for report in reports:
            connection.execute(
                """
                INSERT INTO reports (
                    id, comment_id, comment_text, reported_by, reason, status, timestamp,
                    reviewed_by, reviewed_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    status = excluded.status,
                    reviewed_by = excluded.reviewed_by,
                    reviewed_at = excluded.reviewed_at
                """,
                (
                    report["id"],
                    report["comment_id"],
                    report.get("comment_text", ""),
                    report["reported_by"],
                    report["reason"],
                    report.get("status", "pending"),
                    report["timestamp"],
                    report.get("reviewed_by"),
                    report.get("reviewed_at"),
                ),
            )

        for record in moderation_records:
            connection.execute(
                """
                INSERT OR IGNORE INTO moderation_records (id, action, details, actor, timestamp)
                VALUES (?, ?, ?, ?, ?)
                """,
                (record["id"], record["action"], record["details"], record["actor"], record["timestamp"]),
            )

        for key in ("currentUserKey", "preferredLang", "editLimitMinutes", "rateLimitMax", "userPostingTimestamps", "filteredCount"):
            if key in state:
                connection.execute(
                    """
                    INSERT INTO settings (key, value_json) VALUES (?, ?)
                    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json
                    """,
                    (key, json.dumps(state[key], ensure_ascii=False)),
                )
        connection.execute(
            "INSERT INTO settings (key, value_json) VALUES ('initialized', 'true') "
            "ON CONFLICT(key) DO UPDATE SET value_json = 'true'"
        )
