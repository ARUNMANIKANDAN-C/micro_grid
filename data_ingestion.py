import numpy as np

import requests

def fetch_solcast_forecast(api_key=None, T=24, site_id="YOUR_SITE_ID"):
    """
    Fetches PV forecast from Solcast API.
    Get your API Key at: https://solcast.com/
    """
    if api_key:
        print("Fetching LIVE Solcast data...")
        try:
            url = f"https://api.solcast.com.au/rooftop_sites/{site_id}/forecasts?format=json"
            headers = {"Authorization": f"Bearer {api_key}"}
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            # Solcast returns 30-min intervals by default. We extract the 'pv_estimate' 
            # and slice/resample it to match our 'T' hourly horizon.
            forecasts = data.get("forecasts", [])
            pv_fcst = [f["pv_estimate"] for f in forecasts[:T*2:2]] # Simplistic hourly downsample
            
            # Pad if Solcast returned fewer hours than requested
            while len(pv_fcst) < T:
                pv_fcst.append(pv_fcst[-1] if pv_fcst else 0.0)
                
            return pv_fcst[:T]
            
        except requests.exceptions.RequestException as e:
            print(f"Solcast API Error: {e}. Falling back to mock data.")
            # Fall through to mock logic below...

    # Mock Solcast Forecast (Bell curve over 24h, peaking at noon)
    t = np.linspace(0, 24, T)
    pv_fcst = 10.0 * np.exp(-0.5 * ((t - 12) / 2.5) ** 2)
    pv_fcst = np.clip(pv_fcst, 0, 10.0)
    # Add 5% forecast noise
    pv_fcst *= (1 + 0.05 * np.random.randn(T))
    return [float(x) for x in pv_fcst]

def fetch_openei_load_profile(api_key=None, T=24, dataset_uid="YOUR_DATASET_ID"):
    """
    Fetches commercial load profile from OpenEI / NREL API.
    Get your API Key at: https://developer.nrel.gov/signup/
    """
    if api_key:
        print("Fetching LIVE OpenEI building load...")
        try:
            # Example NREL/OpenEI API endpoint for building load profiles
            url = f"https://developer.nrel.gov/api/building_profiles/v1?api_key={api_key}&id={dataset_uid}"
            response = requests.get(url, timeout=10)
            response.raise_for_status()
            data = response.json()
            
            # Extract the load array (format depends on the specific NREL dataset chosen)
            # This is a generic representation:
            load_fcst = data.get("hourly_load_kw", [])
            
            # Pad or truncate to match 'T'
            while len(load_fcst) < T:
                 load_fcst.append(load_fcst[-1] if load_fcst else 0.0)
                 
            return load_fcst[:T]
            
        except requests.exceptions.RequestException as e:
            print(f"OpenEI API Error: {e}. Falling back to mock data.")
            # Fall through to mock logic below...

    # Mock OpenEI Commercial Office Load Profile (peaks during work hours)
    base_load = np.array([2,2,2,3,4,6,8,12,15,18,20,22,21,19,16,14,10,8,6,5,4,3,2,2])
    if T != 24:
        base_load = np.interp(np.linspace(0, 24, T), np.arange(24), base_load)
    # Add 5% forecast noise
    load_fcst = base_load * (1 + 0.10 * np.random.randn(T))
    return [float(x) for x in load_fcst]

def get_tou_pricing(T=24):
    """ Returns standard Time-Of-Use pricing (INR/kWh) for Import and Export """
    # Realistic Indian commercial TOU tariff (₹/kWh)
    # Off-peak (night): ₹4-5 | Normal: ₹6-8 | Peak (evening): ₹10-12
    import_price = np.array([4,4,4,4,5,5,6,7,8,9,10,10,9,8,7,6,8,10,12,10,7,6,5,4], dtype=float)
    if T != 24:
        import_price = np.interp(np.linspace(0, 24, T), np.arange(24), import_price)
    export_price = import_price * 0.5  # Net metering feed-in tariff
    return import_price.tolist(), export_price.tolist()

if __name__ == "__main__":
    # Test
    pv = fetch_solcast_forecast()
    load = fetch_openei_load_profile()
    imp, exp = get_tou_pricing()
    print(f"Sample PV Forecast shape: {len(pv)}")
    print(f"Sample Load Forecast shape: {len(load)}")
