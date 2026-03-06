"""
Enhanced Decentralized 9-City Microgrid Optimization API
Features:
  1. Weather Module - historical + forecast, NumPy arrays
  2. Multi-City Simulation - 9 cities, 3 clusters
  3. Hierarchical MPC - Local / Regional / Global
  4. Battery Degradation - SOH tracking + degradation cost
  5. Optimization - NumPy vectorized IAROA
  6. UI Features - formula explanation, parameter input
  7. Performance Metrics - runtime + computational cost
"""

from fastapi import FastAPI, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Dict, Optional, Any, Tuple
import numpy as np
import time as _time
import math
from datetime import datetime, timedelta

# ── Optional weather SDK (graceful fallback) ───────────────────────────────
try:
    import openmeteo_requests
    import requests_cache
    from retry_requests import retry as retry_requests
    _WEATHER_SDK = True
    _cache_session = requests_cache.CachedSession("/tmp/.cache", expire_after=3600)
    _retry_session = retry_requests(_cache_session, retries=3, backoff_factor=0.2)
    _openmeteo = openmeteo_requests.Client(session=_retry_session)
except Exception:
    _WEATHER_SDK = False

app = FastAPI(title="Enhanced 9-City Hierarchical Microgrid API v2")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ══════════════════════════════════════════════════════════════════════════════
# GLOBAL OPTIMIZATION SETTINGS
# ══════════════════════════════════════════════════════════════════════════════
OPT_SETTINGS: Dict[str, float] = {
    "deg_cost_per_kwh": 0.50,
    "peak_demand_charge": 150.0,
    "grid_emission_factor": 0.50,
    "carbon_tax": 2.0,
    "battery_eta_ch": 0.95,
    "battery_eta_dis": 0.95,
    "soh_decay_per_cycle": 0.0001,   # SOH drops this fraction per full cycle
    "p2p_price_inr_per_kwh": 5.0,
    "demand_response_discount": 0.15,
}

class OptSettingsPayload(BaseModel):
    deg_cost_per_kwh: float = 0.50
    peak_demand_charge: float = 150.0
    grid_emission_factor: float = 0.50
    carbon_tax: float = 2.0
    battery_eta_ch: float = 0.95
    battery_eta_dis: float = 0.95
    soh_decay_per_cycle: float = 0.0001
    p2p_price_inr_per_kwh: float = 5.0
    demand_response_discount: float = 0.15

@app.get("/optimization-settings")
def get_opt_settings() -> Dict[str, float]:
    return OPT_SETTINGS

@app.post("/optimization-settings")
def update_opt_settings(p: OptSettingsPayload) -> Dict[str, Any]:
    OPT_SETTINGS.update(p.dict())
    return {"status": "ok", "settings": OPT_SETTINGS}

@app.get("/settings")
def get_settings_legacy():
    # Backwards compatibility for App.jsx
    return {
        "solcast_configured": False,
        "carbon_configured": False,
        "electricitymaps_zone": "IN-WE",
        "pv_capacity_kw": 10.0,
        "message": "Legacy settings endpoint"
    }

@app.post("/settings")
def save_settings_legacy(data: Dict[str, Any]):
    # Backwards compatibility for App.jsx
    return {
        "solcast_configured": True if data.get("solcast_api_key") else False,
        "carbon_configured": True if data.get("electricitymaps_api_key") else False,
        "electricitymaps_zone": data.get("electricitymaps_zone", "IN-WE"),
        "pv_capacity_kw": data.get("pv_capacity_kw", 10.0),
        "message": "Settings saved (legacy)"
    }

@app.get("/calculation-logic")
def get_calculation_logic() -> Dict[str, Any]:
    ef = OPT_SETTINGS["grid_emission_factor"]
    ct = OPT_SETTINGS["carbon_tax"]
    deg = OPT_SETTINGS["deg_cost_per_kwh"]
    pdc = OPT_SETTINGS["peak_demand_charge"]
    soh = OPT_SETTINGS["soh_decay_per_cycle"]
    return {
        "cost_calculation": {
            "formula": "Total Cost = Energy_Cost + Degradation_Cost + Demand_Charge + Carbon_Cost",
            "energy_cost": "(P_imp × ImpPrice) − (P_exp × ExpPrice)",
            "degradation_cost": f"P_dis × SOH_factor × ₹{deg}/kWh",
            "demand_charge": f"max(P_imp) × ₹{pdc}/kW",
            "carbon_cost": f"P_imp × {ef} kg_CO₂/kWh × ₹{ct}/kg",
        },
        "carbon_calculation": {
            "formula": "Carbon_kg = P_imp × Grid_Emission_Factor",
            "emission_factor": f"{ef} kg CO₂/kWh",
            "unit": "kg CO₂",
        },
        "battery_degradation": {
            "formula": "SOH(t+1) = SOH(t) − soh_decay_per_cycle × (|P_ch| + |P_dis|) / (2 × bat_cap)",
            "soh_decay_per_cycle": soh,
            "degradation_cost_formula": "deg_cost = P_dis × deg_cost_per_kwh × (2 − SOH)",
        },
        "hierarchical_mpc": {
            "local_mpc": "Per-building: EV charging + HVAC + battery dispatch (single step)",
            "regional_mpc": "Per-cluster: balance net load across 3 cities, enable P2P within cluster",
            "global_mpc": "Across all 3 clusters: grid balancing, cross-cluster P2P arbitrage",
        },
        "demand_response": {
            "formula": "Adj_Load = Base_Load × (1 − DR_Discount) during [18:00-22:00]",
            "discount": f"{OPT_SETTINGS.get('demand_response_discount', 0.15)*100}%",
        },
        "parameters": OPT_SETTINGS,
    }

# ══════════════════════════════════════════════════════════════════════════════
# 9-CITY DEFINITIONS (3 CLUSTERS)
# ══════════════════════════════════════════════════════════════════════════════
CITIES: Dict[str, Any] = {
    # ── Cluster NORTH ─────────────────────────────────────────────
    "delhi":    {"name":"Delhi",    "cluster":"north","lat":28.61,"lon":77.21,
                 "pv_cap":150,"wind_cap":80,"thermal_cap":100,"bat_cap":500,
                 "houses":120,"buildings":8,"init_soc":0.55,"peak_load":25,
                 "climate":"hot_arid","grid_zone":"IN-NO",
                 "import_price":[4,4,4,4,5,5,7,8,9,10,11,11,10,9,8,7,9,11,13,11,8,6,5,4],
                 "load_profile":[3,2,2,3,5,7,10,15,18,21,23,25,24,22,19,16,12,10,8,6,5,4,3,3]},
    "jaipur":   {"name":"Jaipur",   "cluster":"north","lat":26.91,"lon":75.79,
                 "pv_cap":200,"wind_cap":50,"thermal_cap":40,"bat_cap":480,
                 "houses":90,"buildings":4,"init_soc":0.52,"peak_load":20,
                 "climate":"hot_desert","grid_zone":"IN-NO",
                 "import_price":[4,4,4,4,5,5,6,7,8,9,10,10,9,8,7,6,8,10,12,10,7,6,5,4],
                 "load_profile":[2,2,2,3,4,6,8,11,14,17,19,20,19,17,15,13,10,8,6,5,4,3,2,2]},
    "lucknow":  {"name":"Lucknow",  "cluster":"north","lat":26.85,"lon":80.95,
                 "pv_cap":120,"wind_cap":60,"thermal_cap":80,"bat_cap":420,
                 "houses":100,"buildings":6,"init_soc":0.50,"peak_load":22,
                 "climate":"humid_subtropical","grid_zone":"IN-NO",
                 "import_price":[4,3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,8,10,12,10,7,5,4,4],
                 "load_profile":[2,2,2,2,4,5,8,12,15,17,19,20,19,17,14,12,9,7,6,5,4,3,2,2]},
    # ── Cluster WEST ──────────────────────────────────────────────
    "mumbai":   {"name":"Mumbai",   "cluster":"west","lat":19.08,"lon":72.88,
                 "pv_cap":120,"wind_cap":150,"thermal_cap":80,"bat_cap":450,
                 "houses":150,"buildings":12,"init_soc":0.50,"peak_load":22,
                 "climate":"tropical","grid_zone":"IN-WE",
                 "import_price":[5,5,4,4,5,6,7,8,9,10,10,10,9,8,7,6,8,10,12,10,7,6,5,5],
                 "load_profile":[4,3,3,3,5,7,9,13,16,19,21,22,21,19,17,15,11,9,7,6,5,4,4,4]},
    "pune":     {"name":"Pune",     "cluster":"west","lat":18.52,"lon":73.86,
                 "pv_cap":140,"wind_cap":80,"thermal_cap":60,"bat_cap":400,
                 "houses":110,"buildings":8,"init_soc":0.48,"peak_load":18,
                 "climate":"tropical","grid_zone":"IN-WE",
                 "import_price":[4,4,4,4,5,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
                 "load_profile":[2,2,2,3,4,6,8,11,14,17,18,19,18,17,15,13,10,8,6,5,4,3,2,2]},
    "ahmedabad":{"name":"Ahmedabad","cluster":"west","lat":23.02,"lon":72.57,
                 "pv_cap":180,"wind_cap":70,"thermal_cap":50,"bat_cap":460,
                 "houses":95,"buildings":5,"init_soc":0.53,"peak_load":19,
                 "climate":"hot_arid","grid_zone":"IN-WE",
                 "import_price":[4,4,3,3,4,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
                 "load_profile":[2,2,2,2,4,5,7,10,13,16,18,19,18,16,14,12,9,7,6,5,4,3,2,2]},
    # ── Cluster SOUTH ─────────────────────────────────────────────
    "chennai":  {"name":"Chennai",  "cluster":"south","lat":13.08,"lon":80.27,
                 "pv_cap":180,"wind_cap":120,"thermal_cap":60,"bat_cap":550,
                 "houses":130,"buildings":10,"init_soc":0.60,"peak_load":20,
                 "climate":"tropical_coastal","grid_zone":"IN-SO",
                 "import_price":[4,4,3,3,4,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
                 "load_profile":[3,3,2,3,4,6,8,12,15,18,20,20,19,18,16,14,10,8,7,5,4,3,3,3]},
    "kolkata":  {"name":"Kolkata",  "cluster":"south","lat":22.57,"lon":88.36,
                 "pv_cap":110,"wind_cap":100,"thermal_cap":80,"bat_cap":400,
                 "houses":110,"buildings":7,"init_soc":0.45,"peak_load":18,
                 "climate":"humid_subtropical","grid_zone":"IN-EA",
                 "import_price":[4,3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
                 "load_profile":[2,2,2,2,4,5,7,10,13,16,18,18,17,16,14,12,9,7,6,5,4,3,2,2]},
    "bangalore":{"name":"Bangalore","cluster":"south","lat":12.97,"lon":77.59,
                 "pv_cap":160,"wind_cap":90,"thermal_cap":50,"bat_cap":480,
                 "houses":140,"buildings":11,"init_soc":0.58,"peak_load":21,
                 "climate":"tropical_highland","grid_zone":"IN-SO",
                 "import_price":[4,4,3,3,4,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
                 "load_profile":[3,2,2,3,4,6,8,12,15,18,20,21,20,18,16,14,10,8,7,5,4,3,3,3]},
}

CLUSTERS: Dict[str, List[str]] = {
    "north": ["delhi", "jaipur", "lucknow"],
    "west":  ["mumbai", "pune", "ahmedabad"],
    "south": ["chennai", "kolkata", "bangalore"],
}

# ══════════════════════════════════════════════════════════════════════════════
# CITY STATE (SOC + SOH)
# ══════════════════════════════════════════════════════════════════════════════
city_states: Dict[str, Dict[str, float]] = {}

def _init_states() -> None:
    global city_states
    city_states = {}
    for cid, cfg in CITIES.items():
        soc = cfg["init_soc"] * cfg["bat_cap"]
        city_states[cid] = {
            "soc_kwh": float(soc),
            "soh": 1.0,          # State of Health 0→1
            "cycles": 0.0,
            "last_pv": 0.0, "last_wind": 0.0, "last_thermal": 0.0,
            "last_load": 0.0, "last_import": 0.0, "last_export": 0.0,
            "last_charge": 0.0, "last_discharge": 0.0,
            "cumulative_cost": 0.0, "cumulative_carbon": 0.0,
        }

_init_states()

# ══════════════════════════════════════════════════════════════════════════════
# WEATHER MODULE  (historical + forecast, NumPy output)
# ══════════════════════════════════════════════════════════════════════════════
WEATHER_CACHE: Dict[str, Any] = {}

def _simulated_weather(lat: float, n_hours: int, base_date: str) -> Dict[str, np.ndarray]:
    """Deterministic simulated weather using lat for climate bias."""
    rng = np.random.default_rng(seed=abs(int(lat * 100)))
    t_base = 22 + (lat - 13) * 0.3
    h = np.arange(n_hours)
    temps = t_base + 6 * np.sin((h - 6) * np.pi / 12) + rng.normal(0, 0.5, n_hours)
    winds = np.abs(12 * np.sin(h * np.pi / 12) + 4) + rng.normal(0, 1, n_hours)
    solar_raw = np.maximum(0, np.sin((h % 24 - 6) * np.pi / 12))
    solar = 900 * solar_raw + rng.normal(0, 20, n_hours)
    solar = np.maximum(0, solar)
    humidity = 55 + 15 * np.cos(h * np.pi / 18) + rng.normal(0, 2, n_hours)
    cloud_cover = 20 + 10 * np.sin(h * np.pi / 24) + rng.uniform(0, 15, n_hours)
    precipitation = np.maximum(0, rng.normal(0.1, 0.3, n_hours))
    return {
        "temperature_2m": temps.astype(np.float32),
        "wind_speed_10m": np.clip(winds, 0, 30).astype(np.float32),
        "shortwave_radiation": solar.astype(np.float32),
        "relative_humidity_2m": np.clip(humidity, 20, 95).astype(np.float32),
        "cloud_cover": np.clip(cloud_cover, 0, 100).astype(np.float32),
        "precipitation": precipitation.astype(np.float32),
    }

def _fetch_openmeteo(lat: float, lon: float, start_date: str, end_date: str,
                     mode: str = "archive") -> Optional[Dict[str, np.ndarray]]:
    if not _WEATHER_SDK:
        return None
    try:
        url = ("https://archive-api.open-meteo.com/v1/archive"
               if mode == "archive"
               else "https://api.open-meteo.com/v1/forecast")
        hvars = ["temperature_2m","relative_humidity_2m","wind_speed_10m",
                 "shortwave_radiation","cloud_cover","precipitation"]
        params: Dict[str, Any] = {
            "latitude": lat, "longitude": lon,
            "hourly": hvars, "timezone": "Asia/Kolkata"
        }
        if mode == "archive":
            params["start_date"] = start_date
            params["end_date"] = end_date
        responses = _openmeteo.weather_api(url, params=params)
        hourly = responses[0].Hourly()
        result: Dict[str, np.ndarray] = {}
        for i, v in enumerate(hvars):
            result[v] = hourly.Variables(i).ValuesAsNumpy().astype(np.float32)
        return result
    except Exception as e:
        print(f"[Weather API] {e}")
        return None

def get_weather(city_id: str, start_date: str, end_date: str) -> Dict[str, Any]:
    """Returns both historical (archive) and forecast arrays as NumPy."""
    cache_key = f"{city_id}_{start_date}_{end_date}"
    now_ts = _time.time()
    if cache_key in WEATHER_CACHE and now_ts - WEATHER_CACHE[cache_key]["ts"] < 3600:
        return WEATHER_CACHE[cache_key]["data"]

    cfg = CITIES[city_id]
    lat, lon = cfg["lat"], cfg["lon"]
    start_dt = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt = datetime.strptime(end_date, "%Y-%m-%d")
    n_hours = int((end_dt - start_dt).total_seconds() / 3600) + 24

    # Historical
    hist = _fetch_openmeteo(lat, lon, start_date, end_date, mode="archive")
    if hist is None:
        hist = _simulated_weather(lat, n_hours, start_date)
    # Trim / pad to n_hours
    for k in hist:
        arr = hist[k]
        if len(arr) < n_hours:
            pad = np.full(n_hours - len(arr), arr[-1] if len(arr) > 0 else 0, dtype=np.float32)
            hist[k] = np.concatenate([arr, pad])
        else:
            hist[k] = arr[:n_hours]

    # Forecast (next 24h)
    today_str = datetime.now().strftime("%Y-%m-%d")
    tomorrow_str = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
    fcast = _fetch_openmeteo(lat, lon, today_str, tomorrow_str, mode="forecast")
    if fcast is None:
        fcast = _simulated_weather(lat, 48, today_str)
    for k in fcast:
        arr = fcast[k]
        if len(arr) < 48:
            pad = np.full(48 - len(arr), arr[-1] if len(arr) > 0 else 0, dtype=np.float32)
            fcast[k] = np.concatenate([arr, pad])
        else:
            fcast[k] = arr[:48]

    result: Dict[str, Any] = {
        "historical": hist,
        "forecast": fcast,
        "n_hours": n_hours,
        "start_date": start_date,
        "end_date": end_date,
        # convenience shortcuts
        "temps": hist["temperature_2m"],
        "winds": hist["wind_speed_10m"],
        "solar": hist["shortwave_radiation"],
        "humidity": hist["relative_humidity_2m"],
        "cloud_cover": hist["cloud_cover"],
        "precipitation": hist["precipitation"],
        # forecast shortcuts
        "fcast_temps": fcast["temperature_2m"],
        "fcast_winds": fcast["wind_speed_10m"],
        "fcast_solar": fcast["shortwave_radiation"],
    }
    WEATHER_CACHE[cache_key] = {"ts": now_ts, "data": result}
    return result

# ══════════════════════════════════════════════════════════════════════════════
# GENERATION + LOAD FORECASTS (fully vectorised NumPy)
# ══════════════════════════════════════════════════════════════════════════════
def gen_forecasts(city_id: str, start_hour: int, hours: int,
                  wx: Dict[str, Any]) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    cfg = CITIES[city_id]
    idx = (np.arange(hours) + start_hour) % wx["n_hours"]
    solar = wx["solar"][idx]
    wind_spd = wx["winds"][idx]

    pv = np.clip(solar / 1000.0 * cfg["pv_cap"], 0, cfg["pv_cap"]).astype(np.float32)
    w_factor = np.clip((wind_spd / 15.0) ** 3, 0, 1)
    wind = (w_factor * cfg["wind_cap"]).astype(np.float32)
    thermal = np.full(hours, cfg["thermal_cap"] * 0.85, dtype=np.float32)
    return pv, wind, thermal

def load_forecast(city_id: str, start_hour: int, hours: int,
                  wx: Dict[str, Any]) -> np.ndarray:
    cfg = CITIES[city_id]
    idx = (np.arange(hours) + start_hour) % wx["n_hours"]
    temps = wx["temps"][idx]
    profile = np.array(cfg["load_profile"], dtype=np.float32)

    hvac = np.ones(hours, dtype=np.float32)
    hvac += np.where(temps > 30, (temps - 30) * 0.05, 0)
    hvac += np.where(temps < 15, (15 - temps) * 0.04, 0)
    clock_h = (np.arange(hours) + start_hour) % 24
    daily_mod = profile[clock_h] / 10.0
    load = (cfg["houses"] * 0.5 + cfg["buildings"] * 10.0) * hvac * daily_mod
    
    # Apply Demand Response discount during peak hours (18:00 - 22:00)
    dr_discount = float(OPT_SETTINGS.get("demand_response_discount", 0.15))
    peak_mask = (clock_h >= 18) & (clock_h <= 22)
    load[peak_mask] *= (1.0 - dr_discount)
    
    return load.astype(np.float32)

def city_pricing(city_id: str, start_hour: int, hours: int) -> Tuple[np.ndarray, np.ndarray]:
    base = np.array(CITIES[city_id]["import_price"], dtype=np.float32)
    if hours != 24:
        base = np.interp(np.linspace(0, 24, hours), np.arange(24), base).astype(np.float32)
    roll = int(start_hour) % 24
    imp = np.roll(base, -roll)
    return imp, (imp * 0.5).astype(np.float32)

# ══════════════════════════════════════════════════════════════════════════════
# BATTERY DEGRADATION MODEL
# ══════════════════════════════════════════════════════════════════════════════
def update_soh(soh: float, p_ch: float, p_dis: float, bat_cap: float) -> Tuple[float, float]:
    """Returns (new_soh, throughput_fraction)."""
    decay = float(OPT_SETTINGS["soh_decay_per_cycle"])
    throughput = (abs(p_ch) + abs(p_dis)) / (2.0 * max(bat_cap, 1))
    new_soh = max(0.5, soh - decay * throughput)
    return new_soh, throughput

def degradation_cost(p_dis: float, soh: float) -> float:
    deg_rate = float(OPT_SETTINGS["deg_cost_per_kwh"])
    # Higher cost when SOH is low (battery near end of life)
    return float(p_dis * deg_rate * (2.0 - soh))

# ══════════════════════════════════════════════════════════════════════════════
# IAROA OPTIMIZER (vectorised batch evaluation)
# ══════════════════════════════════════════════════════════════════════════════
class MicrogridEMS:
    def __init__(self, pv_fc: np.ndarray, load_fc: np.ndarray,
                 imp_p: np.ndarray, exp_p: np.ndarray,
                 soc: float, bat_cap: float, pv_cap: float,
                 soh: float = 1.0) -> None:
        self.pv = pv_fc; self.load = load_fc
        self.imp_p = imp_p; self.exp_p = exp_p
        self.H = len(pv_fc)
        self.bat_cap = float(bat_cap)
        self.soc_min = 0.2 * bat_cap; self.soc_max = 0.9 * bat_cap
        self.p_bat_max = bat_cap * 0.25
        self.pv_cap = float(pv_cap)
        self.initial_soc = float(soc)
        self.soh = float(soh)
        self.eta_ch = OPT_SETTINGS["battery_eta_ch"]
        self.eta_dis = OPT_SETTINGS["battery_eta_dis"]
        self.deg_base = OPT_SETTINGS["deg_cost_per_kwh"]
        self.pdc = OPT_SETTINGS["peak_demand_charge"]
        self.emi = OPT_SETTINGS["grid_emission_factor"]
        self.ctx = OPT_SETTINGS["carbon_tax"]
        self.dim = self.H * 3

    def bounds(self) -> Tuple[np.ndarray, np.ndarray]:
        lb = np.zeros(self.dim)
        ub = np.concatenate([np.ones(self.H) * self.p_bat_max,
                              np.ones(self.H) * self.p_bat_max,
                              np.ones(self.H) * self.pv_cap])
        return lb, ub

    def fitness(self, x: np.ndarray) -> Any:
        is1d = x.ndim == 1
        xb = x.reshape(1, -1) if is1d else x
        H = self.H; PF = 1e6
        Pch  = xb[:, :H];       Pdis = xb[:, H:2*H];   Curt = xb[:, 2*H:]
        load = self.load.reshape(1, H); pv = self.pv.reshape(1, H)
        net  = load + Pch + Curt - pv - Pdis
        Pimp = np.maximum(0, net);  Pexp = np.maximum(0, -net)
        soc_chg = (self.eta_ch * Pch - Pdis / self.eta_dis)
        soc_t   = self.initial_soc + np.cumsum(soc_chg, axis=1)
        pen = (np.sum(np.maximum(0, self.soc_min - soc_t) * PF, axis=1) +
               np.sum(np.maximum(0, soc_t - self.soc_max) * PF, axis=1) +
               np.sum(1e4 * Pch * Pdis, axis=1) +
               np.sum(np.maximum(0, Pimp - 60) * PF, axis=1))
        imp_p = self.imp_p.reshape(1, H); exp_p = self.exp_p.reshape(1, H)
        deg_factor = 2.0 - self.soh
        t_eng  = np.sum(imp_p * Pimp - exp_p * Pexp, axis=1)
        t_deg  = np.sum(self.deg_base * deg_factor * Pdis, axis=1)
        t_emi  = np.sum(self.emi * Pimp * self.ctx, axis=1)
        t_dem  = np.max(Pimp, axis=1) * self.pdc
        fit = t_eng + t_deg + t_emi + t_dem + pen
        return float(fit[0]) if is1d else fit

class IAROA:
    def __init__(self, ems: MicrogridEMS, max_iter: int = 30, n_agents: int = 12) -> None:
        self.ems = ems; self.max_iter = max_iter; self.n_agents = n_agents
        self.lb, self.ub = ems.bounds()
        self.dim = len(self.lb)
        self.runtime_ms = 0.0

    def run(self) -> Tuple[np.ndarray, float, List[float]]:
        t0 = _time.perf_counter()
        X = np.random.uniform(self.lb, self.ub, (self.n_agents, self.dim))
        fit = self.ems.fitness(X)
        bi = int(np.argmin(fit))
        bsol = X[bi].copy(); bfit = float(fit[bi])
        conv: List[float] = [bfit]
        for t in range(self.max_iter):
            A = 4.0 * (1 - t / self.max_iter) * math.log(1 / max(float(np.random.rand()), 1e-9))
            r = np.random.rand(self.n_agents, 1)
            if A > 1:
                j = np.random.randint(0, self.n_agents, self.n_agents)
                Xn = X[j] + r * (X - X[j]) + np.random.randn(self.n_agents, self.dim) * 0.5
            else:
                Xn = bsol + A * np.random.randn(self.n_agents, self.dim) * (bsol - X)
            Xn = np.clip(Xn, self.lb, self.ub)
            fn = self.ems.fitness(Xn)
            mask = fn < fit
            X[mask] = Xn[mask]; fit[mask] = fn[mask]
            ci = int(np.argmin(fit))
            if fit[ci] < bfit:
                bsol = X[ci].copy(); bfit = float(fit[ci])
            conv.append(bfit)
        self.runtime_ms = (_time.perf_counter() - t0) * 1000
        return bsol, bfit, conv

# ══════════════════════════════════════════════════════════════════════════════
# HIERARCHICAL MPC (Local → Regional → Global)
# ══════════════════════════════════════════════════════════════════════════════
def local_mpc(pv: float, load: float, soc: float, soh: float,
              imp_price: float, exp_price: float, avg_price: float,
              bat_cap: float) -> Tuple[float, float, float, float]:
    """Per-city single-step MPC dispatch."""
    SOC_MIN = 0.2 * bat_cap; SOC_MAX = 0.9 * bat_cap
    P_BAT_MAX = bat_cap * 0.25
    eta_ch = OPT_SETTINGS["battery_eta_ch"]; eta_dis = OPT_SETTINGS["battery_eta_dis"]
    deg = OPT_SETTINGS["deg_cost_per_kwh"] * (2.0 - soh)
    net_load = load - pv
    Pch = Pdis = 0.0
    if imp_price > avg_price and net_load > 0 and soc > SOC_MIN + 2:
        if imp_price - deg > 0:
            Pdis = min(P_BAT_MAX, (soc - SOC_MIN) * eta_dis, net_load)
    elif imp_price < avg_price * 0.85 and soc < SOC_MAX - 2:
        if net_load <= 0:
            Pch = min(P_BAT_MAX, (SOC_MAX - soc) / eta_ch, abs(net_load))
    final_net = net_load + Pch - Pdis
    return max(0.0, Pch), max(0.0, Pdis), max(0.0, final_net), max(0.0, -final_net)

def regional_mpc(cluster_id: str, city_results: Dict[str, Dict[str, float]]) -> Dict[str, Any]:
    """Cluster-level coordination: balance net loads, enable intra-cluster P2P."""
    members = CLUSTERS[cluster_id]
    cluster_net = sum(city_results[c]["net_kw"] for c in members if c in city_results)
    trades: List[Dict[str, Any]] = []
    surplus = {c: city_results[c]["surplus"] for c in members
               if c in city_results and city_results[c]["surplus"] > 0.5}
    deficit = {c: city_results[c]["deficit"] for c in members
               if c in city_results and city_results[c]["deficit"] > 0.5}
    sur_copy = dict(surplus); def_copy = dict(deficit)
    for dc in sorted(def_copy, key=lambda x: -def_copy[x]):
        rem = def_copy[dc]
        for sc in sorted(sur_copy, key=lambda x: -sur_copy[x]):
            if rem <= 0.1: break
            avail = sur_copy.get(sc, 0)
            if avail <= 0.1: continue
            traded = min(rem, avail)
            trades.append({"from": sc, "to": dc, "amount_kw": round(traded, 2),
                            "price_inr": round(traded * OPT_SETTINGS["p2p_price_inr_per_kwh"], 2),
                            "scope": "regional"})
            sur_copy[sc] -= traded; rem -= traded
    return {"cluster": cluster_id, "cluster_net_kw": round(cluster_net, 2), "intra_trades": trades}

def global_mpc(cluster_summaries: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """Global grid balancing: cross-cluster P2P arbitrage."""
    net = {c: s["cluster_net_kw"] for c, s in cluster_summaries.items()}
    total_net = sum(net.values())
    grid_import = max(0, -total_net)
    grid_export = max(0, total_net)
    cross_trades: List[Dict[str, Any]] = []
    sur_c = {c: v for c, v in net.items() if v > 0.5}
    def_c = {c: -v for c, v in net.items() if v < -0.5}
    sc_copy = dict(sur_c); dc_copy = dict(def_c)
    for dc in sorted(dc_copy, key=lambda x: -dc_copy[x]):
        rem = dc_copy[dc]
        for sc in sorted(sc_copy, key=lambda x: -sc_copy[x]):
            if rem <= 0.1: break
            avail = sc_copy.get(sc, 0)
            if avail <= 0.1: continue
            traded = min(rem, avail)
            price = OPT_SETTINGS["p2p_price_inr_per_kwh"] * 1.1  # slight premium cross-cluster
            cross_trades.append({"from": sc, "to": dc, "amount_kw": round(traded, 2),
                                  "price_inr": round(traded * price, 2), "scope": "global"})
            sc_copy[sc] -= traded; rem -= traded
    return {
        "total_net_kw": round(total_net, 2),
        "grid_import_kw": round(grid_import, 2),
        "grid_export_kw": round(grid_export, 2),
        "cross_cluster_trades": cross_trades,
        "balance_achieved": abs(total_net) < 5.0,
    }

# ══════════════════════════════════════════════════════════════════════════════
# HELPERS
# ══════════════════════════════════════════════════════════════════════════════
def _cost_carbon(pimp: float, pexp: float, pdis: float,
                 imp_p: float, exp_p: float, soh: float) -> Tuple[float, float]:
    deg = degradation_cost(pdis, soh)
    cost = (imp_p * pimp - exp_p * pexp + deg
            + OPT_SETTINGS["grid_emission_factor"] * pimp * OPT_SETTINGS["carbon_tax"])
    carbon = OPT_SETTINGS["grid_emission_factor"] * pimp
    return float(cost), float(carbon)

def _default_dates() -> Tuple[str, str]:
    sd = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    ed = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
    return sd, ed

# ══════════════════════════════════════════════════════════════════════════════
# API ENDPOINTS
# ══════════════════════════════════════════════════════════════════════════════

@app.get("/cities")
def get_cities(start_date: Optional[str] = Query(None),
               end_date: Optional[str] = Query(None)) -> Dict[str, Any]:
    sd, ed = (start_date, end_date) if start_date and end_date else _default_dates()
    ch = datetime.now().hour
    out = []
    for cid, cfg in CITIES.items():
        wx = get_weather(cid, sd, ed)
        pv, wind, therm = gen_forecasts(cid, ch, 1, wx)
        ld = load_forecast(cid, ch, 1, wx)
        state = city_states[cid]
        bat_cap = cfg["bat_cap"]
        soc = state["soc_kwh"]
        soh = state["soh"]
        gen = float(pv[0] + wind[0] + therm[0])
        load = float(ld[0])
        out.append({
            "id": cid, "name": cfg["name"], "cluster": cfg["cluster"],
            "lat": cfg["lat"], "lon": cfg["lon"],
            "pv_cap": cfg["pv_cap"], "wind_cap": cfg["wind_cap"],
            "thermal_cap": cfg["thermal_cap"], "bat_cap": bat_cap,
            "pv_now": round(float(pv[0]), 2), "wind_now": round(float(wind[0]), 2),
            "thermal_now": round(float(therm[0]), 2),
            "gen_total": round(gen, 2), "load_now": round(load, 2),
            "net_kw": round(gen - load, 2),
            "surplus": float(round(max(0.0, gen - load), 2)),
            "deficit": float(round(max(0.0, load - gen), 2)),
            "temp_c": round(float(wx["temps"][ch % len(wx["temps"])]), 1),
            "wind_mps": round(float(wx["winds"][ch % len(wx["winds"])]), 1),
            "soc_kwh": round(soc, 2), "soc_pct": round(soc / bat_cap * 100, 1),
        })
    return {
        "cities": out,
        "clusters": {cl: {"members": m} for cl, m in CLUSTERS.items()},
        "timestamp": _time.strftime("%Y-%m-%d %H:%M:%S"),
    }

@app.get("/weather/{city_id}")
def get_city_weather(city_id: str,
                     start_date: Optional[str] = Query(None),
                     end_date: Optional[str] = Query(None)) -> Dict[str, Any]:
    if city_id not in CITIES:
        return {"error": "Unknown city"}
    sd, ed = (start_date, end_date) if start_date and end_date else _default_dates()
    wx = get_weather(city_id, sd, ed)
    n = min(48, wx["n_hours"])
    return {
        "city": CITIES[city_id]["name"], "start_date": sd, "end_date": ed,
        "historical": {
            "temperature_2m":       wx["temps"][:n].tolist(),
            "wind_speed_10m":       wx["winds"][:n].tolist(),
            "shortwave_radiation":  wx["solar"][:n].tolist(),
            "relative_humidity_2m": wx["humidity"][:n].tolist(),
            "cloud_cover":          wx["cloud_cover"][:n].tolist(),
            "precipitation":        wx["precipitation"][:n].tolist(),
        },
        "forecast": {
            "temperature_2m":      wx["fcast_temps"][:48].tolist(),
            "wind_speed_10m":      wx["fcast_winds"][:48].tolist(),
            "shortwave_radiation": wx["fcast_solar"][:48].tolist(),
        },
    }

@app.get("/forecast")
def get_forecast_legacy():
    # Backwards compatibility for App.jsx - return Delhi as default
    sd, ed = _default_dates()
    wx = get_weather("delhi", sd, ed)
    pv, _, _ = gen_forecasts("delhi", datetime.now().hour, 24, wx)
    return {
        "pv_forecast_24h": pv.tolist(),
        "source": "simulated_legacy"
    }

@app.get("/carbon")
def get_carbon_legacy():
    # Backwards compatibility for App.jsx
    return {
        "carbon_intensity_gco2_kwh": OPT_SETTINGS["grid_emission_factor"] * 1000,
        "source": "simulated_legacy",
        "zone": "IN-WE"
    }

@app.post("/optimize")
def optimize(start_date: Optional[str] = Query(None),
             end_date: Optional[str] = Query(None)) -> Dict[str, Any]:
    """Run IAROA + hierarchical MPC for all 9 cities."""
    sd, ed = (start_date, end_date) if start_date and end_date else _default_dates()
    ch = datetime.now().hour; H = 24

    t_wall = _time.perf_counter()
    iaroa_res: Dict[str, Any] = {}
    mpc_res:   Dict[str, Any] = {}
    city_opt:  Dict[str, Dict[str, float]] = {}
    perf: Dict[str, Dict[str, float]] = {}
    iaroa_total = {"cost": 0.0, "carbon": 0.0, "time_ms": 0.0}
    mpc_total   = {"cost": 0.0, "carbon": 0.0, "time_ms": 0.0}
    cluster_city_res: Dict[str, Dict[str, Dict[str, float]]] = {c: {} for c in CLUSTERS}

    for cid, cfg in CITIES.items():
        wx = get_weather(cid, sd, ed)
        pv, wind, therm = gen_forecasts(cid, ch, H, wx)
        ld = load_forecast(cid, ch, H, wx)
        imp_p, exp_p = city_pricing(cid, ch, H)
        state = city_states[cid]
        soc = state["soc_kwh"]; soh = state["soh"]
        bat_cap = float(cfg["bat_cap"])
        pv_cap = float(cfg["pv_cap"] + cfg["wind_cap"] + cfg["thermal_cap"])
        gen_fc = (pv + wind + therm).astype(np.float32)
        pv_now = float(pv[0]); wind_now = float(wind[0]); therm_now = float(therm[0])
        gen_now = float(gen_fc[0]); load_now = float(ld[0])
        avg_p = float(np.mean(imp_p))

        # ── IAROA ──────────────────────────────────────────────────────────
        t0 = _time.perf_counter()
        ems = MicrogridEMS(gen_fc, ld, imp_p, exp_p, soc, bat_cap, pv_cap, soh)
        opt = IAROA(ems, max_iter=30, n_agents=12)
        bsol, bfit, conv = opt.run()
        iaroa_ms = opt.runtime_ms
        H_ = H
        Pch_i = float(bsol[0]); Pdis_i = float(bsol[H_])
        net_i = load_now + Pch_i - gen_now - Pdis_i
        Pimp_i = max(0, net_i); Pexp_i = max(0, -net_i)
        cost_i, carbon_i = _cost_carbon(Pimp_i, Pexp_i, Pdis_i, float(imp_p[0]), float(exp_p[0]), soh)
        iaroa_res[cid] = {
            "city": cfg["name"], "cluster": cfg["cluster"],
            "cost_inr": round(cost_i, 2), "carbon_kg": round(carbon_i, 4),
            "import_kw": round(Pimp_i, 2), "export_kw": round(Pexp_i, 2),
            "charge_kw": round(Pch_i, 2), "discharge_kw": round(Pdis_i, 2),
            "fitness": round(bfit, 2), "iterations": len(conv),
            "time_ms": round(iaroa_ms, 1), "convergence": conv[-10:],
        }
        iaroa_total["cost"] += cost_i; iaroa_total["carbon"] += carbon_i
        iaroa_total["time_ms"] += iaroa_ms

        # ── Local MPC ──────────────────────────────────────────────────────
        t0 = _time.perf_counter()
        Pch_m, Pdis_m, Pimp_m, Pexp_m = local_mpc(
            gen_now, load_now, soc, soh, float(imp_p[0]), float(exp_p[0]), avg_p, bat_cap)
        mpc_ms = (_time.perf_counter() - t0) * 1000
        cost_m, carbon_m = _cost_carbon(Pimp_m, Pexp_m, Pdis_m, float(imp_p[0]), float(exp_p[0]), soh)
        mpc_res[cid] = {
            "city": cfg["name"], "cluster": cfg["cluster"],
            "cost_inr": round(cost_m, 2), "carbon_kg": round(carbon_m, 4),
            "import_kw": round(Pimp_m, 2), "export_kw": round(Pexp_m, 2),
            "charge_kw": round(Pch_m, 2), "discharge_kw": round(Pdis_m, 2),
            "time_ms": round(mpc_ms, 1),
        }
        mpc_total["cost"] += cost_m; mpc_total["carbon"] += carbon_m
        mpc_total["time_ms"] += mpc_ms

        # State of health update
        new_soh, cycles_add = update_soh(soh, Pch_m, Pdis_m, bat_cap)
        new_soc = float(np.clip(
            soc + OPT_SETTINGS["battery_eta_ch"] * Pch_m - Pdis_m / OPT_SETTINGS["battery_eta_dis"],
            0.2 * bat_cap, 0.9 * bat_cap))
        city_states[cid]["soc_kwh"] = new_soc
        city_states[cid]["soh"] = new_soh
        city_states[cid]["cycles"] += cycles_add
        city_states[cid]["cumulative_cost"] += cost_m
        city_states[cid]["cumulative_carbon"] += carbon_m

        surplus = max(0, gen_now - load_now)
        deficit = max(0, load_now - gen_now)
        city_opt[cid] = {
            "gen_now": gen_now, "load_now": load_now,
            "pv_now": pv_now, "wind_now": wind_now, "thermal_now": therm_now,
            "surplus": surplus, "deficit": deficit,
            "net_kw": round(gen_now - load_now, 2),
            "soc_pct": round(new_soc / bat_cap * 100, 1), "soh": round(new_soh, 4),
        }
        cluster_city_res[cfg["cluster"]][cid] = city_opt[cid]

        perf[cid] = {
            "iaroa_ms": round(iaroa_ms, 1), "mpc_ms": round(mpc_ms, 3),
            "total_ms": round(iaroa_ms + mpc_ms, 1),
            "iterations": len(conv),
            "fitness_initial": round(conv[0], 2),
            "fitness_final": round(conv[-1], 2),
            "improvement_pct": round((1 - conv[-1] / max(abs(conv[0]), 1e-9)) * 100, 1),
        }

    # ── Regional MPC ───────────────────────────────────────────────────────
    t_reg = _time.perf_counter()
    regional: Dict[str, Any] = {}
    for cl in CLUSTERS:
        regional[cl] = regional_mpc(cl, cluster_city_res[cl])
    regional_ms = (_time.perf_counter() - t_reg) * 1000

    # ── Global MPC ─────────────────────────────────────────────────────────
    t_glob = _time.perf_counter()
    global_res = global_mpc(regional)
    global_ms = (_time.perf_counter() - t_glob) * 1000

    wall_ms = (_time.perf_counter() - t_wall) * 1000

    cost_saving = iaroa_total["cost"] - mpc_total["cost"]
    carbon_saving = iaroa_total["carbon"] - mpc_total["carbon"]

    return {
        "iaroa": {
            "per_city": iaroa_res,
            "total_cost_inr": round(iaroa_total["cost"], 2),
            "total_carbon_kg": round(iaroa_total["carbon"], 4),
            "total_time_ms": round(iaroa_total["time_ms"], 1),
        },
        "mpc": {
            "per_city": mpc_res,
            "total_cost_inr": round(mpc_total["cost"], 2),
            "total_carbon_kg": round(mpc_total["carbon"], 4),
            "total_time_ms": round(mpc_total["time_ms"], 1),
        },
        "hierarchical_mpc": {
            "local":    {cid: {"Pch": round(mpc_res[cid]["charge_kw"], 2),
                               "Pdis": round(mpc_res[cid]["discharge_kw"], 2)} for cid in mpc_res},
            "regional": regional,
            "global":   global_res,
            "regional_time_ms": round(regional_ms, 3),
            "global_time_ms": round(global_ms, 3),
        },
        "comparison": {
            "cost_saving_inr": round(cost_saving, 2),
            "carbon_saving_kg": round(carbon_saving, 4),
            "verdict": "IAROA+MPC" if mpc_total["cost"] <= iaroa_total["cost"] else "IAROA-Only",
        },
        "performance": {
            "per_city": perf,
            "total_wall_ms": round(wall_ms, 1),
            "avg_city_ms": round(wall_ms / len(CITIES), 1),
            "regional_ms": round(regional_ms, 3),
            "global_ms": round(global_ms, 3),
        },
        "city_opt": city_opt,
        "timestamp": _time.strftime("%Y-%m-%d %H:%M:%S"),
    }

@app.post("/simulate-24h")
def simulate_24h(start_date: Optional[str] = Query(None),
                 end_date: Optional[str] = Query(None)) -> Dict[str, Any]:
    sd, ed = (start_date, end_date) if start_date and end_date else _default_dates()
    H = 24
    sim_soc = {cid: float(CITIES[cid]["init_soc"]) * float(CITIES[cid]["bat_cap"]) for cid in CITIES}
    sim_soh = {cid: 1.0 for cid in CITIES}
    sim_cycles = {cid: 0.0 for cid in CITIES}
    results = []
    for hour_idx in range(24):
        hour_data: Dict[str, Any] = {"hour": hour_idx, "cities": {}, "hierarchical": {}, "totals": {}, "performance": {}}
        cluster_city_res: Dict[str, Dict[str, Dict[str, float]]] = {c: {} for c in CLUSTERS}
        total_iaroa_cost = total_mpc_cost = 0.0
        total_iaroa_carbon = total_mpc_carbon = 0.0
        total_ms = 0.0
        
        for cid, cfg in CITIES.items():
            wx = get_weather(cid, sd, ed)
            pv, wind, therm = gen_forecasts(cid, hour_idx, H, wx)
            ld = load_forecast(cid, hour_idx, H, wx)
            imp_p, exp_p = city_pricing(cid, hour_idx, H)
            soc = sim_soc[cid]; soh = sim_soh[cid]
            bat_cap = float(cfg["bat_cap"])
            pv_cap = float(cfg["pv_cap"] + cfg["wind_cap"] + cfg["thermal_cap"])
            gen_fc = (pv + wind + therm).astype(np.float32)
            gen_now = float(gen_fc[0]); load_now = float(ld[0])
            avg_p = float(np.mean(imp_p))

            t0 = _time.perf_counter()
            ems = MicrogridEMS(gen_fc, ld, imp_p, exp_p, soc, bat_cap, pv_cap, soh)
            opt = IAROA(ems, max_iter=15, n_agents=8)
            bsol, bfit, conv = opt.run()
            iaroa_ms = opt.runtime_ms
            Pimp_i = max(0, load_now + float(bsol[0]) - gen_now - float(bsol[H]))
            Pexp_i = max(0, -(load_now + float(bsol[0]) - gen_now - float(bsol[H])))
            cost_i, carbon_i = _cost_carbon(Pimp_i, Pexp_i, float(bsol[H]),
                                             float(imp_p[0]), float(exp_p[0]), soh)

            t0m = _time.perf_counter()
            Pch_m, Pdis_m, Pimp_m, Pexp_m = local_mpc(
                gen_now, load_now, soc, soh, float(imp_p[0]), float(exp_p[0]), avg_p, bat_cap)
            mpc_ms = (_time.perf_counter() - t0m) * 1000
            cost_m, carbon_m = _cost_carbon(Pimp_m, Pexp_m, Pdis_m,
                                             float(imp_p[0]), float(exp_p[0]), soh)

            new_soh, cycles_add = update_soh(soh, Pch_m, Pdis_m, bat_cap)
            new_soc = float(np.clip(
                soc + OPT_SETTINGS["battery_eta_ch"] * Pch_m - Pdis_m / OPT_SETTINGS["battery_eta_dis"],
                0.2 * bat_cap, 0.9 * bat_cap))
            sim_soc[cid] = new_soc; sim_soh[cid] = new_soh
            sim_cycles[cid] += cycles_add

            total_iaroa_cost += cost_i; total_mpc_cost += cost_m
            total_iaroa_carbon += carbon_i; total_mpc_carbon += carbon_m
            total_ms += iaroa_ms + mpc_ms

            perf_cid = {
                "iaroa_ms": round(iaroa_ms, 1), "mpc_ms": round(mpc_ms, 3),
                "total_ms": round(iaroa_ms + mpc_ms, 1),
            }

            c_res = {
                "gen_now": gen_now, "load_now": load_now,
                "pv_now": float(pv[0]), "wind_now": float(wind[0]),
                "thermal_now": float(therm[0]),
                "surplus": float(round(max(0.0, gen_now - load_now), 2)),
                "deficit": float(round(max(0.0, load_now - gen_now), 2)),
                "net_kw": round(gen_now - load_now, 2),
                "temp_c": round(float(wx["temps"][hour_idx % len(wx["temps"])]), 1),
                "wind_mps": round(float(wx["winds"][hour_idx % len(wx["winds"])]), 1),
                "soc_pct": round(new_soc / bat_cap * 100, 1),
                "soh": round(new_soh, 4), "cycles": round(sim_cycles[cid], 2),
            }
            cluster_city_res[cfg["cluster"]][cid] = c_res
            hour_data["cities"][cid] = {
                "iaroa_cost": round(cost_i, 2), "mpc_cost": round(cost_m, 2),
                "iaroa_carbon": round(carbon_i, 4), "mpc_carbon": round(carbon_m, 4),
                "import_kw": round(Pimp_m, 2), "export_kw": round(Pexp_m, 2),
                "charge_kw": round(Pch_m, 2), "discharge_kw": round(Pdis_m, 2),
                "soc_pct": round(new_soc / bat_cap * 100, 1),
                "soh": round(new_soh, 4),
                **c_res,
                **perf_cid,
                "fitness": round(bfit, 2),
            }
            hour_data["performance"][cid] = perf_cid

        t_reg = _time.perf_counter()
        regional = {}
        for cl in CLUSTERS:
            regional[cl] = regional_mpc(cl, cluster_city_res[cl])
        reg_ms = (_time.perf_counter() - t_reg) * 1000
        
        t_glob = _time.perf_counter()
        global_res = global_mpc(regional)
        glob_ms = (_time.perf_counter() - t_glob) * 1000
        
        total_ms += reg_ms + glob_ms
        
        hour_data["hierarchical"] = {
            "local": {cid: {"Pch": d["charge_kw"], "Pdis": d["discharge_kw"]} for cid, d in hour_data["cities"].items()},
            "regional": regional,
            "global": global_res,
            "regional_time_ms": round(reg_ms, 3),
            "global_time_ms": round(glob_ms, 3),
        }
        hour_data["totals"] = {
            "iaroa_cost": round(total_iaroa_cost, 2),
            "mpc_cost": round(total_mpc_cost, 2),
            "iaroa_carbon": round(total_iaroa_carbon, 4),
            "mpc_carbon": round(total_mpc_carbon, 4),
            "total_ms": round(total_ms, 1),
        }
        results.append(hour_data)
    return {"simulation": results}

@app.post("/reset-states")
def reset_states() -> Dict[str, str]:
    _init_states()
    WEATHER_CACHE.clear()
    return {"status": "reset", "message": "All city states and weather cache cleared"}

@app.get("/battery-health")
def battery_health() -> Dict[str, Any]:
    out = {}
    for cid, cfg in CITIES.items():
        s = city_states[cid]
        remaining_life_pct = max(0, (s["soh"] - 0.5) / 0.5 * 100)
        out[cid] = {
            "city": cfg["name"], "cluster": cfg["cluster"],
            "soh": round(s["soh"], 4), "soh_pct": round(s["soh"] * 100, 2),
            "cycles": round(s["cycles"], 2),
            "remaining_life_pct": round(remaining_life_pct, 1),
            "soc_kwh": round(s["soc_kwh"], 2),
            "soc_pct": round(s["soc_kwh"] / cfg["bat_cap"] * 100, 1),
            "bat_cap_kwh": cfg["bat_cap"],
            "status": ("healthy" if s["soh"] > 0.85 else
                       "degraded" if s["soh"] > 0.70 else "critical"),
        }
    return {"battery_health": out}