import logging
from motor.motor_asyncio import AsyncIOMotorClient
from config import MONGO_URL, DB_NAME

logger = logging.getLogger(__name__)

client = AsyncIOMotorClient(MONGO_URL)
db = client[DB_NAME]

INDEXES = [
    ("users", "user_id", {"unique": True}),
    ("users", "email", {"unique": True}),
    ("projects", "project_id", {"unique": True}),
    ("projects", "team_members", {}),
    ("tasks", "task_id", {"unique": True}),
    ("tasks", [("project_id", 1), ("status", 1)], {}),
    ("tasks", "assigned_to", {}),
    ("milestones", "project_id", {}),
    ("notifications", [("user_id", 1), ("created_at", -1)], {}),
    ("chat_channels", "channel_id", {"unique": True}),
    ("chat_channels", "members", {}),
    ("chat_messages", [("channel_id", 1), ("created_at", -1)], {}),
    ("comments", [("entity_type", 1), ("entity_id", 1)], {}),
    ("files", [("entity_type", 1), ("entity_id", 1)], {}),
    ("activity_logs", [("project_id", 1), ("created_at", -1)], {}),
    ("user_sessions", "session_token", {}),
]


async def ensure_indexes():
    for collection, keys, opts in INDEXES:
        try:
            await db[collection].create_index(keys, **opts)
        except Exception as e:  # e.g. existing duplicate data blocks a unique index
            logger.warning("Could not create index %s on %s: %s", keys, collection, e)
