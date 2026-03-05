import requests
from data_ingestion import fetch_openei_load_profile, fetch_solcast_forecast, get_tou_pricing

# 1. Test Solcast
print("Testing Solcast...")
try:
    pv = fetch_solcast_forecast(api_key="AWua6udp-eJU4nwTC0ApYZdU54V96OZI", T=24, site_id="b926-8fd2-ad3f-e4f5")
    print(f"Solcast fetched {len(pv)} data points")
except Exception as e:
    print(f"Solcast Error: {e}")

# 2. Test OpenEI
print("\nTesting OpenEI...")
try:
    load = fetch_openei_load_profile(api_key="aBRxunfOji5C9PNHi0x916FchIbv8sgzqCooSInm", T=24, dataset_uid="YOUR_DATASET_ID")
    print(f"OpenEI fetched {len(load)} data points.")
    print("OpenEI payload:")
    print(load)
except Exception as e:
    print(f"OpenEI Error: {e}")
