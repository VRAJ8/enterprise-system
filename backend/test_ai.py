import requests

url = "http://127.0.0.1:8000/api/ai/chat"
try:
    r = requests.post(url, json={"message": "can you help me with some project tasks?"})
    print("Status:", r.status_code)
    print("Response:", r.text)
except Exception as e:
    print("Error:", e)
