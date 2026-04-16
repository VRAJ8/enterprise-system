import asyncio
from database import db
from auth_utils import verify_password
import json

async def main():
    users = await db.users.find().to_list(100)
    print("Found", len(users), "users.")
    for u in users:
        email = u.get("email")
        password_hash = u.get("password")
        pwd_match = False
        try:
            pwd_match = verify_password("password123", password_hash)
        except Exception:
            pass
        print(f"User: {email} | Hash len: {len(password_hash)} | password123 match: {pwd_match}")

if __name__ == "__main__":
    asyncio.run(main())
