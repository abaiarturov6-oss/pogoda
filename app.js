const form = document.querySelector('#search-form');
const cityInput = document.querySelector('#city-input');
const statusLine = document.querySelector('#status-line');
const hourlyList = document.querySelector('#hourly-list');
const weekList = document.querySelector('#week-list');
const favoriteButton = document.querySelector('#favorite-button');
const unitToggle = document.querySelector('#unit-toggle');

let activeCity = 'Ысык-Көл';
let weatherData = null;
let isFahrenheit = false;
let favorites = readFavorites();

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
    () => showStatus('Не удалось получить местоположение. Разрешите доступ к геолокации.'),
    { timeout: 12000, maximumAge: 300000 }
  );
});

async function requestJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось загрузить прогноз.');
  return data;
}

async function loadWeather(city, latitude, longitude) {
  form.classList.add('loading');
  showStatus('Загружаем прогноз погоды…');
  try {
    const params = latitude !== undefined
      ? new URLSearchParams({ latitude: String(latitude), longitude: String(longitude) })
      : new URLSearchParams({ city });
    weatherData = await requestJson(`/api/weather?${params}`);
    activeCity = weatherData.place.name === 'Ысык-Көл'
      ? 'Ысык-Көл'
      : city || weatherData.place.name;
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
  const details = [place.admin1, place.country].filter(Boolean).join(' · ');
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
