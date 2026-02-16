import os
import pymysql
from dotenv import load_dotenv

load_dotenv(".env") # Path relative to backend root

DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "")
DB_HOST = os.getenv("DB_HOST", "localhost")
DB_PORT = int(os.getenv("DB_PORT", "3306"))
DB_NAME = os.getenv("DB_NAME", "viewingchart")

print(f"Connecting to MySQL as {DB_USER}...")

try:
    conn = pymysql.connect(
        host=DB_HOST,
        user=DB_USER,
        password=DB_PASSWORD,
        port=DB_PORT
    )
    cursor = conn.cursor()
    
    print(f"Creating database '{DB_NAME}' if not exists...")
    cursor.execute(f"CREATE DATABASE IF NOT EXISTS {DB_NAME}")
    
    print("Database ready.")
    conn.close()
except Exception as e:
    print(f"Error initializing database: {e}")
