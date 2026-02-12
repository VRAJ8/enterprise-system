from motor.motor_asyncio import AsyncIOMotorClient
import os
from dotenv import load_dotenv
from pathlib import Path

# Load environment variables from the .env file in the current directory
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# 1. Get the Connection String
# This looks for 'MONGO_URL' in your .env file
mongo_url = os.environ.get('MONGO_URL')

# 2. Initialize the Client
client = AsyncIOMotorClient(mongo_url)

# 3. Set the Database Name 
# We use the actual name 'Enterprise-Management-System' directly as the database name
db = client['Enterprise-Management-System']