from fastapi import FastAPI, Query
from pydantic import BaseModel
from typing import List, Dict, Optional, Any
import numpy as np
import time as _time
import math
from datetime import datetime, timedelta
from fastapi.middleware.cors import CORSMiddleware
import openmeteo_requests
import requests_cache
from retry_requests import retry
import pandas as pd

# === API Setup ===
app = FastAPI(title="Decentralized 5-City Microgrid Optimization API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# FIX: Only import ems_router if ems_api module exists; skip gracefully otherwise
try:
    from ems_api import router as ems_router
    app.include_router(ems_router)
except ImportError:
    pass

# ============================
# OPTIMIZATION SETTINGS
# ============================
OPTIMIZATION_SETTINGS: Dict[str, float] = {
    "deg_cost_per_kwh": 0.50,
    "peak_demand_charge": 150.0,
    "grid_emission_factor": 0.5,
    "carbon_tax": 2.0,
    "battery_eta_ch": 0.95,
    "battery_eta_dis": 0.95,
}

class OptSettingsPayload(BaseModel):
    deg_cost_per_kwh: float = 0.50
    peak_demand_charge: float = 150.0
    grid_emission_factor: float = 0.5
    carbon_tax: float = 2.0
    battery_eta_ch: float = 0.95
    battery_eta_dis: float = 0.95

@app.get("/optimization-settings")
def get_opt_settings() -> Dict[str, float]:
    """Get current global optimization parameters."""
    return OPTIMIZATION_SETTINGS

@app.post("/optimization-settings")
def update_opt_settings(payload: OptSettingsPayload) -> Dict[str, Any]:
    """Update global optimization parameters."""
    OPTIMIZATION_SETTINGS.update(payload.dict())
    return {"status": "ok", "settings": OPTIMIZATION_SETTINGS}

@app.get("/calculation-logic")
def get_calculation_logic() -> Dict[str, Any]:
    """Representation of how cost and carbon emissions are calculated."""
    return {
        "cost_calculation": {
            "formula": "Total Cost = Energy Cost + Degradation Cost + Demand Charge + Carbon Cost",
            "energy_cost": "(Grid Import * Import Price) - (Grid Export * Export Price)",
            "degradation_cost": "Battery Discharge * Degradation Cost Per kWh",
            "demand_charge": "Max Grid Import * Peak Demand Charge",
            "carbon_cost": "Grid Import * Grid Emission Factor * Carbon Tax"
        },
        "carbon_calculation": {
            "formula": "Carbon Emissions = Grid Import * Grid Emission Factor",
            "unit": "kg CO2"
        },
        "parameters": OPTIMIZATION_SETTINGS
    }

# ============================
# 5 CITY DEFINITIONS
# ============================
CITIES: Dict[str, Any] = {
    "delhi": {
        "name": "Delhi",
        "lat": 28.6139, "lon": 77.2090,
        "pv_capacity_kw": 150.0,
        "wind_capacity_kw": 80.0,
        "thermal_capacity_kw": 100.0,
        "houses_count": 120,
        "buildings_count": 8,
        "bat_cap_kwh": 500.0,
        "initial_soc_pct": 0.55,
        "peak_load_kw": 25.0,
        "grid_zone": "IN-NO",
        "climate": "hot_arid",
        "base_import_price": [4,4,4,4,5,5,7,8,9,10,11,11,10,9,8,7,9,11,13,11,8,6,5,4],
        "load_profile": [3,2,2,3,5,7,10,15,18,21,23,25,24,22,19,16,12,10,8,6,5,4,3,3],
    },
    "mumbai": {
        "name": "Mumbai",
        "lat": 19.0760, "lon": 72.8777,
        "pv_capacity_kw": 120.0,
        "wind_capacity_kw": 150.0,
        "thermal_capacity_kw": 80.0,
        "houses_count": 150,
        "buildings_count": 12,
        "bat_cap_kwh": 450.0,
        "initial_soc_pct": 0.50,
        "peak_load_kw": 22.0,
        "grid_zone": "IN-WE",
        "climate": "tropical",
        "base_import_price": [5,5,4,4,5,6,7,8,9,10,10,10,9,8,7,6,8,10,12,10,7,6,5,5],
        "load_profile": [4,3,3,3,5,7,9,13,16,19,21,22,21,19,17,15,11,9,7,6,5,4,4,4],
    },
    "chennai": {
        "name": "Chennai",
        "lat": 13.0827, "lon": 80.2707,
        "pv_capacity_kw": 180.0,
        "wind_capacity_kw": 120.0,
        "thermal_capacity_kw": 60.0,
        "houses_count": 130,
        "buildings_count": 10,
        "bat_cap_kwh": 550.0,
        "initial_soc_pct": 0.60,
        "peak_load_kw": 20.0,
        "grid_zone": "IN-SO",
        "climate": "tropical_coastal",
        "base_import_price": [4,4,3,3,4,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
        "load_profile": [3,3,2,3,4,6,8,12,15,18,20,20,19,18,16,14,10,8,7,5,4,3,3,3],
    },
    "kolkata": {
        "name": "Kolkata",
        "lat": 22.5726, "lon": 88.3639,
        "pv_capacity_kw": 110.0,
        "wind_capacity_kw": 100.0,
        "thermal_capacity_kw": 80.0,
        "houses_count": 110,
        "buildings_count": 7,
        "bat_cap_kwh": 400.0,
        "initial_soc_pct": 0.45,
        "peak_load_kw": 18.0,
        "grid_zone": "IN-EA",
        "climate": "humid_subtropical",
        "base_import_price": [4,3,3,3,4,5,6,7,8,9,10,10,9,8,7,6,7,9,11,9,7,5,4,4],
        "load_profile": [2,2,2,2,4,5,7,10,13,16,18,18,17,16,14,12,9,7,6,5,4,3,2,2],
    },
    "jaipur": {
        "name": "Jaipur",
        "lat": 26.9124, "lon": 75.7873,
        "pv_capacity_kw": 200.0,
        "wind_capacity_kw": 50.0,
        "thermal_capacity_kw": 40.0,
        "houses_count": 90,
        "buildings_count": 4,
        "bat_cap_kwh": 480.0,
        "initial_soc_pct": 0.52,
        "peak_load_kw": 20.0,
        "grid_zone": "IN-NO",
        "climate": "hot_desert",
        "base_import_price": [4,4,4,4,5,5,6,7,8,9,10,10,9,8,7,6,8,10,12,10,7,6,5,4],
        "load_profile": [2,2,2,3,4,6,8,11,14,17,19,20,19,17,15,13,10,8,6,5,4,3,2,2],
    },
}

# ============================
# CITY STATE TRACKER
# ============================
# FIX: Use explicit Dict[str, Dict[str, float]] type
city_states: Dict[str, Dict[str, float]] = {}

def _init_city_states() -> None:
    global city_states
    city_states = {}
    for cid, cfg in CITIES.items():
        soc = float(cfg["initial_soc_pct"]) * float(cfg["bat_cap_kwh"])
        city_states[cid] = {
            "soc_kwh": soc,
            "last_pv_kw": 0.0,
            "last_wind_kw": 0.0,
            "last_thermal_kw": 0.0,
            "last_load_kw": 0.0,
            "last_import_kw": 0.0,
            "last_export_kw": 0.0,
            "last_charge_kw": 0.0,
            "last_discharge_kw": 0.0,
            "surplus_kw": 0.0,
            "deficit_kw": 0.0,
        }

_init_city_states()


# ============================
# WEATHER DATA (Open-Meteo SDK)
# ============================
WEATHER_CACHE: Dict[str, Any] = {}

# Setup Open-Meteo client with cache and retry
cache_session = requests_cache.CachedSession('.cache', expire_after=3600)
retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
openmeteo = openmeteo_requests.Client(session=retry_session)

def get_weather_data(
    city_id: str,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> Dict[str, Any]:
    """Fetches historical weather data from Open-Meteo archive API."""
    if start_date is None:
        today = datetime.now()
        start_dt = today - timedelta(days=2)
        start_date = start_dt.strftime("%Y-%m-%d")
        end_date = (start_dt + timedelta(days=1)).strftime("%Y-%m-%d")
    elif end_date is None:
        end_date = start_date

    cache_key = f"{city_id}_{start_date}_{end_date}"
    now = _time.time()
    if cache_key in WEATHER_CACHE and now - WEATHER_CACHE[cache_key]["timestamp"] < 3600:
        return WEATHER_CACHE[cache_key]["data"]  # type: ignore[return-value]

    cfg = CITIES[city_id]
    try:
        url = "https://archive-api.open-meteo.com/v1/archive"
        hourly_vars = [
            "temperature_2m", "relative_humidity_2m", "apparent_temperature",
            "wind_direction_10m", "wind_direction_100m", "wind_speed_100m",
            "wind_speed_10m", "cloud_cover_low", "cloud_cover_mid",
            "cloud_cover_high", "cloud_cover", "dew_point_2m",
            "precipitation", "snowfall", "rain", "shortwave_radiation"
        ]
        params = {
            "latitude": cfg["lat"],
            "longitude": cfg["lon"],
            "start_date": start_date,
            "end_date": end_date,
            "hourly": hourly_vars
        }
        responses = openmeteo.weather_api(url, params=params)
        response = responses[0]
        hourly = response.Hourly()

        weather_dict: Dict[str, List[float]] = {}
        for i, var_name in enumerate(hourly_vars):
            weather_dict[var_name] = hourly.Variables(i).ValuesAsNumpy().tolist()

        # FIX: Compute expected hours correctly
        start_dt_obj = datetime.strptime(start_date, "%Y-%m-%d")
        end_dt_obj = datetime.strptime(end_date, "%Y-%m-%d")
        expected_hours = int((end_dt_obj - start_dt_obj).total_seconds() / 3600) + 24

        for var_name in hourly_vars:
            arr = list(weather_dict[var_name])
            while len(arr) < expected_hours:
                arr.append(arr[-1] if arr else 0.0)
            weather_dict[var_name] = arr[:expected_hours]

        result: Dict[str, Any] = {
            "weather": weather_dict,
            "temps": weather_dict["temperature_2m"],
            "winds": weather_dict["wind_speed_10m"],
            "solar": weather_dict["shortwave_radiation"],
            "humidity": weather_dict["relative_humidity_2m"],
            "cloud_cover": weather_dict["cloud_cover"],
            "precipitation": weather_dict["precipitation"],
            "start_date": start_date,
            "end_date": end_date,
        }
        WEATHER_CACHE[cache_key] = {"timestamp": now, "data": result}

        print(f"\n[Weather] Fetched {city_id} for {start_date}")
        print(f"{'Hour':<6} | {'Temp':<6} | {'Wind':<6} | {'Solar':<6}")
        print("-" * 35)
        for h in range(24):
            temps_list: List[float] = result["temps"]
            winds_list: List[float] = result["winds"]
            solar_list: List[float] = result["solar"]
            if h < len(temps_list):
                print(f"{h:02d}:00  | {temps_list[h]:<6.1f} | {winds_list[h]:<6.1f} | {solar_list[h]:<6.1f}")

        return result

    except Exception as e:
        print(f"Weather API error for {city_id}: {e}")

    # Fallback: simulated weather
    start_dt_fb = datetime.strptime(start_date, "%Y-%m-%d")
    end_dt_fb = datetime.strptime(end_date, "%Y-%m-%d")
    expected_hours = int((end_dt_fb - start_dt_fb).total_seconds() / 3600) + 24

    base_tmp = 25.0
    temps = [float(base_tmp + 5 * math.sin((h - 6) * math.pi / 12)) for h in range(expected_hours)]
    winds = [float(abs(15 * math.sin(h * math.pi / 12) + 5 * float(np.random.randn()))) for h in range(expected_hours)]
    solar = [float(800 * max(0.0, math.sin((h - 6) * math.pi / 12))) for h in range(expected_hours)]

    fallback: Dict[str, Any] = {
        "temps": temps, "winds": winds, "solar": solar,
        "humidity": [50.0] * expected_hours,
        "cloud_cover": [30.0] * expected_hours,
        "precipitation": [0.0] * expected_hours,
        "weather": {
            "temperature_2m": temps,
            "wind_speed_10m": winds,
            "shortwave_radiation": solar,
            "relative_humidity_2m": [50.0] * expected_hours,
            "cloud_cover": [30.0] * expected_hours,
            "precipitation": [0.0] * expected_hours
        },
        "start_date": start_date,
        "end_date": end_date,
    }
    return fallback


def generate_generation_forecasts(
    city_id: str,
    hours: int = 24,
    start_hour: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> tuple:
    # FIX: Default start_hour to 0 for historical simulation; use current hour for live
    if start_hour is None:
        start_hour = datetime.now().hour

    cfg = CITIES[city_id]
    weather_res = get_weather_data(city_id, start_date, end_date)

    solar_data: List[float] = weather_res["weather"].get("shortwave_radiation", [])
    wind_data: List[float] = weather_res["weather"].get("wind_speed_10m", [])

    pv_cap = float(cfg["pv_capacity_kw"])
    wind_cap = float(cfg["wind_capacity_kw"])
    therm_cap = float(cfg["thermal_capacity_kw"])

    pv: List[float] = []
    wind: List[float] = []
    thermal: List[float] = []

    n_solar = len(solar_data)
    n_wind = len(wind_data)

    for h in range(hours):
        idx = start_hour + h

        # FIX: Safe modulo with length check
        s_val = float(solar_data[idx % n_solar]) if n_solar > 0 else 0.0
        pv_val = max(0.0, s_val / 1000.0 * pv_cap)
        pv.append(round(pv_val, 2))

        w_val = float(wind_data[idx % n_wind]) if n_wind > 0 else 0.0
        w_factor = (w_val / 15.0) ** 3
        wind.append(round(min(wind_cap, wind_cap * w_factor), 2))

        # FIX: Use deterministic thermal (no random) for reproducible simulation
        thermal.append(round(therm_cap * 0.85, 2))

    return pv, wind, thermal


def generate_dynamic_load_forecast(
    city_id: str,
    hours: int = 24,
    start_hour: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None
) -> List[float]:
    if start_hour is None:
        start_hour = datetime.now().hour

    cfg = CITIES[city_id]
    weather_res = get_weather_data(city_id, start_date, end_date)

    temp_data: List[float] = weather_res.get("temps", [25.0] * 48)

    h_count = int(cfg["houses_count"])
    b_count = int(cfg["buildings_count"])
    avg_house_base = 0.5
    avg_building_base = 10.0
    load_profile: List[int] = cfg.get("load_profile", [10] * 24)

    loads: List[float] = []
    n_temp = len(temp_data)

    for h in range(hours):
        idx = start_hour + h
        tmp = float(temp_data[idx % n_temp]) if n_temp > 0 else 25.0

        hvac_factor = 1.0
        if tmp > 30.0:
            hvac_factor += (tmp - 30.0) * 0.05
        elif tmp < 15.0:
            hvac_factor += (15.0 - tmp) * 0.04

        # FIX: Always index into load_profile by actual clock hour (0-23)
        clock_hour = idx % 24
        daily_mod = float(load_profile[clock_hour]) / 10.0

        load_val = (h_count * avg_house_base + b_count * avg_building_base) * hvac_factor * daily_mod
        loads.append(round(float(load_val), 2))

    return loads


def get_city_pricing(city_id: str, hours: int = 24, start_hour: int = 0) -> tuple:
    """Returns import/export prices aligned with the starting hour."""
    cfg = CITIES[city_id]
    imp = np.array(cfg["base_import_price"], dtype=float)

    # FIX: Ensure roll is within bounds
    roll_by = int(start_hour) % 24
    imp = np.roll(imp, -roll_by)

    if hours != 24:
        imp = np.interp(np.linspace(0, 24, hours), np.arange(24), imp)

    exp = imp * 0.5
    return [round(float(x), 2) for x in imp], [round(float(x), 2) for x in exp]


# ============================
# IAROA OPTIMIZER
# ============================
class MicrogridEMS:
    def __init__(
        self,
        pv_forecast: List[float],
        load_forecast: List[float],
        import_price: List[float],
        export_price: List[float],
        soc: float,
        bat_cap: float,
        pv_cap: float
    ) -> None:
        self.pv_gen = np.array(pv_forecast, dtype=float)
        self.load = np.array(load_forecast, dtype=float)
        self.import_price = np.array(import_price, dtype=float)
        self.export_price = np.array(export_price, dtype=float)
        self.horizon = len(pv_forecast)
        self.dim = self.horizon * 3
        self.pv_capacity = float(pv_cap)
        self.bat_cap = float(bat_cap)
        self.soc_min = 0.2 * self.bat_cap
        self.soc_max = 0.9 * self.bat_cap
        self.initial_soc = float(soc)
        self.p_bat_max = self.bat_cap * 0.25
        self.eta_ch = float(OPTIMIZATION_SETTINGS["battery_eta_ch"])
        self.eta_dis = float(OPTIMIZATION_SETTINGS["battery_eta_dis"])
        self.dt = 1.0
        self.deg_cost_per_kwh = float(OPTIMIZATION_SETTINGS["deg_cost_per_kwh"])
        self.peak_demand_charge = float(OPTIMIZATION_SETTINGS["peak_demand_charge"])
        self.grid_emission_factor = float(OPTIMIZATION_SETTINGS["grid_emission_factor"])
        self.carbon_tax = float(OPTIMIZATION_SETTINGS["carbon_tax"])
        self._last_P_imp = np.zeros(self.horizon)
        self._last_P_exp = np.zeros(self.horizon)

    def get_bounds(self) -> tuple:
        lb = np.zeros(self.dim)
        ub = np.concatenate([
            np.ones(self.horizon) * self.p_bat_max,
            np.ones(self.horizon) * self.p_bat_max,
            np.ones(self.horizon) * self.pv_capacity
        ])
        return lb, ub

    def fitness_function(self, x: np.ndarray) -> Any:
        is_1d = x.ndim == 1
        x_batched = x.reshape(1, -1) if is_1d else x

        H = self.horizon
        PF = 1e6
        Pch = x_batched[:, 0:H]
        Pdis = x_batched[:, H:2*H]
        Curt = x_batched[:, 2*H:3*H]

        load = self.load.reshape(1, H)
        pv_gen = self.pv_gen.reshape(1, H)

        net = load + Pch + Curt - pv_gen - Pdis
        P_imp = np.maximum(0.0, net)
        P_exp = np.maximum(0.0, -net)

        soc_changes = (self.eta_ch * Pch - Pdis / self.eta_dis) * self.dt
        soc_traj = self.initial_soc + np.cumsum(soc_changes, axis=1)

        penalty = np.zeros(x_batched.shape[0])
        penalty += np.sum(np.maximum(0.0, self.soc_min - soc_traj) * PF, axis=1)
        penalty += np.sum(np.maximum(0.0, soc_traj - self.soc_max) * PF, axis=1)
        penalty += np.sum(1e4 * Pch * Pdis, axis=1)
        penalty += np.sum(np.maximum(0.0, P_imp - 50.0) * PF, axis=1)
        penalty += np.sum(np.maximum(0.0, P_exp - 50.0) * PF, axis=1)

        imp_p = self.import_price.reshape(1, H)
        exp_p = self.export_price.reshape(1, H)

        t_eng = np.sum(imp_p * P_imp - exp_p * P_exp, axis=1)
        t_deg = np.sum(self.deg_cost_per_kwh * Pdis, axis=1)
        t_emi = np.sum(self.grid_emission_factor * P_imp * self.carbon_tax, axis=1)
        dem_cost = np.max(P_imp, axis=1) * self.peak_demand_charge

        if is_1d:
            self._last_P_imp = P_imp[0]
            self._last_P_exp = P_exp[0]

        fitness = t_eng + t_deg + dem_cost + t_emi + penalty
        return float(fitness[0]) if is_1d else fitness


class IAROA:
    def __init__(
        self,
        obj_func: Any,
        max_iter: int,
        lb: Any,
        ub: Any,
        n_agents: int = 15
    ) -> None:
        self.obj_func = obj_func
        self.max_iter = max_iter
        self.lb = np.array(lb, dtype=float)
        self.ub = np.array(ub, dtype=float)
        self.n_agents = n_agents
        self.dim = len(lb)
        self.time_taken = 0.0

    def optimize(self) -> tuple:
        t_start = _time.time()
        X = np.random.uniform(self.lb, self.ub, (self.n_agents, self.dim))
        fitness = self.obj_func(X)
        b_idx = int(np.argmin(fitness))
        b_sol = X[b_idx].copy()
        b_fit = float(fitness[b_idx])
        convergence: List[float] = [b_fit]

        for t in range(self.max_iter):
            A = 4.0 * (1.0 - t / self.max_iter) * math.log(1.0 / max(float(np.random.rand()), 1e-10))
            r = np.random.rand(self.n_agents, 1)

            if A > 1.0:
                j = np.random.randint(0, self.n_agents, size=self.n_agents)
                X_new = X[j] + r * (X - X[j]) + np.random.randn(self.n_agents, self.dim)
            else:
                X_new = b_sol + A * np.random.randn(self.n_agents, self.dim) * (b_sol - X)

            X_new = np.clip(X_new, self.lb, self.ub)
            new_fit = self.obj_func(X_new)

            better_mask = new_fit < fitness
            X[better_mask] = X_new[better_mask]
            fitness[better_mask] = new_fit[better_mask]

            curr_b_idx = int(np.argmin(fitness))
            if fitness[curr_b_idx] < b_fit:
                b_sol = X[curr_b_idx].copy()
                b_fit = float(fitness[curr_b_idx])

            convergence.append(b_fit)

        self.time_taken = _time.time() - t_start
        return b_sol, b_fit, convergence


# ============================
# MPC DISPATCH HEURISTIC
# ============================
def mpc_dispatch(
    pv: float,
    load_val: float,
    soc: float,
    imp_price: float,
    exp_price: float,
    avg_price: float,
    bat_cap: float,
    carbon_intensity: float = 600.0
) -> tuple:
    """Single-step MPC dispatch heuristic."""
    SOC_MIN = 0.2 * bat_cap
    SOC_MAX = 0.9 * bat_cap
    P_BAT_MAX = bat_cap * 0.25
    ETA_CH = float(OPTIMIZATION_SETTINGS["battery_eta_ch"])
    ETA_DIS = float(OPTIMIZATION_SETTINGS["battery_eta_dis"])
    DEG_COST = float(OPTIMIZATION_SETTINGS["deg_cost_per_kwh"])

    net_load = load_val - pv
    P_ch, P_dis = 0.0, 0.0

    if imp_price > avg_price and net_load > 0.0 and soc > SOC_MIN + 2.0:
        savings = imp_price - DEG_COST
        if savings > 0.0:
            max_dis_soc = (soc - SOC_MIN) * ETA_DIS
            P_dis = min(P_BAT_MAX, max_dis_soc, net_load)
            P_dis = max(0.0, P_dis)
    elif imp_price < avg_price * 0.85 and soc < SOC_MAX - 2.0:
        if net_load <= 0.0:
            max_ch_soc = (SOC_MAX - soc) / ETA_CH
            max_ch_pv = abs(net_load)
            P_ch = min(P_BAT_MAX, max_ch_soc, max_ch_pv)
            P_ch = max(0.0, P_ch)

    final_net = net_load + P_ch - P_dis
    P_imp = max(0.0, final_net)
    P_exp = max(0.0, -final_net)

    return P_ch, P_dis, P_imp, P_exp


# ============================
# PEER-TO-PEER ENERGY TRADING
# ============================
def compute_p2p_trades(city_results: Dict[str, Dict[str, float]]) -> List[Dict[str, Any]]:
    """After optimizing each city, compute peer-to-peer energy trades."""
    # FIX: Use separate mutable copies to avoid aliasing issues
    surplus_cities: Dict[str, float] = {}
    deficit_cities: Dict[str, float] = {}

    for cid, res in city_results.items():
        tot_gen = float(res.get("tot_gen_now", 0.0))
        load_now = float(res.get("load_now", 0.0))
        net = tot_gen - load_now
        if net > 0.5:
            surplus_cities[cid] = round(net, 2)
        elif net < -0.5:
            deficit_cities[cid] = round(abs(net), 2)

    # FIX: Work on copies to prevent mutation during iteration
    surplus_avail: Dict[str, float] = dict(surplus_cities)
    deficit_need: Dict[str, float] = dict(deficit_cities)

    trades: List[Dict[str, Any]] = []

    for d_city in sorted(deficit_need, key=lambda c: -deficit_need[c]):
        remaining = deficit_need[d_city]
        for s_city in sorted(surplus_avail, key=lambda c: -surplus_avail[c]):
            if remaining <= 0.1:
                break
            avail = surplus_avail.get(s_city, 0.0)
            if avail <= 0.1:
                continue
            traded = min(remaining, avail)
            trades.append({
                "from": s_city,
                "to": d_city,
                "amount_kw": round(traded, 2),
                "price_inr": round(traded * 5.0, 2),
            })
            surplus_avail[s_city] = avail - traded
            remaining -= traded

    return trades


# ============================
# COMMUNICATION LINKS (MESH)
# ============================
def get_communication_links() -> List[Dict[str, Any]]:
    """All peer-to-peer communication links (full mesh)."""
    city_ids = list(CITIES.keys())
    links: List[Dict[str, Any]] = []
    for i in range(len(city_ids)):
        for j in range(i + 1, len(city_ids)):
            links.append({
                "from": city_ids[i],
                "to": city_ids[j],
                "latency_ms": round(float(np.random.uniform(5, 25)), 1),
                "status": "active"
            })
    return links


# ============================
# HELPER: compute cost & carbon
# ============================
def _compute_cost_carbon(
    imp_price_now: float,
    exp_price_now: float,
    P_imp: float,
    P_exp: float,
    P_dis: float
) -> tuple:
    deg_cost = float(OPTIMIZATION_SETTINGS["deg_cost_per_kwh"])
    emi_factor = float(OPTIMIZATION_SETTINGS["grid_emission_factor"])
    carb_tax = float(OPTIMIZATION_SETTINGS["carbon_tax"])

    cost = (imp_price_now * P_imp
            - exp_price_now * P_exp
            + deg_cost * P_dis
            + emi_factor * P_imp * carb_tax)
    carbon = emi_factor * P_imp
    return cost, carbon


# ============================
# API ENDPOINTS
# ============================

@app.get("/cities")
def get_cities(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
) -> Dict[str, Any]:
    """Return all 5 city configs and current states."""
    # FIX: Validate that start_date is a proper string
    if not isinstance(start_date, str) or not start_date:
        start_dt = datetime.now() - timedelta(days=2)
        start_date = start_dt.strftime("%Y-%m-%d")

    if not isinstance(end_date, str) or not end_date:
        dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_date = (dt + timedelta(days=1)).strftime("%Y-%m-%d")

    # FIX: current hour used consistently for live data alignment
    current_hour = datetime.now().hour

    result: List[Dict[str, Any]] = []
    for cid, cfg in CITIES.items():
        pv_fc, wind_fc, thermal_fc = generate_generation_forecasts(
            cid, 1, start_hour=current_hour, start_date=start_date, end_date=end_date
        )
        load_fc = generate_dynamic_load_forecast(
            cid, 1, start_hour=current_hour, start_date=start_date, end_date=end_date
        )

        pv_now = float(pv_fc[0])
        wind_now = float(wind_fc[0])
        thermal_now = float(thermal_fc[0])
        load_now = float(load_fc[0])
        tot_gen = round(pv_now + wind_now + thermal_now, 2)

        state = city_states.get(cid, {})
        bat_cap = float(cfg["bat_cap_kwh"])
        soc_kwh = float(state.get("soc_kwh", float(cfg["initial_soc_pct"]) * bat_cap))

        # FIX: Use current_hour index for weather (not index 0)
        weather = get_weather_data(cid, start_date, end_date)
        temps: List[float] = weather["temps"]
        winds: List[float] = weather["winds"]
        current_temp = round(temps[current_hour % len(temps)], 1) if temps else 25.0
        current_wind = round(winds[current_hour % len(winds)], 1) if winds else 5.0

        result.append({
            "id": cid,
            "name": cfg["name"],
            "lat": cfg["lat"],
            "lon": cfg["lon"],
            "pv_capacity_kw": cfg["pv_capacity_kw"],
            "wind_capacity_kw": cfg["wind_capacity_kw"],
            "thermal_capacity_kw": cfg["thermal_capacity_kw"],
            "houses_count": cfg["houses_count"],
            "buildings_count": cfg["buildings_count"],
            "bat_cap_kwh": bat_cap,
            "grid_zone": cfg["grid_zone"],
            "climate": cfg["climate"],
            "pv_now_kw": pv_now,
            "wind_now_kw": wind_now,
            "thermal_now_kw": thermal_now,
            "tot_gen_kw": tot_gen,
            "load_now_kw": load_now,
            "current_temp_c": current_temp,
            "current_wind_mps": current_wind,
            "soc_kwh": round(soc_kwh, 2),
            "soc_pct": round(soc_kwh / bat_cap * 100.0, 1),
            "net_power_kw": round(tot_gen - load_now, 2),
            "status": (
                "surplus" if tot_gen > load_now
                else ("deficit" if load_now > tot_gen + 1.0 else "balanced")
            ),
        })

    return {
        "cities": result,
        "communication_links": get_communication_links(),
        "timestamp": _time.strftime("%Y-%m-%d %H:%M:%S"),
    }


@app.post("/optimize-decentralized")
def optimize_decentralized(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
) -> Dict[str, Any]:
    """Run IAROA-only and IAROA+MPC for all 5 cities, return comparison."""
    if not isinstance(start_date, str) or not start_date:
        start_dt = datetime.now() - timedelta(days=2)
        start_date = start_dt.strftime("%Y-%m-%d")

    if not isinstance(end_date, str) or not end_date:
        end_date = (datetime.strptime(start_date, "%Y-%m-%d") + timedelta(days=1)).strftime("%Y-%m-%d")

    current_hour = datetime.now().hour
    H = 24

    iora_results: Dict[str, Any] = {}
    mpc_results: Dict[str, Any] = {}
    iora_total_cost = 0.0
    mpc_total_cost = 0.0
    iora_total_carbon = 0.0
    mpc_total_carbon = 0.0
    iora_total_time = 0.0
    mpc_total_time = 0.0
    iora_convergences: Dict[str, List[float]] = {}

    # FIX: city_opt_results now includes soc_pct and soc_kwh
    city_opt_results: Dict[str, Dict[str, float]] = {}

    for cid, cfg in CITIES.items():
        pv_fc, wind_fc, thermal_fc = generate_generation_forecasts(
            cid, H, start_hour=current_hour, start_date=start_date, end_date=end_date
        )
        load_fc = generate_dynamic_load_forecast(
            cid, H, start_hour=current_hour, start_date=start_date, end_date=end_date
        )
        imp_price, exp_price = get_city_pricing(cid, H, start_hour=current_hour)
        soc = float(city_states[cid]["soc_kwh"])
        bat_cap = float(cfg["bat_cap_kwh"])
        pv_cap = float(cfg["pv_capacity_kw"] + cfg["wind_capacity_kw"] + cfg["thermal_capacity_kw"])

        weather = get_weather_data(cid, start_date=start_date, end_date=end_date)
        temps: List[float] = weather["temps"]
        winds: List[float] = weather["winds"]
        current_temp = round(temps[current_hour % len(temps)], 1) if temps else 25.0
        current_wind_val = round(winds[current_hour % len(winds)], 1) if winds else 5.0

        tot_gen_fc = [round(float(pv_fc[h] + wind_fc[h] + thermal_fc[h]), 2) for h in range(H)]

        pv_now = float(pv_fc[0])
        wind_now = float(wind_fc[0])
        thermal_now = float(thermal_fc[0])
        tot_gen_now = float(tot_gen_fc[0])
        load_now = float(load_fc[0])

        # FIX: Include soc info in city_opt_results so P2P logic can reference it
        city_opt_results[cid] = {
            "pv_now": pv_now,
            "wind_now": wind_now,
            "thermal_now": thermal_now,
            "tot_gen_now": tot_gen_now,
            "load_now": load_now,
            "soc_pct": round(soc / bat_cap * 100.0, 1),
            "soc_kwh": soc,
            "current_temp_c": current_temp,
            "current_wind_mps": current_wind_val,
        }

        # ---- IAROA-ONLY ----
        t0 = _time.time()
        ems = MicrogridEMS(tot_gen_fc, load_fc, imp_price, exp_price, soc, bat_cap, pv_cap)
        lb, ub = ems.get_bounds()
        optimizer = IAROA(ems.fitness_function, max_iter=30, lb=lb, ub=ub, n_agents=12)
        best_sol, best_fit, convergence = optimizer.optimize()
        iora_time = (_time.time() - t0) * 1000.0

        P_ch_iora = float(best_sol[0])
        P_dis_iora = float(best_sol[H])
        net_iora = load_now + P_ch_iora - tot_gen_now - P_dis_iora
        P_imp_iora = max(0.0, net_iora)
        P_exp_iora = max(0.0, -net_iora)

        cost_iora, carbon_iora = _compute_cost_carbon(
            imp_price[0], exp_price[0], P_imp_iora, P_exp_iora, P_dis_iora
        )

        iora_results[cid] = {
            "city": cfg["name"],
            "cost_inr": round(cost_iora, 2),
            "carbon_kg": round(carbon_iora, 2),
            "import_kw": round(P_imp_iora, 2),
            "export_kw": round(P_exp_iora, 2),
            "charge_kw": round(P_ch_iora, 2),
            "discharge_kw": round(P_dis_iora, 2),
            "fitness": round(float(best_fit), 2),
            "iterations": len(convergence),
            "computation_ms": round(iora_time, 1),
        }
        iora_total_cost += cost_iora
        iora_total_carbon += carbon_iora
        iora_total_time += iora_time
        iora_convergences[cid] = convergence

        # ---- IAROA + MPC ----
        t0 = _time.time()
        ems2 = MicrogridEMS(tot_gen_fc, load_fc, imp_price, exp_price, soc, bat_cap, pv_cap)
        lb2, ub2 = ems2.get_bounds()
        optimizer2 = IAROA(ems2.fitness_function, max_iter=30, lb=lb2, ub=ub2, n_agents=12)
        best_sol2, best_fit2, conv2 = optimizer2.optimize()

        avg_price = float(np.mean(imp_price))
        P_ch_mpc, P_dis_mpc, P_imp_mpc, P_exp_mpc = mpc_dispatch(
            tot_gen_now, load_now, soc, imp_price[0], exp_price[0], avg_price, bat_cap
        )
        mpc_time = (_time.time() - t0) * 1000.0

        cost_mpc, carbon_mpc = _compute_cost_carbon(
            imp_price[0], exp_price[0], P_imp_mpc, P_exp_mpc, P_dis_mpc
        )

        mpc_results[cid] = {
            "city": cfg["name"],
            "cost_inr": round(cost_mpc, 2),
            "carbon_kg": round(carbon_mpc, 2),
            "import_kw": round(P_imp_mpc, 2),
            "export_kw": round(P_exp_mpc, 2),
            "charge_kw": round(P_ch_mpc, 2),
            "discharge_kw": round(P_dis_mpc, 2),
            "fitness": round(float(best_fit2), 2),
            "iterations": len(conv2),
            "computation_ms": round(mpc_time, 1),
        }
        mpc_total_cost += cost_mpc
        mpc_total_carbon += carbon_mpc
        mpc_total_time += mpc_time

        # Update city state with MPC dispatch outcome
        eta_ch = float(OPTIMIZATION_SETTINGS["battery_eta_ch"])
        eta_dis = float(OPTIMIZATION_SETTINGS["battery_eta_dis"])
        new_soc = soc + eta_ch * P_ch_mpc - P_dis_mpc / eta_dis
        city_states[cid]["soc_kwh"] = max(0.2 * bat_cap, min(0.9 * bat_cap, new_soc))
        city_states[cid]["last_pv_kw"] = pv_now
        city_states[cid]["last_wind_kw"] = wind_now
        city_states[cid]["last_thermal_kw"] = thermal_now
        city_states[cid]["last_load_kw"] = load_now
        city_states[cid]["last_import_kw"] = P_imp_mpc
        city_states[cid]["last_export_kw"] = P_exp_mpc
        city_states[cid]["surplus_kw"] = max(0.0, tot_gen_now - load_now)
        city_states[cid]["deficit_kw"] = max(0.0, load_now - tot_gen_now)

    trades = compute_p2p_trades(city_opt_results)

    iora_cost_saving = iora_total_cost - mpc_total_cost
    carbon_saving = iora_total_carbon - mpc_total_carbon

    return {
        "iora_only": {
            "per_city": iora_results,
            "total_cost_inr": round(iora_total_cost, 2),
            "total_carbon_kg": round(iora_total_carbon, 2),
            "total_computation_ms": round(iora_total_time, 1),
        },
        "iora_mpc": {
            "per_city": mpc_results,
            "total_cost_inr": round(mpc_total_cost, 2),
            "total_carbon_kg": round(mpc_total_carbon, 2),
            "total_computation_ms": round(mpc_total_time, 1),
        },
        "p2p_trades": trades,
        "comparison": {
            "cost_saving_inr": round(iora_cost_saving, 2),
            "carbon_saving_kg": round(carbon_saving, 2),
            "mpc_overhead_ms": round(mpc_total_time - iora_total_time, 1),
            "verdict": "IAROA+MPC" if mpc_total_cost <= iora_total_cost else "IAROA-Only",
            "verdict_reason": (
                f"IAROA+MPC saves ₹{abs(iora_cost_saving):.1f} with MPC real-time correction"
                if mpc_total_cost <= iora_total_cost
                else f"IAROA-Only is ₹{abs(iora_cost_saving):.1f} cheaper without MPC overhead"
            ),
        },
        "communication_links": get_communication_links(),
        "convergences": {cid: conv[-5:] for cid, conv in iora_convergences.items()},
        "timestamp": _time.strftime("%Y-%m-%d %H:%M:%S"),
    }


@app.post("/simulate-24h")
def simulate_24h(
    start_date: Optional[str] = Query(None),
    end_date: Optional[str] = Query(None)
) -> Dict[str, Any]:
    """Run a full 24-hour simulation using historical data and return hourly results."""
    if not isinstance(start_date, str) or not start_date:
        start_dt = datetime.now() - timedelta(days=2)
        start_date = start_dt.strftime("%Y-%m-%d")

    if not isinstance(end_date, str) or not end_date:
        dt = datetime.strptime(start_date, "%Y-%m-%d")
        end_date = (dt + timedelta(days=1)).strftime("%Y-%m-%d")

    H = 24
    simulation_results: List[Dict[str, Any]] = []

    # FIX: Independent SOC tracker for simulation (does not mutate global city_states)
    sim_socs: Dict[str, float] = {
        cid: float(CITIES[cid]["initial_soc_pct"]) * float(CITIES[cid]["bat_cap_kwh"])
        for cid in CITIES
    }

    for hour_idx in range(24):
        # FIX: Explicitly typed hour_results to prevent Any-indexing confusion
        iora_hour: Dict[str, Any] = {
            "per_city": {},
            "total_cost_inr": 0.0,
            "total_carbon_kg": 0.0,
            "total_computation_ms": 0.0
        }
        mpc_hour: Dict[str, Any] = {
            "per_city": {},
            "total_cost_inr": 0.0,
            "total_carbon_kg": 0.0,
            "total_computation_ms": 0.0
        }
        city_opt_res: Dict[str, Dict[str, float]] = {}

        for cid, cfg in CITIES.items():
            pv_fc, wind_fc, thermal_fc = generate_generation_forecasts(
                cid, H, start_hour=hour_idx, start_date=start_date, end_date=end_date
            )
            load_fc = generate_dynamic_load_forecast(
                cid, H, start_hour=hour_idx, start_date=start_date, end_date=end_date
            )
            imp_price, exp_price = get_city_pricing(cid, H, start_hour=hour_idx)

            soc = float(sim_socs[cid])
            bat_cap = float(cfg["bat_cap_kwh"])
            pv_cap = float(cfg["pv_capacity_kw"] + cfg["wind_capacity_kw"] + cfg["thermal_capacity_kw"])

            tot_gen_fc = [round(float(pv_fc[h] + wind_fc[h] + thermal_fc[h]), 2) for h in range(H)]

            pv_now = float(pv_fc[0])
            wind_now = float(wind_fc[0])
            thermal_now = float(thermal_fc[0])
            tot_gen_now = float(tot_gen_fc[0])
            load_now = float(load_fc[0])

            # FIX: Use hour_idx for weather array access, with bounds check
            weather = get_weather_data(cid, start_date=start_date, end_date=end_date)
            temps: List[float] = weather["temps"]
            winds: List[float] = weather["winds"]
            current_temp = round(temps[hour_idx % len(temps)], 1) if temps else 25.0
            current_wind_val = round(winds[hour_idx % len(winds)], 1) if winds else 5.0

            city_opt_res[cid] = {
                "pv_now": pv_now,
                "wind_now": wind_now,
                "thermal_now": thermal_now,
                "tot_gen_now": tot_gen_now,
                "load_now": load_now,
                "soc_pct": round(soc / bat_cap * 100.0, 1),
                "soc_kwh": soc,
                "current_temp_c": current_temp,
                "current_wind_mps": current_wind_val,
            }

            curr_imp_p = float(imp_price[0])
            curr_exp_p = float(exp_price[0])

            # ---- IAROA-ONLY ----
            ems = MicrogridEMS(tot_gen_fc, load_fc, imp_price, exp_price, soc, bat_cap, pv_cap)
            lb, ub = ems.get_bounds()
            optimizer = IAROA(ems.fitness_function, max_iter=15, lb=lb, ub=ub, n_agents=8)
            best_sol, best_fit, _ = optimizer.optimize()

            P_ch_iora = float(best_sol[0])
            P_dis_iora = float(best_sol[H])
            net_iora = load_now + P_ch_iora - tot_gen_now - P_dis_iora
            P_imp_iora = max(0.0, net_iora)
            P_exp_iora = max(0.0, -net_iora)

            cost_iora, carbon_iora = _compute_cost_carbon(
                curr_imp_p, curr_exp_p, P_imp_iora, P_exp_iora, P_dis_iora
            )
            comp_ms_iora = float(optimizer.time_taken * 1000.0)

            iora_hour["per_city"][cid] = {
                "city": cfg["name"],
                "cost_inr": round(cost_iora, 2),
                "carbon_kg": round(carbon_iora, 2),
                "import_kw": round(P_imp_iora, 2),
                "export_kw": round(P_exp_iora, 2),
                "computation_ms": round(comp_ms_iora, 1),
            }
            iora_hour["total_cost_inr"] = float(iora_hour["total_cost_inr"]) + cost_iora
            iora_hour["total_carbon_kg"] = float(iora_hour["total_carbon_kg"]) + carbon_iora
            iora_hour["total_computation_ms"] = float(iora_hour["total_computation_ms"]) + comp_ms_iora

            # ---- IAROA + MPC ----
            ems2 = MicrogridEMS(tot_gen_fc, load_fc, imp_price, exp_price, soc, bat_cap, pv_cap)
            lb2, ub2 = ems2.get_bounds()
            optimizer2 = IAROA(ems2.fitness_function, max_iter=15, lb=lb2, ub=ub2, n_agents=8)
            _, _, _ = optimizer2.optimize()

            avg_price = float(np.mean(imp_price))
            P_ch_mpc, P_dis_mpc, P_imp_mpc, P_exp_mpc = mpc_dispatch(
                tot_gen_now, load_now, soc, curr_imp_p, curr_exp_p, avg_price, bat_cap
            )
            comp_ms_mpc = float(optimizer2.time_taken * 1000.0)

            cost_mpc, carbon_mpc = _compute_cost_carbon(
                curr_imp_p, curr_exp_p, P_imp_mpc, P_exp_mpc, P_dis_mpc
            )

            mpc_hour["per_city"][cid] = {
                "city": cfg["name"],
                "cost_inr": round(cost_mpc, 2),
                "carbon_kg": round(carbon_mpc, 2),
                "import_kw": round(P_imp_mpc, 2),
                "export_kw": round(P_exp_mpc, 2),
                "computation_ms": round(comp_ms_mpc, 1),
            }
            mpc_hour["total_cost_inr"] = float(mpc_hour["total_cost_inr"]) + cost_mpc
            mpc_hour["total_carbon_kg"] = float(mpc_hour["total_carbon_kg"]) + carbon_mpc
            mpc_hour["total_computation_ms"] = float(mpc_hour["total_computation_ms"]) + comp_ms_mpc

            # FIX: Update simulation SOC (not live city_states)
            eta_ch = float(OPTIMIZATION_SETTINGS["battery_eta_ch"])
            eta_dis = float(OPTIMIZATION_SETTINGS["battery_eta_dis"])
            new_soc = soc + eta_ch * P_ch_mpc - P_dis_mpc / eta_dis
            sim_socs[cid] = max(0.2 * bat_cap, min(0.9 * bat_cap, new_soc))

        # P2P Trades for this hour
        p2p_trades = compute_p2p_trades(city_opt_res)

        # FIX: Round totals before appending
        iora_hour["total_cost_inr"] = round(float(iora_hour["total_cost_inr"]), 2)
        iora_hour["total_carbon_kg"] = round(float(iora_hour["total_carbon_kg"]), 2)
        iora_hour["total_computation_ms"] = round(float(iora_hour["total_computation_ms"]), 1)
        mpc_hour["total_cost_inr"] = round(float(mpc_hour["total_cost_inr"]), 2)
        mpc_hour["total_carbon_kg"] = round(float(mpc_hour["total_carbon_kg"]), 2)
        mpc_hour["total_computation_ms"] = round(float(mpc_hour["total_computation_ms"]), 1)

        simulation_results.append({
            "hour": hour_idx,
            "iora_only": iora_hour,
            "iora_mpc": mpc_hour,
            "p2p_trades_mpc": p2p_trades,
            "city_opt_results": city_opt_res,
        })

    return {"simulation": simulation_results}


@app.get("/comparison")
def get_comparison_summary() -> Dict[str, Any]:
    """Quick endpoint for comparison data without re-running optimization."""
    return {
        "cities": list(CITIES.keys()),
        "city_names": {cid: cfg["name"] for cid, cfg in CITIES.items()},
        "city_states": city_states,
        "communication_links": get_communication_links(),
        "topology": "full_mesh",
        "num_nodes": 5,
        "num_links": 10,
        "description": (
            "Decentralized 5-city microgrid with peer-to-peer energy trading. "
            "Each city runs IAROA metaheuristic and MPC dispatch independently."
        ),
    }