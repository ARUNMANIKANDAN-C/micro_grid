# Decentralized API — Variable & Data Reference

> **File:** `decentralized_api.py` (785 lines)  
> **Purpose:** 5-City Microgrid optimization API with IAROA + MPC dispatch and P2P energy trading.

---

## Classification Legend

| Tag | Meaning |
|-----|---------|
| 🔴 **HARDCODED** | Static constant — cannot change without editing source code |
| 🟡 **CONFIGURABLE** | Defined once at startup, could be made dynamic |
| 🟢 **DYNAMIC** | Computed at runtime from live data, APIs, or algorithms |
| 🔵 **EXTERNAL** | Fetched from an external API at runtime |

---

## 1. City Configuration — `CITIES` dict (Lines 27–108)

**🔴 HARDCODED** — All 5 cities are defined as static dictionaries.

| Variable | Type | Example (Delhi) | Description |
|----------|------|-----------------|-------------|
| `name` | `str` | `"Delhi"` | Display name |
| `lat` | `float` | `28.6139` | Latitude (used for weather API) |
| `lon` | `float` | `77.2090` | Longitude (used for weather API) |
| `pv_capacity_kw` | `float` | `150.0` | Max solar PV output capacity (kW) |
| `wind_capacity_kw` | `float` | `80.0` | Max wind turbine output capacity (kW) |
| `thermal_capacity_kw` | `float` | `100.0` | Max thermal generator output (kW) |
| `houses_count` | `int` | `120` | Number of residential houses in microgrid |
| `buildings_count` | `int` | `8` | Number of commercial buildings |
| `bat_cap_kwh` | `float` | `500.0` | Battery energy storage capacity (kWh) |
| `initial_soc_pct` | `float` | `0.55` | Starting battery state-of-charge (55%) |
| `peak_load_kw` | `float` | `25.0` | Peak load capacity (kW) |
| `grid_zone` | `str` | `"IN-NO"` | Indian grid zone identifier |
| `climate` | `str` | `"hot_arid"` | Climate classification label |
| `base_import_price` | `list[24]` | `[4,4,4,...,4]` | Hourly grid import price (₹/kWh), 24 values |
| `load_profile` | `list[24]` | `[3,2,2,...,3]` | Hourly load shape profile, 24 values |

### Per-City Capacity Summary

| City | PV (kW) | Wind (kW) | Thermal (kW) | Battery (kWh) | Houses | Buildings |
|------|---------|-----------|--------------|---------------|--------|-----------|
| Delhi | 150 | 80 | 100 | 500 | 120 | 8 |
| Mumbai | 120 | 150 | 80 | 450 | 150 | 12 |
| Chennai | 180 | 120 | 60 | 550 | 130 | 10 |
| Kolkata | 110 | 100 | 80 | 400 | 110 | 7 |
| Jaipur | 200 | 50 | 40 | 480 | 90 | 4 |

---

## 2. City State Tracker — `city_states` (Lines 113–134)

**🟢 DYNAMIC** — Initialized from `CITIES` config, then mutated by optimization runs.

| Variable | Type | Initial Value | Updated By |
|----------|------|---------------|------------|
| `soc_kwh` | `float` | `initial_soc_pct × bat_cap_kwh` | Optimization (line 618) |
| `last_pv_kw` | `float` | `0.0` | Optimization (line 622) |
| `last_wind_kw` | `float` | `0.0` | Optimization (line 623) |
| `last_thermal_kw` | `float` | `0.0` | Optimization (line 624) |
| `last_load_kw` | `float` | `0.0` | Optimization (line 625) |
| `last_import_kw` | `float` | `0.0` | Optimization (line 626) |
| `last_export_kw` | `float` | `0.0` | Optimization (line 627) |
| `last_charge_kw` | `float` | `0.0` | Not written (unused) |
| `last_discharge_kw` | `float` | `0.0` | Not written (unused) |
| `surplus_kw` | `float` | `0.0` | Optimization (line 628) |
| `deficit_kw` | `float` | `0.0` | Optimization (line 629) |

---

## 3. Weather Data — `get_weather_data()` (Lines 140–174)

### 🔵 EXTERNAL — Open-Meteo Archive API

| Variable | Source | Description |
|----------|--------|-------------|
| `temps` | API → `temperature_2m` | Hourly temperature (°C), 48 values |
| `winds` | API → `wind_speed_10m` | Hourly wind speed (m/s), 48 values |
| `solar` | API → `shortwave_radiation` | Hourly solar radiation (W/m²), 48 values |

**API URL pattern:**
```
https://archive-api.open-meteo.com/v1/archive
  ?latitude={lat}&longitude={lon}
  &start_date=2026-03-01&end_date=2026-03-02
  &hourly=temperature_2m,wind_speed_10m,shortwave_radiation
```

### 🔴 HARDCODED in weather function

| Variable | Value | Purpose |
|----------|-------|---------|
| `target_date_start` | `"2026-03-01"` | Simulation start date |
| `target_date_end` | `"2026-03-02"` | Simulation end date |
| Cache TTL | `3600` seconds | Re-fetch weather after 1 hour |
| API timeout | `5` seconds | HTTP request timeout |

### 🔴 HARDCODED Fallback (when API fails)

| Variable | Value | Purpose |
|----------|-------|---------|
| `base_tmp` | `25.0` °C | Base temperature for sine-wave simulation |
| Temp amplitude | `5.0` °C | Peak-to-peak temperature swing |
| Wind base | `15.0` m/s | Wind speed peak for sine simulation |
| Solar peak | `800` W/m² | Max solar radiation in fallback mode |

---

## 4. Generation Forecasts — `generate_generation_forecasts()` (Lines 176–196)

**🟢 DYNAMIC** — Computed from weather data × city capacities.

| Output | Formula | Source |
|--------|---------|--------|
| `pv` (solar) | `solar_radiation / 1000 × pv_capacity_kw` | 🔵 Weather API + 🔴 City config |
| `wind` | `wind_cap × (wind_speed / 15.0)³` — clamped to capacity | 🔵 Weather API + 🔴 City config |
| `thermal` | `thermal_cap × (0.8 + 0.2 × random)` | 🔴 City config + random |

### 🔴 HARDCODED Constants in Generation

| Constant | Value | Purpose |
|----------|-------|---------|
| Solar normalization | `1000.0` W/m² | Standard Test Condition (STC) reference |
| Wind reference speed | `15.0` m/s | Rated wind speed for cubic power curve |
| Wind power exponent | `3` (cubic) | Power curve: P ∝ v³ |
| Thermal load factor range | `0.8 – 1.0` | Randomized steady-state output band |

---

## 5. Load Forecast — `generate_dynamic_load_forecast()` (Lines 198–229)

**🟢 DYNAMIC** — Computed from weather temperature + city config profiles.

### 🔴 HARDCODED Constants in Load Model

| Constant | Value | Purpose |
|----------|-------|---------|
| `avg_house_base` | `0.5` kW | Average base load per house |
| `avg_building_base` | `10.0` kW | Average base load per commercial building |
| HVAC heat threshold | `30` °C | Above this → increase cooling load |
| HVAC cold threshold | `15` °C | Below this → increase heating load |
| Heat HVAC factor | `0.05` per °C above 30 | Cooling load scaling coefficient |
| Cold HVAC factor | `0.04` per °C below 15 | Heating load scaling coefficient |
| Profile normalization | `/ 10.0` | `load_profile` values divided by 10 |

### Load Formula
```
load = (houses × 0.5 + buildings × 10.0) × hvac_factor × (load_profile[hour] / 10.0)
```

---

## 6. Pricing — `get_city_pricing()` (Lines 232–238)

| Variable | Source | Description |
|----------|--------|-------------|
| Import price | 🔴 `base_import_price` (24h array) | Grid electricity buy price (₹/kWh) |
| Export price | 🟢 Computed: `import × 0.5` | Grid sell-back price = 50% of import |

### 🔴 HARDCODED

| Constant | Value | Purpose |
|----------|-------|---------|
| Export ratio | `0.5` | Export price = 50% of import price |

---

## 7. IAROA Optimizer — `MicrogridEMS` Class (Lines 244–315)

### 🔴 HARDCODED Optimizer Parameters

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `soc_min` | `0.2 × bat_cap` | Min allowed SOC (20%) |
| `soc_max` | `0.9 × bat_cap` | Max allowed SOC (90%) |
| `p_bat_max` | `bat_cap × 0.25` | Max charge/discharge rate (C/4) |
| `eta_ch` | `0.95` | Battery charging efficiency (95%) |
| `eta_dis` | `0.95` | Battery discharging efficiency (95%) |
| `dt` | `1.0` hour | Time step duration |
| `deg_cost_per_kwh` | `₹0.50` | Battery degradation cost per kWh discharged |
| `peak_demand_charge` | `₹150.0` | Demand charge per kW of peak import |
| `grid_emission_factor` | `0.5` kg CO₂/kWh | Carbon emissions per kWh imported |
| `carbon_tax` | `₹2.0` per kg CO₂ | Carbon tax rate |

### 🔴 HARDCODED Penalty Constants (fitness function)

| Constant | Value | Purpose |
|----------|-------|---------|
| `PF` (Penalty Factor) | `1e6` | Large penalty for constraint violations |
| Simultaneous ch/dis penalty | `1e4` per kW² | Prevents charging and discharging at same time |
| Import cap | `50` kW | Max grid import before penalty |
| Export cap | `50` kW | Max grid export before penalty |

### 🔴 HARDCODED IAROA Algorithm Params

**Live optimization** (line 553):
| Parameter | Value |
|-----------|-------|
| `max_iter` | `30` |
| `n_agents` | `12` |

**24h simulation** (line 716):
| Parameter | Value |
|-----------|-------|
| `max_iter` | `15` (reduced for speed) |
| `n_agents` | `8` (reduced for speed) |

### IAROA Algorithm Constants (line 333)

| Constant | Value | Purpose |
|----------|-------|---------|
|`A` coefficient | `4` | Exploration-exploitation balance multiplier |
| Min random floor | `1e-10` | Prevents log(0) in parameter `A` |

---

## 8. MPC Dispatch — `mpc_dispatch()` (Lines 362–391)

### 🔴 HARDCODED Constants (duplicated from MicrogridEMS)

| Parameter | Value | Purpose |
|-----------|-------|---------|
| `SOC_MIN` | `0.2 × bat_cap` | Min allowed SOC |
| `SOC_MAX` | `0.9 × bat_cap` | Max allowed SOC |
| `P_BAT_MAX` | `bat_cap × 0.25` | Max battery power (C/4) |
| `ETA_CH` | `0.95` | Charging efficiency |
| `ETA_DIS` | `0.95` | Discharging efficiency |
| `DEG_COST` | `₹0.50` | Degradation cost per kWh |
| SOC headroom | `2.0` kWh | Buffer before allowing discharge/charge |
| Cheap price threshold | `avg_price × 0.85` | Price below 85% of average triggers charging |

### MPC Decision Logic
```
IF price > avg_price AND net_load > 0 AND soc > SOC_MIN + 2:
    → DISCHARGE battery (save expensive import)
ELIF price < avg_price × 0.85 AND soc < SOC_MAX - 2 AND net_load <= 0:
    → CHARGE battery (use cheap surplus)
ELSE:
    → No battery action
```

---

## 9. P2P Trading — `compute_p2p_trades()` (Lines 397–429)

### 🔴 HARDCODED Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| Surplus threshold | `0.5` kW | Min net surplus to be eligible seller |
| Deficit threshold | `0.5` kW | Min net deficit to be eligible buyer |
| Min trade quantity | `0.1` kW | Stop trading below this amount |
| P2P trade price | `₹5.0` per kW | Fixed midpoint price for all P2P trades |

### Trading Algorithm
- **Greedy matching**: largest deficit city matched first with largest surplus city
- **No transmission losses** modeled
- **No distance-based pricing** — flat ₹5/kW

---

## 10. Communication Links — `get_communication_links()` (Lines 435–447)

### 🔴 HARDCODED / 🟢 SEMI-RANDOM

| Property | Source | Description |
|----------|--------|-------------|
| Topology | 🔴 Full mesh | All 10 possible links (5 choose 2) |
| `latency_ms` | 🟢 Random `uniform(5, 25)` | Simulated latency per call |
| `status` | 🔴 Always `"active"` | No failure simulation |

---

## 11. Cost & Carbon Calculations

### 🔴 HARDCODED Formulas (used in both IAROA and MPC paths)

| Metric | Formula | Units |
|--------|---------|-------|
| Energy cost | `import_price × P_imp − export_price × P_exp + 0.5 × P_dis` | ₹ |
| Carbon emissions | `0.5 × P_imp` | kg CO₂ |

> **Note:** The `0.5` in carbon emissions matches `grid_emission_factor` in `MicrogridEMS`, and the `0.5` in cost matches `deg_cost_per_kwh`. These are duplicated as literal values.

---

## 12. API Endpoint Parameters

### `/cities` (GET)
No parameters. Returns current state for all 5 cities.

### `/optimize-decentralized` (POST)
No request body. Uses current system clock hour and `city_states`.

### `/simulate-24h` (POST)
No request body. Runs all 24 hours independently from initial SOCs.

### `/comparison` (GET)
No parameters. Returns cached topology metadata.

---

## Summary: Hardcoded vs Dynamic

### 🔴 Hardcoded Data (cannot change at runtime)
- All 5 city configurations (capacity, location, pricing, load profiles)
- Battery parameters (SOC limits, efficiency, degradation cost)
- Grid emission factor, carbon tax, demand charge
- IAROA algorithm settings (iterations, agents, exploration coefficient)
- MPC decision thresholds
- P2P trading price and matching logic
- Simulation dates (2026-03-01 to 2026-03-02)
- Load model coefficients (HVAC factors, base loads)

### 🟢 Dynamic Data (changes each run)
- Weather data (temperature, wind, solar) — from Open-Meteo API
- Generation forecasts (PV, wind, thermal) — computed from weather
- Load forecasts — computed from weather + config profiles
- Battery SOC — updated after each optimization
- P2P trade matching — depends on surplus/deficit each hour
- IAROA optimization results — stochastic (different each run)
- Communication link latencies — randomized each call

### 🔵 External Data Sources
| Source | Data | Cache TTL |
|--------|------|-----------|
| Open-Meteo Archive API | Temperature, wind speed, solar radiation | 1 hour |
