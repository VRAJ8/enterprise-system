import asyncio
import traceback
from agent_service import handle_ai_logic

async def main():
    try:
        reply = await handle_ai_logic("can you help me with some project tasks?")
        with open("traceback.txt", "w") as f:
            f.write("Success: " + str(reply))
    except Exception as e:
        with open("traceback.txt", "w") as f:
            f.write(traceback.format_exc())

if __name__ == "__main__":
    asyncio.run(main())
