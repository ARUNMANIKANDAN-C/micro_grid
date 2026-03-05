import openmeteo_requests
import requests_cache
from retry_requests import retry
import pandas as pd
from datetime import datetime

# Setup Open-Meteo client with cache and retry
cache_session = requests_cache.CachedSession('/tmp/.cache', expire_after=3600)
retry_session = retry(cache_session, retries=5, backoff_factor=0.2)
openmeteo = openmeteo_requests.Client(session=retry_session)


def test_weather_today():
    # Chennai coordinates
    lat, lon = 13.0827, 80.2707
    
    today = datetime.now().strftime("%Y-%m-%d")

    print(f"Fetching today's weather for Chennai ({lat}, {lon}) - {today}")

    url = "https://api.open-meteo.com/v1/forecast"

    hourly_vars = [
        "temperature_2m",
        "relative_humidity_2m",
        "apparent_temperature",
        "wind_speed_10m",
        "shortwave_radiation"
    ]

    params = {
        "latitude": lat,
        "longitude": lon,
        "hourly": hourly_vars,
        "timezone": "auto"
    }

    try:
        responses = openmeteo.weather_api(url, params=params)
        response = responses[0]

        print(f"Coordinates: {response.Latitude()}°N {response.Longitude()}°E")
        print(f"Elevation: {response.Elevation()} m")

        hourly = response.Hourly()

        print("\nToday's Hourly Weather:")
        print(f"{'Hour':<6} | {'Temp':<6} | {'Humidity':<8} | {'Apparent':<8} | {'Wind':<6} | {'Solar':<6}")
        print("-"*60)

        for i in range(24):
            vals = [hourly.Variables(j).ValuesAsNumpy()[i] for j in range(len(hourly_vars))]
            print(f"{i:02d}:00  | {vals[0]:<6.1f} | {vals[1]:<8.1f} | {vals[2]:<8.1f} | {vals[3]:<6.1f} | {vals[4]:<6.1f}")

        print("\nToday's Weather API is working correctly!")

    except Exception as e:
        print(f"\nError: Weather API failed: {e}")


if __name__ == "__main__":
    test_weather_today()