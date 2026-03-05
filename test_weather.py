import openmeteo_requests
import requests_cache
from retry_requests import retry
import pandas as pd
from datetime import datetime, timedelta

# Setup Open-Meteo client with cache and retry
cache_session = requests_cache.CachedSession('/tmp/.cache', expire_after=3600)
retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
openmeteo = openmeteo_requests.Client(session=retry_session)

def test_weather():
    # Chennai coordinates
    lat, lon = 13.0827, 80.2707
    
    # Yesterday (full day)
    start_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    end_date = (datetime.now() - timedelta(days=2)).strftime("%Y-%m-%d")
    
    print(f"Fetching weather for Chennai ({lat}, {lon}) for {start_date}...")
    
    url = "https://archive-api.open-meteo.com/v1/archive"
    hourly_vars = [
        "temperature_2m", "relative_humidity_2m", "apparent_temperature",
        "wind_speed_10m", "shortwave_radiation"
    ]
    params = {
        "latitude": lat,
        "longitude": lon,
        "start_date": start_date,
        "end_date": end_date,
        "hourly": hourly_vars
    }
    
    try:
        responses = openmeteo.weather_api(url, params=params)
        response = responses[0]
        print(f"Coordinates: {response.Latitude()}°N {response.Longitude()}°E")
        print(f"Elevation: {response.Elevation()} m")
        
        hourly = response.Hourly()
        
        # Display all 24 hours
        print("\nHourly Data for the Whole Day:")
        print(f"{'Hour':<6} | {'Temp':<6} | {'Humidity':<8} | {'Apparent':<8} | {'Wind':<6} | {'Solar':<6}")
        print("-" * 60)
        for i in range(24):
            vals = [hourly.Variables(j).ValuesAsNumpy()[i] for j in range(len(hourly_vars))]
            print(f"{i:02d}:00  | {vals[0]:<6.1f} | {vals[1]:<8.1f} | {vals[2]:<8.1f} | {vals[3]:<6.1f} | {vals[4]:<6.1f}")
        
        print("\nWeather API for Chennai is working properly!")
    except Exception as e:
        print(f"\nError: Weather API failed: {e}")

if __name__ == "__main__":
    test_weather()
