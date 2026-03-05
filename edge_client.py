import time
import requests
import numpy as np
from data_ingestion import fetch_solcast_forecast, fetch_openei_load_profile, get_tou_pricing

API_URL = "http://localhost:8000/optimize"

# Simulated Physical Hardware State
PHYSICAL_BATTERY_CAPACITY = 47.4
physical_soc = 0.5 * PHYSICAL_BATTERY_CAPACITY  # Starts at 50%
eta_ch, eta_dis = 0.95, 0.95

# Actual physical conditions (volatile)
T_sim = 24
true_pv = 10.0 * np.exp(-0.5 * ((np.linspace(0, 24, T_sim) - 12) / 2.5) ** 2)
true_pv = np.clip(true_pv * (1 + 0.15 * np.random.randn(T_sim)), 0, 10.0) # 15% noise

base_load = np.interp(np.linspace(0, 24, T_sim), np.arange(24), 
                      [2,2,2,3,4,6,8,12,15,18,20,22,21,19,16,14,10,8,6,5,4,3,2,2])
true_load = base_load * (1 + 0.1 * np.random.randn(T_sim)) # 10% noise

import_prices, export_prices = get_tou_pricing(T=T_sim)

print("🔋 Booting Virtual Edge Controller...")
print("Connecting to Cloud Optimization API: ", API_URL)
time.sleep(2)

total_cost_incurred = 0.0

for t in range(T_sim):
    print(f"\n--- 🕒 Edge Device Tick (Hour {t}) ---")
    print(f"🌡 Physical Truth -> SOC: {physical_soc:.2f}kWh | PV: {true_pv[t]:.2f}kW | Load: {true_load[t]:.2f}kW")
    
    # 1. Data Ingestion (Simulating a local ML forecasting microservice)
    # We fetch new 24h rolling forecasts starting from current hour 't'
    
    # === 🔑 INSERT YOUR API KEYS HERE ===
    SOLCAST_API_KEY = "Jgh9S6T8HJe52HqRgOXTX8-dV8Qk2aDL"      # e.g., "solcast_abc123_xyz..."
    SOLCAST_SITE_ID = "b926-8fd2-ad3f-e4f5"
    # ====================================

    fc_pv = fetch_solcast_forecast(api_key=SOLCAST_API_KEY, T=24, site_id=SOLCAST_SITE_ID) # in reality, shifted by 't'
    fc_load = fetch_openei_load_profile(T=24)
    p_imp, p_exp = get_tou_pricing(T=24)
    
    # 2. Package current state and forecasts to send to the Cloud API
    payload = {
        "current_soc_kwh": physical_soc,
        "pv_forecast_24h": fc_pv,
        "load_forecast_24h": fc_load,
        "import_price_24h": p_imp,
        "export_price_24h": p_exp
    }
    
    # 3. Request optimal action from Cloud (Simulating latency)
    print("📡 Sending telemetry to Cloud Optimizer...")
    try:
        start = time.time()
        response = requests.post(API_URL, json=payload, timeout=10)
        action = response.json()
        print(f"✅ Received Setpoints in {(time.time()-start)*1000:.0f}ms")
    except Exception as e:
        print(f"❌ API Connection Failed: {e}")
        break
        
    act_imp = action['action_p_import_kw']
    act_exp = action['action_p_export_kw']
    act_ch  = action['action_bat_charge_kw']
    act_dis = action['action_bat_discharge_kw']
    
    # 4. Enforce on Physical Microgrid
    # Calculate balance to handle forecast VS physical reality mismatch
    balance = (act_imp + act_dis + true_pv[t]) - (act_exp + act_ch + true_load[t])
    
    if balance < -0.01:
        act_imp += abs(balance) # Pull more from grid to cover deficit
        print("  [Auto-Correction] Increased Grid Import to match physical load.")
    elif balance > 0.01:
        act_exp += balance # Dump excess to grid
        print("  [Auto-Correction] Increased Grid Export to dump excess PV.")
        
    # Update Physical SOC
    physical_soc += (eta_ch * act_ch - act_dis / eta_dis) * 1.0 # 1 hour dt
    physical_soc = np.clip(physical_soc, 0.2*PHYSICAL_BATTERY_CAPACITY, 0.9*PHYSICAL_BATTERY_CAPACITY)
    
    # Log economic realities
    cost_t = (import_prices[t] * act_imp) - (export_prices[t] * act_exp)
    total_cost_incurred += cost_t
    
    time.sleep(1) # Wait 1 second before next hour (simulating fast-forward clock)

print(f"\n🏁 24h Edge Simulation Complete. Total Operational Cost: ₹{total_cost_incurred:,.2f}")
