import asyncio
from database import db
from auth_utils import hash_password

async def main():
    user = {
        "user_id": "test_user_123",
        "name": "Test User",
        "email": "test@demo.com",
        "password": hash_password("password123"),
        "role": "admin",
        "picture": None,
        "department": "Engineering",
        "created_at": "2026-04-08T10:00:00Z"
    }
    await db.users.update_one({"email": user["email"]}, {"$set": user}, upsert=True)
    print("Test user created: test@demo.com / password123")
    
    # check if indices work
    try:
        await db.users.create_index("email", unique=True)
    except Exception as e:
        print("Index warning:", e)

if __name__ == "__main__":
    asyncio.run(main())
