import asyncio
from database import db
from auth_utils import verify_password
import traceback

async def main():
    users = await db.users.find().to_list(100)
    for u in users:
        print(f"[{u['email']}] (Role: {u['role']}) - Pwd hash length: len={len(u.get('password', ''))}")
        # Test if login with this email + "password123" works
        try:
            if u.get('password'):
                ok = verify_password("password123", u['password'])
                if ok:
                    print("  -> Login with 'password123' SUCCESS")
            else:
                print("  -> Empty password (OAuth user?)")
        except Exception as e:
            print(f"  -> Error verifying: {e}")

if __name__ == "__main__":
    asyncio.run(main())
