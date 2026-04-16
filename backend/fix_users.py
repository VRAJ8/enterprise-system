import asyncio
from database import db
from auth_utils import hash_password

async def main():
    pwd_hash = hash_password("password123")
    
    # Force insert test@demo.com
    test_user = {
        "user_id": "test_user_123",
        "name": "Test User",
        "email": "test@demo.com",
        "password": pwd_hash,
        "role": "admin",
        "picture": None,
        "department": "Engineering"
    }
    await db.users.update_one({"email": "test@demo.com"}, {"$set": test_user}, upsert=True)
    
    # Overwrite all local users with password123 to be absolutely safe
    await db.users.update_many({}, {"$set": {"password": pwd_hash}})
    
    print("All users updated successfully with password: password123!")

if __name__ == "__main__":
    asyncio.run(main())
