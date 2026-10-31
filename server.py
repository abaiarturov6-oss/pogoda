"""Локальный веб-сервер и API погоды. Запуск: python server.py"""

from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8000


class WeatherHandler(SimpleHTTPRequestHandler):
    """Отдаёт страницу сайта и проксирует запросы к Open-Meteo."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/map":
            self.handle_map()
            return
        if parsed.path == "/api/weather":
            query = parse_qs(parsed.query)
            self.handle_weather(
                query.get("city", [""])[0].strip(),
                query.get("latitude", [None])[0],
                query.get("longitude", [None])[0],
                query.get("countryCode", [None])[0],
            )
            return
        if parsed.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def handle_map(self):
        # A country-wide grid keeps the temperature layer useful beyond Issyk-Kul.
        latitudes = [39.05 + row * 0.525 for row in range(9)]
        longitudes = [68.9 + column * 1.26 for column in range(10)]
        points = [(lat, lon) for lat in latitudes for lon in longitudes]
        params = urlencode({
            "latitude": ",".join(f"{lat:.3f}" for lat, _ in points),
            "longitude": ",".join(f"{lon:.3f}" for _, lon in points),
            "hourly": "temperature_2m,precipitation_probability,wind_speed_10m,pressure_msl",
            "timezone": "Asia/Bishkek",
            "forecast_days": 2,
        })
        try:
            result = self.fetch_json(f"https://api.open-meteo.com/v1/forecast?{params}")
            locations = result if isinstance(result, list) else [result]
            grid = []
            for location in locations:
                hourly = location.get("hourly", {})
                grid.append({
                    "latitude": location["latitude"],
                    "longitude": location["longitude"],
                    "temperature": hourly.get("temperature_2m", []),
                    "precipitation": hourly.get("precipitation_probability", []),
                    "wind": hourly.get("wind_speed_10m", []),
                    "pressure": hourly.get("pressure_msl", []),
                })
            self.send_json(200, {"time": locations[0]["hourly"]["time"], "grid": grid})
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError, IndexError) as error:
            print(f"Map forecast failed: {error}")
            self.send_json(502, {"error": "Не удалось загрузить карту погоды."})

    def handle_weather(self, city, latitude=None, longitude=None, country_code=None):
        normalized_city = " ".join(
            city.casefold().replace("ё", "е").replace("–", "-").replace("‑", "-").split()
        ).replace("-", " ")
        issyk_kul_names = {
            "ыссык кол", "ысык кол", "ыссык көл", "ысык көл", "иссык куль", "иссык кул", "иссык көл",
            "issyk kul", "issyk köl", "issyk kul lake"
        }
        is_issyk_kul = normalized_city in issyk_kul_names
        if is_issyk_kul:
            country_code = "KG"

        if latitude is not None and longitude is not None:
            try:
                latitude, longitude = float(latitude), float(longitude)
            except ValueError:
                self.send_json(400, {"error": "Некорректные координаты."})
                return
            place = {"name": "Моё местоположение", "latitude": latitude, "longitude": longitude}
        elif not city:
            self.send_json(400, {"error": "Введите название города."})
            return
        else:
            try:
                search_city = "Cholpon-Ata" if is_issyk_kul else city
                geocoding_params = {"name": search_city, "count": 1, "language": "ru", "format": "json"}
                if country_code:
                    geocoding_params["countryCode"] = country_code.upper()
                query = urlencode(geocoding_params)
                geocoding = self.fetch_json(f"https://geocoding-api.open-meteo.com/v1/search?{query}")
                place = (geocoding.get("results") or [None])[0]
                if not country_code and (not place or place.get("country_code") != "KG"):
                    local_names = [self.transliterate(search_city)]
                    for local_name in dict.fromkeys(local_names):
                        if not local_name or local_name.casefold() == search_city.casefold():
                            continue
                        local_params = {"name": local_name, "count": 1, "language": "en", "format": "json", "countryCode": "KG"}
                        local_query = urlencode(local_params)
                        local_geocoding = self.fetch_json(f"https://geocoding-api.open-meteo.com/v1/search?{local_query}")
                        local_place = (local_geocoding.get("results") or [None])[0]
                        if local_place:
                            place = local_place
                            break
                if place is None:
                    self.send_json(404, {"error": "Город не найден. Проверьте название и попробуйте снова."})
                    return
                if is_issyk_kul:
                    # Показываем прогноз для Чолпон-Аты, города на северном берегу озера.
                    place["name"] = "Ысык-Көл"
                    place["admin1"] = "Чолпон-Ата"
                    place["country"] = "Кыргызстан"
            except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as error:
                print(f"Geocoding failed: {error}")
                self.send_json(502, {"error": "Не удалось найти город. Проверьте интернет и попробуйте позже."})
                return

        try:
            params = urlencode({
                "latitude": place["latitude"],
                "longitude": place["longitude"],
                "current": "temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m",
                "hourly": "temperature_2m,precipitation_probability,weather_code",
                "daily": "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max",
                "timezone": "auto",
                "forecast_days": 7,
            })
            forecast = self.fetch_json(f"https://api.open-meteo.com/v1/forecast?{params}")
            self.send_json(200, {"place": place, "current": forecast["current"], "hourly": forecast["hourly"], "daily": forecast["daily"]})
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError, KeyError) as error:
            print(f"Weather request failed: {error}")
            self.send_json(502, {"error": "Не удалось загрузить прогноз. Проверьте интернет и попробуйте позже."})

    @staticmethod
    def fetch_json(url):
        request = Request(url, headers={"User-Agent": "WeatherSite/1.0"})
        with urlopen(request, timeout=12) as response:
            return json.loads(response.read().decode("utf-8"))

    @staticmethod
    def transliterate(value):
        letters = {
            "а": "a", "б": "b", "в": "v", "г": "g", "д": "d", "е": "e", "ё": "yo",
            "ж": "zh", "з": "z", "и": "i", "й": "y", "к": "k", "л": "l", "м": "m",
            "н": "n", "ң": "ng", "о": "o", "ө": "o", "п": "p", "р": "r", "с": "s",
            "т": "t", "у": "u", "ү": "u", "ф": "f", "х": "kh", "ц": "ts", "ч": "ch",
            "ш": "sh", "щ": "shch", "ъ": "", "ы": "y", "ь": "", "э": "e", "ю": "yu", "я": "ya",
        }
        return "".join(letters.get(letter, letter) for letter in value.casefold())

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


if __name__ == "__main__":
    server = ThreadingHTTPServer((HOST, PORT), WeatherHandler)
    print(f"Site running at http://{HOST}:{PORT}")
    print("Stop the server with Ctrl+C")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nServer stopped.")
    finally:
        server.server_close()
