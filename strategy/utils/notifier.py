"""Optional alert hooks: Telegram and Discord notifications."""

import requests
from utils.logger import get_logger

log = get_logger(__name__)


def send_telegram(token: str, chat_id: str, message: str) -> None:
    if not token or not chat_id:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    try:
        requests.post(url, json={"chat_id": chat_id, "text": message}, timeout=5)
    except Exception as exc:
        log.warning("Telegram notification failed: %s", exc)


def send_discord(webhook_url: str, message: str) -> None:
    if not webhook_url:
        return
    try:
        requests.post(webhook_url, json={"content": message}, timeout=5)
    except Exception as exc:
        log.warning("Discord notification failed: %s", exc)


class Notifier:
    def __init__(self, telegram_token: str, telegram_chat_id: str, discord_webhook: str):
        self.telegram_token = telegram_token
        self.telegram_chat_id = telegram_chat_id
        self.discord_webhook = discord_webhook

    def notify(self, message: str) -> None:
        log.info("ALERT: %s", message)
        send_telegram(self.telegram_token, self.telegram_chat_id, message)
        send_discord(self.discord_webhook, message)
