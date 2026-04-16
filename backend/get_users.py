import asyncio
from database import db
import json

async def main():
    users = await db.users.find().to_list(100)
    out = []
    for u in users:
        u.pop("_id", None)
        out.append(u)
    with open("users.json", "w") as f:
        json.dump(out, f, indent=2)
    print("Wrote users.json")

if __name__ == "__main__":
    asyncio.run(main())
