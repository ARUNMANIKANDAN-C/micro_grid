import os
import sys
import json
from datetime import datetime, timedelta

# Add current directory to path
sys.path.append(os.getcwd())

from decentralized_api import simulate_24h, get_city_pricing

print("--- Verifying Simulation Alignment ---")

# 1. Test Pricing Rotation
print("\n[Test 1] Pricing Rotation:")
p_12am, _ = get_city_pricing("chennai", hours=24, start_hour=0)
p_10am, _ = get_city_pricing("chennai", hours=24, start_hour=10)

print(f"12 AM First Price: {p_12am[0]}")
print(f"10 AM First Price: {p_10am[0]} (Should match 11th element of 12AM: {p_12am[10]})")

if p_10am[0] == p_12am[10]:
    print("SUCCESS: Pricing rotation is correct.")
else:
    print("FAILURE: Pricing rotation alignment error.")

# 2. Test 24h Simulation Loop (dry run/mock call)
print("\n[Test 2] 24h Simulation Structure:")
try:
    # We call it without real API calls if possible, or just check if it executes
    # Note: simulate_24h is decorated with @app.post, so we might need to call the function logic
    # but here we just check if it starts and processes at least one hour
    res = simulate_24h()
    sim = res.get("simulation", [])
    print(f"Captured {len(sim)} simulation hours.")
    
    if len(sim) == 24:
        print("SUCCESS: Full 24-hour simulation sequence generated.")
        # Check hour 10 alignment
        h10 = sim[10]
        print(f"Hour 10 check: hour={h10['hour']}")
    else:
        print(f"FAILURE: Expected 24 hours, got {len(sim)}")
except Exception as e:
    print(f"Simulation execution error: {e}")
