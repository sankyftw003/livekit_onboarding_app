import httpx

# Maps common names/symbols to CoinGecko IDs
COIN_MAP = {
    "bitcoin": "bitcoin", "btc": "bitcoin",
    "ethereum": "ethereum", "eth": "ethereum",
    "solana": "solana", "sol": "solana",
    "cardano": "cardano", "ada": "cardano",
    "dogecoin": "dogecoin", "doge": "dogecoin",
    "xrp": "ripple", "ripple": "ripple",
    "bnb": "binancecoin", "binance": "binancecoin",
    "polygon": "matic-network", "matic": "matic-network",
    "avalanche": "avalanche-2", "avax": "avalanche-2",
    "chainlink": "chainlink", "link": "chainlink",
    "litecoin": "litecoin", "ltc": "litecoin",
    "polkadot": "polkadot", "dot": "polkadot",
    "shiba": "shiba-inu", "shib": "shiba-inu",
    "uniswap": "uniswap", "uni": "uniswap",
}

async def fetch_crypto(coin_name: str) -> dict:
    """Fetch live crypto data from CoinGecko. Returns data dict or error dict."""
    coin_id = COIN_MAP.get(coin_name.lower().strip())
    if not coin_id:
        return {"error": f"I don't recognise '{coin_name}'. Try Bitcoin, Ethereum, Solana, or Dogecoin."}

    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}"
    params = {
        "localization": "false",
        "tickers": "false",
        "community_data": "false",
        "developer_data": "false",
        "sparkline": "true",
    }

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(url, params=params)
        if resp.status_code != 200:
            return {"error": "Could not fetch data from CoinGecko right now."}
        d = resp.json()

    market    = d.get("market_data", {})
    price     = market.get("current_price", {}).get("usd", 0)
    change    = market.get("price_change_percentage_24h", 0) or 0
    market_cap = market.get("market_cap", {}).get("usd", 0)
    volume    = market.get("total_volume", {}).get("usd", 0)
    rank      = d.get("market_cap_rank", 0)
    sparkline = d.get("sparkline_in_7d", {}).get("price", [])

    # Downsample sparkline to ~48 points for display
    if len(sparkline) > 48:
        step = len(sparkline) // 48
        sparkline = sparkline[::step][:48]

    return {
        "symbol":    d.get("symbol", "").upper(),
        "name":      d.get("name", coin_name),
        "price":     price,
        "change":    change,
        "marketCap": market_cap,
        "volume":    volume,
        "rank":      rank,
        "sparkline": sparkline,
    }
