"""Central configuration, loaded once from the environment (and backend/.env)."""
import os
import logging
from pathlib import Path
from dotenv import load_dotenv

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

logger = logging.getLogger(__name__)

ENV = os.environ.get("ENV", "development").lower()
IS_PRODUCTION = ENV == "production"

MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
DB_NAME = os.environ.get("DB_NAME", "Enterprise-Management-System")

_DEV_JWT_SECRET = "dev-only-insecure-secret-change-me"
JWT_SECRET = os.environ.get("JWT_SECRET", "")
if not JWT_SECRET:
    if IS_PRODUCTION:
        raise RuntimeError("JWT_SECRET must be set when ENV=production")
    logger.warning("JWT_SECRET is not set; using an insecure development secret")
    JWT_SECRET = _DEV_JWT_SECRET
JWT_EXPIRY_DAYS = int(os.environ.get("JWT_EXPIRY_DAYS", "7"))

CORS_ORIGINS = [
    o.strip()
    for o in os.environ.get("CORS_ORIGINS", "http://localhost:3000,http://localhost:5173").split(",")
    if o.strip()
]

# When false, only admins can create accounts (via User Management).
# The very first account is always allowed and becomes the admin.
ALLOW_OPEN_REGISTRATION = os.environ.get("ALLOW_OPEN_REGISTRATION", "true").lower() == "true"

# Google sign-in via Emergent Auth only works on the Emergent platform.
EMERGENT_AUTH_ENABLED = os.environ.get("EMERGENT_AUTH_ENABLED", "false").lower() == "true"

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = os.environ.get("GROQ_MODEL", "llama-3.3-70b-versatile")

RESEND_API_KEY = os.environ.get("RESEND_API_KEY", "")
SENDER_EMAIL = os.environ.get("SENDER_EMAIL", "onboarding@resend.dev")

UPLOAD_DIR = Path(os.environ.get("UPLOAD_DIR", str(ROOT_DIR / "uploads")))
MAX_UPLOAD_MB = int(os.environ.get("MAX_UPLOAD_MB", "20"))

DEADLINE_SCAN_MINUTES = int(os.environ.get("DEADLINE_SCAN_MINUTES", "30"))
