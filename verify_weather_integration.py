import os
import sys

# Add current directory to path
sys.path.append(os.getcwd())

from decentralized_api import get_weather_data

print("--- Testing get_weather_data for Chennai ---")
res = get_weather_data("chennai")
if res:
    print("\n[SUCCESS] Weather data fetched accurately.")
else:
    print("\n[FAILURE] Weather data fetch failed.")
