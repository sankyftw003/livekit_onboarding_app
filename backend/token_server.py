from dotenv import load_dotenv
load_dotenv(dotenv_path=".env.local")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from livekit.api import AccessToken, VideoGrants
import os, uuid

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
     allow_origins=[
        "http://localhost:5173",
        "https://livekit-onboarding-app-git-main-sankeerth003.vercel.app",
        "https://*.vercel.app",
    ],
    allow_methods=["*"],
    allow_headers=["*"]
)

@app.get("/token")
async def get_token():
    token = (
        AccessToken(os.environ["LIVEKIT_API_KEY"], os.environ["LIVEKIT_API_SECRET"])
        .with_identity(f"user-{uuid.uuid4().hex[:8]}")
        .with_name("User")
        .with_grants(VideoGrants(room_join=True, room="aura-room"))
        .to_jwt()
    )
    return {
        "token": token,
        "url": os.environ["LIVEKIT_URL"]
    }