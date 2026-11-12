# OmniThread Engine Backend Logic
import re
import datetime
from typing import Dict, List, Optional, Tuple

class OmniThreadModerator:
    def __init__(self, rate_limit_per_min: int = 3, edit_window_minutes: int = 5):
        self.rate_limit_per_min = rate_limit_per_min
        self.edit_window_minutes = edit_window_minutes
        self.blocked_keywords = {"scam", "cheap-crypto", "hack_account", "idiot"}
        self.user_timestamps: Dict[str, List[datetime.datetime]] = {}

    def check_rate_limit(self, user_id: str) -> bool:
        now = datetime.datetime.now()
        timestamps = self.user_timestamps.get(user_id, [])
        valid_timestamps = [t for t in timestamps if (now - t).total_seconds() < 60]
        self.user_timestamps[user_id] = valid_timestamps
        return len(valid_timestamps) < self.rate_limit_per_min

    def filter_content(self, text: str, user_id: str) -> Tuple[bool, str]:
        if not self.check_rate_limit(user_id):
            return False, "Rate limit exceeded. Security CAPTCHA required."
        lower_text = text.lower()
        for word in self.blocked_keywords:
            if word in lower_text:
                return False, f"Blocked: Contains prohibited word '{word}'."
        if re.search(r'(.)\1{5,}', text):
            return False, "Blocked: Excessive character repetition."
        if re.search(r'https?://[^\s]+', text):
            return False, "Blocked: Untrusted link."
        if user_id not in self.user_timestamps:
            self.user_timestamps[user_id] = []
        self.user_timestamps[user_id].append(datetime.datetime.now())
        return True, "Passed"

class Comment:
    def __init__(self, comment_id: str, user_id: str, username: str, text: str, location: str, parent_id: Optional[str] = None):
        self.id = comment_id
        self.user_id = user_id
        self.username = username
        self.location = location
        self.parent_id = parent_id
        self.text = text
        self.timestamp = datetime.datetime.now()
        self.version = 1
        self.history: List[Dict] = []
        self.likes: set = set()
        self.dislikes: set = set()
        self.is_deleted: bool = False
        self.translated_cache: Dict[str, str] = {}

    def edit(self, new_text: str, current_version: int, max_edit_minutes: int) -> Tuple[bool, str]:
        if current_version != self.version:
            return False, "Concurrency Conflict: Comment has been updated."
        elapsed = (datetime.datetime.now() - self.timestamp).total_seconds() / 60.0
        if elapsed > max_edit_minutes:
            return False, f"Edit window of {max_edit_minutes} minutes expired."
        self.history.append({
            'version': self.version,
            'text': self.text,
            'edited_at': datetime.datetime.now().isoformat()
        })
        self.text = new_text
        self.version += 1
        self.translated_cache.clear()
        return True, "Updated successfully."

    def soft_delete(self):
        self.is_deleted = True
        self.text = "[This comment has been deleted by author]"
