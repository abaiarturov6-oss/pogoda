const form = document.querySelector('#search-form');
const cityInput = document.querySelector('#city-input');
const statusLine = document.querySelector('#status-line');
const hourlyList = document.querySelector('#hourly-list');
const weekList = document.querySelector('#week-list');
const favoriteButton = document.querySelector('#favorite-button');
const unitToggle = document.querySelector('#unit-toggle');
const installButton = document.querySelector('#install-button');
const installHint = document.querySelector('#install-hint');

let activeCity = 'Ысык-Көл';
let weatherData = null;
let isFahrenheit = false;
let favorites = readFavorites();
let installPrompt = null;

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const city = cityInput.value.trim();
  if (!city) { cityInput.focus(); return; }
  await loadWeather(city);
});

unitToggle.addEventListener('click', () => {
  isFahrenheit = !isFahrenheit;
  unitToggle.innerHTML = isFahrenheit
    ? '<span>°C</span><span class="unit-active">°F</span>'
    : '<span class="unit-active">°C</span><span>°F</span>';
  renderWeather();
});

favoriteButton.addEventListener('click', () => {
  const existing = favorites.find((item) => item.city.toLocaleLowerCase() === activeCity.toLocaleLowerCase());
  if (existing) favorites = favorites.filter((item) => item.city.toLocaleLowerCase() !== activeCity.toLocaleLowerCase());
  else favorites.push({ city: activeCity, temp: weatherData?.current.temperature_2m ?? null });
  writeFavorites();
  renderFavorites();
  if (weatherData) updatePlace(weatherData.place);
});

document.querySelector('#locate-button').addEventListener('click', () => {
  if (!navigator.geolocation) {
    showStatus('Браузер не поддерживает определение местоположения.');
    return;
  }
  showStatus('Определяем ваше местоположение…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => loadWeather('', coords.latitude, coords.longitude),
    (error) => {
      if (error.code === error.PERMISSION_DENIED) showStatus('Разрешите браузеру доступ к местоположению, чтобы узнать погоду рядом с вами.');
      else if (error.code === error.POSITION_UNAVAILABLE) showStatus('Не удалось определить местоположение устройства.');
      else showStatus('Поиск местоположения занял слишком много времени. Попробуйте ещё раз.');
    },
    { enableHighAccuracy: true, timeout: 20000, maximumAge: 300000 }
  );
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});

installButton.addEventListener('click', async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  installHint.hidden = false;
  installHint.textContent = /iphone|ipad|ipod/i.test(navigator.userAgent)
    ? 'Чтобы установить сайт на iPhone: нажмите «Поделиться» в Safari, затем «На экран Домой». '
    : 'Откройте меню браузера и выберите «Установить приложение» или «Добавить на главный экран».';
});

window.addEventListener('appinstalled', () => {
  installHint.hidden = false;
  installHint.textContent = 'Погода установлена на телефон.';
  installButton.hidden = true;
});

async function requestJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить прогноз.');
  return data;
}

async function resolvePlace(city) {
  const normalized = city.toLocaleLowerCase('ru')
    .replaceAll('ё', 'е')
    .replaceAll('ө', 'о')
    .replace(/[^\p{L}\p{N}]/gu, '');
  const issykKulAliases = ['ыссыккол', 'ысыккол', 'иссыккуль', 'иссыккул', 'issykul', 'issykkul', 'issykul'];
  const isIssykKul = issykKulAliases.includes(normalized);
  const searchName = isIssykKul ? 'Cholpon-Ata' : city;
  const geocode = async (name, countryCode, language) => {
    const params = new URLSearchParams({ name, count: '1', language, format: 'json' });
    if (countryCode) params.set('countryCode', countryCode);
    const result = await requestJson(`https://geocoding-api.open-meteo.com/v1/search?${params}`);
    return result.results?.[0] || null;
  };

  let place = await geocode(searchName, null, 'ru');
  if ((!place || place.country_code !== 'KG') && !isIssykKul) {
    const localPlace = await geocode(transliterate(searchName), 'KG', 'en');
    if (localPlace) place = localPlace;
  }
  if (!place) throw new Error('Город не найден. Проверьте название и попробуйте снова.');
  if (isIssykKul) {
    place.name = 'Ысык-Көл';
    place.admin1 = 'Чолпон-Ата';
    place.country = 'Кыргызстан';
    place.country_code = 'KG';
  }
  return place;
}

function transliterate(value) {
  const letters = {
    а:'a', б:'b', в:'v', г:'g', д:'d', е:'e', ё:'yo', ж:'zh', з:'z', и:'i', й:'y', к:'k', л:'l', м:'m', н:'n', ң:'ng', о:'o', ө:'o', п:'p', р:'r', с:'s', т:'t', у:'u', ү:'u', ф:'f', х:'kh', ц:'ts', ч:'ch', ш:'sh', щ:'shch', ъ:'', ы:'y', ь:'', э:'e', ю:'yu', я:'ya'
  };
  return [...value.toLocaleLowerCase('ru')].map((letter) => letters[letter] ?? letter).join('');
}

async function fetchForecast(place) {
  const params = new URLSearchParams({
    latitude: String(place.latitude),
    longitude: String(place.longitude),
    current: 'temperature_2m,relative_humidity_2m,apparent_temperature,is_day,precipitation,weather_code,cloud_cover,wind_speed_10m',
    hourly: 'temperature_2m,precipitation_probability,weather_code',
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max',
    timezone: 'auto',
    forecast_days: '7'
  });
  const forecast = await requestJson(`https://api.open-meteo.com/v1/forecast?${params}`);
  return { place, current: forecast.current, hourly: forecast.hourly, daily: forecast.daily };
}

async function loadWeather(city, latitude, longitude) {
  form.classList.add('loading');
  showStatus('Загружаем прогноз погоды…');
  try {
    const place = latitude !== undefined
      ? { name: 'Моё местоположение', latitude, longitude, country: '' }
      : await resolvePlace(city);
    weatherData = await fetchForecast(place);
    activeCity = place.name === 'Ысык-Көл' ? 'Ысык-Көл' : city || place.name;
    updatePlace(weatherData.place);
    renderWeather();
    showStatus('');
  } catch (error) {
    showStatus(error.message);
  } finally {
    form.classList.remove('loading');
  }
}

function updatePlace(place) {
  document.querySelector('#place-title').textContent = activeCity;
  const details = place.name === 'Моё местоположение'
    ? 'Погода рядом с вами'
    : [place.admin1, place.country].filter(Boolean).join(' · ');
  document.querySelector('#place-subtitle').textContent = details || 'Прогноз погоды';
  document.querySelector('#updated-label').textContent = `Обновлено ${formatTime(weatherData.current.time)}`;
  favoriteButton.classList.toggle('active', favorites.some((item) => item.city.toLocaleLowerCase() === activeCity.toLocaleLowerCase()));
  favoriteButton.textContent = favoriteButton.classList.contains('active') ? '♥' : '♡';
}

function renderWeather() {
  if (!weatherData) return;
  const { current, hourly, daily } = weatherData;
  document.querySelector('#current-temp').textContent = Math.round(convertTemp(current.temperature_2m));
  document.querySelector('.current-temp sup').textContent = `°${isFahrenheit ? 'F' : 'C'}`;
  document.querySelector('#current-condition').textContent = describeWeather(current.weather_code);
  document.querySelector('#current-icon').textContent = weatherIcon(current.weather_code, current.is_day);
  document.querySelector('#feels-like').textContent = `${Math.round(convertTemp(current.apparent_temperature))}°${isFahrenheit ? 'F' : 'C'}`;
  document.querySelector('#wind-value').textContent = `${Math.round(current.wind_speed_10m)} км/ч`;
  document.querySelector('#humidity-value').textContent = `${Math.round(current.relative_humidity_2m)}%`;
  document.querySelector('#rain-value').textContent = `${Number(current.precipitation).toLocaleString('ru-RU')} мм`;
  document.querySelector('#sunrise-time').textContent = formatTime(daily.sunrise[0]);
  document.querySelector('#sunset-time').textContent = formatTime(daily.sunset[0]);
  renderHourly(hourly, current.time);
  renderWeek(daily);
  renderFavorites();
}

function renderHourly(hourly, currentTime) {
  let start = hourly.time.findIndex((time) => time >= currentTime.slice(0, 13));
  if (start < 0) start = 0;
  const items = hourly.time.slice(start, start + 12).map((time, offset) => {
    const index = start + offset;
    const label = offset === 0 ? 'Сейчас' : formatTime(time);
    const rain = hourly.precipitation_probability[index];
    return `<div class="hour-item"><span class="hour-time">${label}</span><span class="hour-icon">${weatherIcon(hourly.weather_code[index], 1)}</span><strong class="hour-temp">${Math.round(convertTemp(hourly.temperature_2m[index]))}°</strong><span class="hour-rain">${rain ? `${Math.round(rain)}% дождя` : ''}</span></div>`;
  });
  hourlyList.innerHTML = items.join('');
}

function renderWeek(daily) {
  weekList.innerHTML = daily.time.map((date, index) => {
    const label = index === 0 ? 'Сегодня' : new Intl.DateTimeFormat('ru-RU', { weekday: 'short' }).format(new Date(`${date}T12:00:00`));
    const summary = daily.precipitation_probability_max[index] > 0 ? `Дождь ${Math.round(daily.precipitation_probability_max[index])}%` : 'Без осадков';
    return `<div class="day-row"><span class="day-name">${capitalize(label)}</span><span class="day-icon">${weatherIcon(daily.weather_code[index], 1)}</span><span class="day-summary">${summary}</span><span class="day-temps"><strong>${Math.round(convertTemp(daily.temperature_2m_max[index]))}°</strong><span>${Math.round(convertTemp(daily.temperature_2m_min[index]))}°</span></span></div>`;
  }).join('');
}

function renderFavorites() {
  if (!favorites.length) {
    document.querySelector('#saved-list').innerHTML = '<span class="empty-saved">Пока нет сохранённых городов</span>';
    return;
  }
  document.querySelector('#saved-list').innerHTML = favorites.map((item, index) => {
    const temp = item.temp === null ? '' : `<strong class="saved-city-temp">${Math.round(convertTemp(item.temp))}°</strong>`;
    return `<div class="saved-city"><button class="saved-city-open" type="button" data-city-index="${index}">${escapeHtml(item.city)} ${temp}</button><button class="saved-remove" type="button" data-remove-index="${index}" aria-label="Удалить ${escapeHtml(item.city)}">×</button></div>`;
  }).join('');
  document.querySelectorAll('.saved-city-open').forEach((button) => button.addEventListener('click', () => loadWeather(favorites[Number(button.dataset.cityIndex)].city)));
  document.querySelectorAll('.saved-remove').forEach((button) => button.addEventListener('click', () => {
    favorites.splice(Number(button.dataset.removeIndex), 1);
    writeFavorites();
    renderFavorites();
    updatePlace(weatherData.place);
  }));
}

function readFavorites() {
  try {
    const value = JSON.parse(localStorage.getItem('weather-favorites') || '[]');
    return value.map((item) => typeof item === 'string' ? { city: item, temp: null } : item);
  } catch { return []; }
}

function writeFavorites() {
  localStorage.setItem('weather-favorites', JSON.stringify(favorites));
}

function convertTemp(celsius) {
  return isFahrenheit ? celsius * 9 / 5 + 32 : celsius;
}

function formatTime(value) {
  if (!value) return '—';
  const dateTime = value.includes('T') ? value.slice(11, 16) : value;
  return dateTime;
}

function describeWeather(code) {
  if (code === 0) return 'Ясно';
  if (code <= 2) return 'Переменная облачность';
  if (code === 3) return 'Облачно';
  if (code < 50) return 'Туман';
  if (code < 60) return 'Морось';
  if (code < 70) return 'Дождь';
  if (code < 80) return 'Снег';
  if (code < 90) return 'Ливень';
  return 'Гроза';
}

function weatherIcon(code, isDay = 1) {
  if (code === 0) return isDay ? '☀️' : '🌙';
  if (code <= 2) return '🌤️';
  if (code === 3) return '☁️';
  if (code < 50) return '🌫️';
  if (code < 70) return '🌧️';
  if (code < 80) return '❄️';
  return '⛈️';
}

function capitalize(value) {
  return value.charAt(0).toLocaleUpperCase() + value.slice(1);
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
}

function showStatus(message) {
  statusLine.textContent = message;
}

renderFavorites();
loadWeather(activeCity);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) {
  installButton.hidden = true;
}
