from alpaca.trading.client import TradingClient

client = TradingClient(
    api_key="PKLIF6TNUHOUCMWZOPP7ZAQ6YY",
    secret_key="BVHtYd11VESNA5i94LYwzx1TmtJPMEBDHzSJNVtnn4cu",
    paper=True   # ← sandbox mode
)

account = client.get_account()
print(f"Balance: ${account.portfolio_value}")