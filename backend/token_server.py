from dotenv import load_dotenv
load_dotenv(dotenv_path=".env.local")

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from livekit.api import AccessToken, VideoGrants
import os, uuid

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
    allow_credentials=False,
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
    return JSONResponse(
        content={"token": token, "url": os.environ["LIVEKIT_URL"]},
        headers={
            "ngrok-skip-browser-warning": "true",
            "Access-Control-Allow-Origin": "*",
        }
    )