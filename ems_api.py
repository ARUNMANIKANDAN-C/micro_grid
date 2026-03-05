from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import numpy as np
import requests
import time as _time

# === API Setup ===
router = APIRouter()
# === API Key Settings Store ===
import json, os, math
_SETTINGS_FILE = os.path.join(os.path.dirname(__file__), ".ems_settings.json")
_settings = {
    "solcast_api_key": "",
    "solcast_site_id": "",
    "electricitymaps_api_key": "",
    "electricitymaps_zone": "IN-WE",
    "pv_capacity_kw": 10.0
}

# Load persisted settings on startup
if os.path.exists(_SETTINGS_FILE):
    try:
        with open(_SETTINGS_FILE) as f:
            _settings.update(json.load(f))
        print(f"⚙️ Loaded saved settings from {_SETTINGS_FILE}")
    except Exception:
        pass

class SettingsPayload(BaseModel):
    solcast_api_key: str = ""
    solcast_site_id: str = ""
    electricitymaps_api_key: str = ""
    electricitymaps_zone: str = "IN-WE"
    pv_capacity_kw: float = 10.0

@router.get("/settings")
def get_settings():
    """Get current API key settings (keys are masked for security)."""
    return {
        "solcast_api_key": ("****" + _settings["solcast_api_key"][-4:]) if len(_settings["solcast_api_key"]) > 4 else ("(not set)" if not _settings["solcast_api_key"] else "****"),
        "solcast_site_id": _settings["solcast_site_id"] or "(not set)",
        "electricitymaps_api_key": ("****" + _settings["electricitymaps_api_key"][-4:]) if len(_settings["electricitymaps_api_key"]) > 4 else ("(not set)" if not _settings["electricitymaps_api_key"] else "****"),
        "electricitymaps_zone": _settings["electricitymaps_zone"],
        "pv_capacity_kw": _settings["pv_capacity_kw"],
        "solcast_configured": bool(_settings["solcast_api_key"] and _settings["solcast_site_id"]),
        "carbon_configured": bool(_settings["electricitymaps_api_key"])
    }

@router.post("/settings")
def update_settings(payload: SettingsPayload):
    """Update API keys. Clears caches so next fetch uses the new keys."""
    global _solcast_cache, _carbon_cache
    if payload.solcast_api_key:
        _settings["solcast_api_key"] = payload.solcast_api_key
    if payload.solcast_site_id:
        _settings["solcast_site_id"] = payload.solcast_site_id
    if payload.electricitymaps_api_key:
        _settings["electricitymaps_api_key"] = payload.electricitymaps_api_key
    if payload.electricitymaps_zone:
        _settings["electricitymaps_zone"] = payload.electricitymaps_zone
    if payload.pv_capacity_kw > 0:
        _settings["pv_capacity_kw"] = payload.pv_capacity_kw
    
    # Invalidate caches so next request fetches fresh data with new keys
    _solcast_cache = {"data": None, "timestamp": 0, "ttl": 1800}
    _carbon_cache = {"data": None, "timestamp": 0, "ttl": 900}
    
    # Persist to disk
    try:
        with open(_SETTINGS_FILE, 'w') as f:
            json.dump(_settings, f)
        print(f"⚙️ Settings saved to {_SETTINGS_FILE}")
    except Exception as e:
        print(f"⚠️ Could not persist settings: {e}")
    
    return {"status": "ok", "message": "Settings updated. Caches cleared.", **get_settings()}

# === Solcast Forecast Cache ===
_solcast_cache = {"data": None, "timestamp": 0, "ttl": 1800}  # 30 min TTL

# === Carbon Intensity Cache ===
_carbon_cache = {"data": None, "timestamp": 0, "ttl": 900}  # 15 min TTL

class MicrogridEMS_MultiObj:
    def __init__(self, pv_forecast, load_forecast, import_price, export_price, current_soc):
        self.pv_gen = np.array(pv_forecast)
        self.load = np.array(load_forecast)
        self.import_price = np.array(import_price)
        self.export_price = np.array(export_price)
        self.horizon = len(pv_forecast)
        # We only search for 3 things now: [Charge, Discharge, Curtailment]
        self.dim = self.horizon * 3
        self.pv_capacity = 10.0
        self.bat_cap = 47.4
        self.soc_min = 0.2 * self.bat_cap
        self.soc_max = 0.9 * self.bat_cap
        self.initial_soc = current_soc
        self.p_bat_max = 12.5
        self.eta_ch = 0.95
        self.eta_dis = 0.95
        self.dt = 1.0
        self.deg_cost_per_kwh = 0.50    # INR per kWh (battery degradation)
        self.peak_demand_charge = 150.0   # INR per kW (monthly peak demand charge)
        self.grid_emission_factor = 0.5
        self.carbon_tax = 2.0             # INR per kg CO2
        
        # State trackers to extract the calculated grid flows
        self._last_P_imp = np.zeros(self.horizon)
        self._last_P_exp = np.zeros(self.horizon)

    def get_bounds(self):
        lb = np.zeros(self.dim)
        ub = np.concatenate([
            np.ones(self.horizon) * self.p_bat_max,
            np.ones(self.horizon) * self.p_bat_max,
            np.ones(self.horizon) * self.pv_capacity
        ])
        return lb, ub

    def fitness_function(self, x):
        H, PENALTY_FACTOR = self.horizon, 1e6
        # The algorithm only decides Battery and Curtailment
        Pch, Pdis, Curt = x[0:H], x[H:2*H], x[2*H:3*H]
        P_imp = np.zeros(H)
        P_exp = np.zeros(H)

        soc = self.initial_soc
        t_eng_cost, t_deg_cost, t_emi_cost, penalty = 0.0, 0.0, 0.0, 0.0

        for t in range(H):
            # Deterministic Grid Calculation: Grid imports or exports exactly what is needed to balance
            net_load = self.load[t] + Pch[t] + Curt[t] - self.pv_gen[t] - Pdis[t]
            if net_load > 0:
                P_imp[t] = net_load
                P_exp[t] = 0.0
            else:
                P_imp[t] = 0.0
                P_exp[t] = -net_load
                
            # Hardware Penalties
            soc += (self.eta_ch * Pch[t] - (Pdis[t] / self.eta_dis)) * self.dt
            if soc < self.soc_min: penalty += PENALTY_FACTOR * (self.soc_min - soc)
            elif soc > self.soc_max: penalty += PENALTY_FACTOR * (soc - self.soc_max)
                
            penalty += 1e4 * (Pch[t] * Pdis[t]) # Don't charge and discharge simultaneously
            
            # Penalize if we are forced to pull/push more than the 50kW grid inverter capacity
            if P_imp[t] > 50: penalty += PENALTY_FACTOR * (P_imp[t] - 50)
            if P_exp[t] > 50: penalty += PENALTY_FACTOR * (P_exp[t] - 50)
            
            # Economics
            t_eng_cost += (self.import_price[t] * P_imp[t]) - (self.export_price[t] * P_exp[t])
            t_deg_cost += self.deg_cost_per_kwh * Pdis[t]
            t_emi_cost += self.grid_emission_factor * P_imp[t] * self.carbon_tax
            
        dem_cost = np.max(P_imp) * self.peak_demand_charge
        
        # Save calculated flows into class state so we can extract them later
        self._last_P_imp = P_imp
        self._last_P_exp = P_exp
        
        return t_eng_cost + t_deg_cost + dem_cost + t_emi_cost + penalty

class IAROA:
    def __init__(self, obj_func, max_iter, lb, ub, n_agents=20):
        self.obj_func = obj_func
        self.max_iter = max_iter
        self.lb, self.ub = lb, ub
        self.n_agents, self.dim = n_agents, len(lb)
        
    def optimize(self):
        X = np.random.uniform(self.lb, self.ub, (self.n_agents, self.dim))
        fitness = np.array([self.obj_func(x) for x in X])
        b_idx = np.argmin(fitness)
        b_sol, b_fit = X[b_idx].copy(), fitness[b_idx]
        
        for t in range(self.max_iter):
            A = 4 * (1 - t / self.max_iter) * np.log(1 / np.random.rand())
            for i in range(self.n_agents):
                r = np.random.rand()
                if A > 1:
                    j = np.random.randint(self.n_agents)
                    X_new = X[j] + r * (X[i] - X[j]) + np.random.randn()
                else:
                    X_new = b_sol + A * np.random.randn() * (b_sol - X[i])
                
                X_new = np.clip(X_new, self.lb, self.ub)
                new_fit = self.obj_func(X_new)
                if new_fit < fitness[i]:
                    X[i], fitness[i] = X_new.copy(), new_fit
                    if new_fit < b_fit: b_sol, b_fit = X_new.copy(), new_fit
        return b_sol, b_fit


# Data Models
class StatePayload(BaseModel):
    current_soc_kwh: float
    pv_forecast_24h: List[float]
    load_forecast_24h: List[float]
    import_price_24h: List[float]
    export_price_24h: List[float]
    eco_weight: float = 0.0
    current_carbon_intensity: float = 600.0

class ActionResponse(BaseModel):
    action_p_import_kw: float
    action_p_export_kw: float
    action_bat_charge_kw: float
    action_bat_discharge_kw: float
    action_load_shedding_active: bool
    action_served_load_kw: float
    predicted_operational_cost: float

# === SOLCAST PV FORECAST PROXY ===
@router.get("/forecast")
def get_pv_forecast(api_key: str = "", site_id: str = "", hours: int = 24):
    """Server-side proxy for Solcast API. Uses stored keys or query params."""
    now = _time.time()
    
    # Use stored keys if query params are empty
    effective_key = api_key or _settings["solcast_api_key"]
    effective_site = site_id or _settings["solcast_site_id"]
    pv_cap = _settings["pv_capacity_kw"]
    
    # Return cache if still valid
    if _solcast_cache["data"] and (now - _solcast_cache["timestamp"]) < _solcast_cache["ttl"]:
        print("☀️ Returning cached Solcast forecast")
        return _solcast_cache["data"]
    
    pv_24h = []
    source = "mock"
    
    if effective_key and effective_site:
        try:
            print(f"☀️ Fetching LIVE Solcast data for site {effective_site}...")
            url = f"https://api.solcast.com.au/rooftop_sites/{effective_site}/forecasts?format=json"
            headers = {"Authorization": f"Bearer {effective_key}"}
            resp = requests.get(url, headers=headers, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            forecasts = data.get("forecasts", [])
            # Solcast returns 30-min intervals, downsample to hourly
            pv_24h = [round(f["pv_estimate"], 2) for f in forecasts[:hours*2:2]]
            while len(pv_24h) < hours:
                pv_24h.append(pv_24h[-1] if pv_24h else 0.0)
            pv_24h = pv_24h[:hours]
            source = "solcast_live"
            print(f"  ✅ Got {len(pv_24h)} hourly forecasts from Solcast")
        except Exception as e:
            print(f"  ⚠️ Solcast API error: {e}. Using fallback.")
            pv_24h = []
    
    # Fallback: mathematical bell curve
    if not pv_24h:
        pv_24h = [round(pv_cap * math.exp(-0.5 * ((h - 12) / 2.5) ** 2), 2) for h in range(hours)]
        source = "mock_bell_curve"
    
    result = {"pv_forecast_24h": pv_24h, "source": source, "cached_until": int(now + _solcast_cache["ttl"])}
    _solcast_cache["data"] = result
    _solcast_cache["timestamp"] = now
    return result

# === CARBON INTENSITY PROXY ===
@router.get("/carbon")
def get_carbon_intensity(api_key: str = "", zone: str = ""):
    """Server-side proxy for ElectricityMaps. Uses stored keys or query params."""
    now = _time.time()
    
    effective_key = api_key or _settings["electricitymaps_api_key"]
    effective_zone = zone or _settings["electricitymaps_zone"] or "IN-WE"
    
    if _carbon_cache["data"] and (now - _carbon_cache["timestamp"]) < _carbon_cache["ttl"]:
        print("🌍 Returning cached carbon intensity")
        return _carbon_cache["data"]
    
    carbon_intensity = 0.0
    source = "mock"
    
    if effective_key:
        try:
            print(f"🌍 Fetching LIVE carbon intensity for zone {effective_zone}...")
            url = f"https://api.electricitymap.org/v3/carbon-intensity/latest?zone={effective_zone}"
            headers = {"auth-token": effective_key}
            resp = requests.get(url, headers=headers, timeout=10)
            resp.raise_for_status()
            data = resp.json()
            carbon_intensity = data.get("carbonIntensity", 0.0)
            source = "electricitymaps_live"
            print(f"  ✅ Carbon intensity: {carbon_intensity} gCO2/kWh")
        except Exception as e:
            print(f"  ⚠️ ElectricityMaps API error: {e}. Using fallback.")
    
    # Fallback: Indian grid average (~700 gCO2/kWh with hourly variation)
    if source == "mock":
        hour = int(_time.strftime("%H"))
        base = 700
        variation = -150 * math.exp(-0.5 * ((hour - 12) / 3.0) ** 2)
        carbon_intensity = round(base + variation, 0)
        source = "mock_indian_grid"
    
    result = {
        "carbon_intensity_gco2_kwh": carbon_intensity,
        "zone": effective_zone,
        "source": source,
        "cached_until": int(now + _carbon_cache["ttl"])
    }
    _carbon_cache["data"] = result
    _carbon_cache["timestamp"] = now
    return result

@router.post("/optimize", response_model=ActionResponse)
def compute_mpc_action(payload: StatePayload):
    print(f"📥 Received Dispatch Request (SOC: {payload.current_soc_kwh:.2f} kWh)")
    
    H = len(payload.pv_forecast_24h)
    pv = np.array(payload.pv_forecast_24h)
    load = np.array(payload.load_forecast_24h)
    imp_price = np.array(payload.import_price_24h)
    exp_price = np.array(payload.export_price_24h)
    
    # === DETERMINISTIC BATTERY DISPATCH HEURISTIC ===
    # This analytically decides battery actions based on price arbitrage
    # instead of relying on the metaheuristic to blindly search 72 dimensions.
    
    BAT_CAP = 47.4
    SOC_MIN, SOC_MAX = 0.2 * BAT_CAP, 0.9 * BAT_CAP
    P_BAT_MAX = 12.5
    ETA_CH, ETA_DIS = 0.95, 0.95
    DEG_COST = 0.50   # INR per kWh discharged (battery degradation)
    
    soc = payload.current_soc_kwh
    eco_weight = payload.eco_weight
    carbon_now = payload.current_carbon_intensity
    
    # Step 1: Find cheapest and most expensive hours
    avg_price = float(np.mean(imp_price))
    current_price = float(imp_price[0])
    min_future_price = float(np.min(imp_price[1:])) if H > 1 else current_price
    max_future_price = float(np.max(imp_price[1:])) if H > 1 else current_price
    
    # Step 2: Pareto-Optimal Eco-Demand Response (Load Shedding)
    flexible_load = load[0] * 0.5
    critical_load = load[0] * 0.5
    load_shedding_active = False
    
    # If eco_weight is > 0.0, we consider shedding to avoid high carbon/price
    if eco_weight > 0.05:
        # Dynamic thresholds based on eco_weight. 
        # eco_weight=1.0 -> carbon_threshold=600, price_threshold=12
        # eco_weight=0.5 -> carbon_threshold=800, price_threshold=16
        carbon_threshold = 1000 - (400 * eco_weight)
        price_threshold = 20 - (8 * eco_weight)
        
        if carbon_now >= carbon_threshold or current_price >= price_threshold:
            load_shedding_active = True
            
    served_load_kw = critical_load if load_shedding_active else load[0]
    
    # Step 3: Calculate net load with served load (positive = deficit, negative = surplus)
    net_load = load - pv
    net_load[0] = served_load_kw - pv[0]
    
    P_ch = 0.0
    P_dis = 0.0
    
    # DISCHARGE: If current price is high (or carbon is high & eco_weight is high) and battery has energy
    # We add a "green premium" to the current price based on eco_weight to encourage eco-discharge
    green_premium = (carbon_now - 500) * 0.02 * eco_weight if carbon_now > 500 else 0
    effective_current_price = current_price + green_premium
    
    if effective_current_price > avg_price and net_load[0] > 0 and soc > SOC_MIN + 2.0:
        savings_per_kwh = effective_current_price - DEG_COST - (1.0 / ETA_DIS - 1.0) * min_future_price
        if savings_per_kwh > 0:
            # How much can we discharge?
            max_dis_soc = (soc - SOC_MIN) * ETA_DIS  # Limited by SOC
            max_dis_need = net_load[0]  # Limited by actual deficit
            P_dis = min(P_BAT_MAX, max_dis_soc, max_dis_need)
            P_dis = max(0.0, P_dis)
    
    # CHARGE: If current price is cheap and battery has room, charge for future expensive hours
    # Condition: current price < average AND future prices are higher
    elif current_price < avg_price * 0.85 and soc < SOC_MAX - 2.0:
        future_savings = max_future_price - current_price - DEG_COST
        if future_savings > 0 and net_load[0] <= 0:
            # We have PV surplus — charge from it (free energy!)
            max_ch_soc = (SOC_MAX - soc) / ETA_CH
            max_ch_pv = abs(net_load[0])  # Use surplus PV
            P_ch = min(P_BAT_MAX, max_ch_soc, max_ch_pv)
            P_ch = max(0.0, P_ch)
        elif future_savings > 10 and net_load[0] > 0:
            # Even with grid deficit, charge if the future price spread is large enough
            max_ch_soc = (SOC_MAX - soc) / ETA_CH
            P_ch = min(P_BAT_MAX * 0.5, max_ch_soc)  # Charge at half-rate from grid
            P_ch = max(0.0, P_ch)
    
    # Step 3: Deterministic grid balancing with battery action
    final_net = net_load[0] + P_ch - P_dis
    P_imp = max(0.0, final_net)
    P_exp = max(0.0, -final_net)
    
    # Step 4: Calculate projected 24h cost with this strategy
    total_cost = 0.0
    sim_soc = soc + (ETA_CH * P_ch - P_dis / ETA_DIS)
    total_cost += imp_price[0] * P_imp - exp_price[0] * P_exp + DEG_COST * P_dis
    
    for t in range(1, H):
        t_net = net_load[t]
        t_imp = max(0.0, t_net)
        t_exp = max(0.0, -t_net)
        total_cost += imp_price[t] * t_imp - exp_price[t] * t_exp
    
    # Add peak demand charge (INR)
    total_cost += max(P_imp, float(np.max(np.maximum(net_load[1:], 0)))) * 150.0
    # Add carbon cost (INR) - Scaled up if eco_weight is high to reflect Pareto preference
    base_carbon_tax = 2.0
    effective_carbon_tax = base_carbon_tax + (eco_weight * 5.0)  # Up to ₹7/kg if max green
    total_cost += (carbon_now / 1000.0) * P_imp * effective_carbon_tax
    
    action = ActionResponse(
        action_p_import_kw=round(P_imp, 2),
        action_p_export_kw=round(P_exp, 2),
        action_bat_charge_kw=round(P_ch, 2),
        action_bat_discharge_kw=round(P_dis, 2),
        action_load_shedding_active=load_shedding_active,
        action_served_load_kw=round(served_load_kw, 2),
        predicted_operational_cost=round(total_cost, 2)
    )
    
    print(f"📤 Dispatched -> Imp: {action.action_p_import_kw:.2f} | Exp: {action.action_p_export_kw:.2f} | Pch: {action.action_bat_charge_kw:.2f} | Pdis: {action.action_bat_discharge_kw:.2f}")
    return action

