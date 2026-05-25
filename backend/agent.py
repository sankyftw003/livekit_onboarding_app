import asyncio
import json
from dotenv import load_dotenv
load_dotenv(dotenv_path=".env.local")

from livekit.agents import (
    Agent, AgentSession, JobContext,
    WorkerOptions, cli, AutoSubscribe, function_tool,
)
from livekit.plugins import silero
from crypto_tools import fetch_crypto

SYSTEM_PROMPT = """
You are AURA, a friendly crypto voice assistant with access to live prices.

When a user asks about a crypto price:
1. Call get_crypto_price with the coin name
2. Speak a short natural response with the price and 24h change
3. Keep it conversational — one or two sentences max

Supported coins: Bitcoin, Ethereum, Solana, Dogecoin, Cardano, XRP,
BNB, Polygon, Avalanche, Chainlink, Litecoin, Polkadot, Shiba Inu, Uniswap.

If asked about an unsupported coin, say so and suggest one from the list.
Keep all responses concise — this is a voice call.
"""


async def entrypoint(ctx: JobContext):
    print("=== AGENT STARTED ===")
    await ctx.connect(auto_subscribe=AutoSubscribe.AUDIO_ONLY)
    print(f"=== CONNECTED TO ROOM: {ctx.room.name} ===")

    vad = silero.VAD.load(
        min_speech_duration=0.2,
        min_silence_duration=0.8,
        activation_threshold=0.6,
        prefix_padding_duration=0.3,
    )

    # Define tool inside entrypoint so it can access ctx.room
    @function_tool
    async def get_crypto_price(coin_name: str) -> str:
        """
        Fetch the live price and market data for a cryptocurrency.
        Args:
            coin_name: Name or symbol of the coin e.g. 'bitcoin', 'eth', 'solana'
        """
        print(f"=== TOOL CALLED: get_crypto_price({coin_name}) ===")
        data = await fetch_crypto(coin_name)
        print(f"=== FETCH RESULT: {data} ===")

        if "error" in data:
            return data["error"]

        # Send card data to frontend
        try:
            msg = json.dumps({"type": "crypto_data", "data": data})
            await ctx.room.local_participant.publish_data(
                msg.encode(), reliable=True
            )
            print("=== CARD DATA PUBLISHED TO FRONTEND ===")
        except Exception as e:
            print(f"=== PUBLISH ERROR: {e} ===")

        direction = "up" if data["change"] >= 0 else "down"
        return (
            f"{data['name']} is currently at ${data['price']:,.2f}, "
            f"{direction} {abs(data['change']):.2f}% in the last 24 hours. "
            f"Market cap is ${data['marketCap']/1e9:.1f} billion, ranked #{data['rank']}."
        )

    session = AgentSession(
        vad=vad,
        stt="deepgram/nova-3",
        llm="openai/gpt-4.1-mini",
        tts="cartesia/sonic-2",
    )

    await session.start(
        room=ctx.room,
        agent=Agent(
            instructions=SYSTEM_PROMPT,
            tools=[get_crypto_price],
        ),
    )

    session.forward_transcription = True
    await asyncio.sleep(2)
    await session.say(
        "Hey! I'm AURA, your crypto assistant. "
        "Ask me about any coin — Bitcoin, Ethereum, Solana, and more!"
    )


if __name__ == "__main__":
    cli.run_app(WorkerOptions(entrypoint_fnc=entrypoint))
