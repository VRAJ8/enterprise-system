import asyncio
from database import db
from auth_utils import verify_password
import os

async def main():
    print(f"Using DB: {db.name} | MONGO_URL: {os.getenv('MONGO_URL')} | DB_NAME: {os.getenv('DB_NAME')}")
    user = await db.users.find_one({"email": "test@demo.com"}, {"_id": 0})
    if not user:
        print("User test@demo.com NOT FOUND in database!")
    else:
        print("User found!")
        try:
            match = verify_password("password123", user.get("password", ""))
            print(f"Password Match: {match}")
        except Exception as e:
            print(f"Verify error: {e}")

if __name__ == "__main__":
    asyncio.run(main())
