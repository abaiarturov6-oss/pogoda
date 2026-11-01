const form = document.querySelector('#search-form');
const cityInput = document.querySelector('#city-input');
const statusLine = document.querySelector('#status-line');
const hourlyList = document.querySelector('#hourly-list');
const weekList = document.querySelector('#week-list');
const favoriteButton = document.querySelector('#favorite-button');
const unitToggle = document.querySelector('#unit-toggle');
const locationButton = document.querySelector('#locate-button');
const installButton = document.querySelector('#install-button');
const installHint = document.querySelector('#install-hint');
const notificationsToggle = document.querySelector('#notifications-toggle');
const notificationsStatus = document.querySelector('#notifications-status');
const settingsDialog = document.querySelector('#settings-dialog');
const settingsOpen = document.querySelector('#settings-open');
const settingsClose = document.querySelector('#settings-close');
const autoLocationToggle = document.querySelector('#auto-location-toggle');
const notificationSettings = {
  rain: document.querySelector('#notify-rain'),
  snow: document.querySelector('#notify-snow'),
  storm: document.querySelector('#notify-storm')
};
let activeCity = 'Ысык-Көл';
let weatherData = null;
let isFahrenheit = false;
let favorites = readFavorites();
let installPrompt = null;
let weatherNotificationsEnabled = localStorage.getItem('weather-notifications-enabled') === 'true';
let weatherNotificationTypes = readNotificationTypes();
let autoLocationEnabled = localStorage.getItem('auto-location-enabled') !== 'false';

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

locationButton.addEventListener('click', () => {
  if (!navigator.geolocation) {
    showStatus('Этот браузер не поддерживает поиск местоположения.');
    return;
  }
  if (!window.isSecureContext) {
    showStatus('Чтобы найти ваше местоположение, откройте сайт по HTTPS или на localhost.');
    return;
  }

  locationButton.disabled = true;
  locationButton.setAttribute('aria-busy', 'true');
  showStatus('Ищем ваше местоположение… Разрешите доступ, если браузер спросит.');
  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      showStatus('Местоположение найдено. Загружаем погоду…');
      try {
        const loaded = await loadWeather('', coords.latitude, coords.longitude);
        if (loaded) showStatus('Показана погода по вашему местоположению.');
      } finally {
        locationButton.disabled = false;
        locationButton.removeAttribute('aria-busy');
      }
    },
    (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Нет доступа к местоположению. Разрешите геолокацию для сайта в настройках браузера и попробуйте снова.'
        : error.code === error.POSITION_UNAVAILABLE
          ? 'Устройство не смогло определить местоположение. Проверьте GPS и попробуйте снова.'
          : 'Поиск местоположения занял слишком много времени. Проверьте GPS и попробуйте снова.';
      showStatus(message);
      locationButton.disabled = false;
      locationButton.removeAttribute('aria-busy');
    },
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 0 }
  );
});

notificationsToggle.addEventListener('click', async () => {
  if (weatherNotificationsEnabled) {
    weatherNotificationsEnabled = false;
    localStorage.setItem('weather-notifications-enabled', 'false');
    updateNotificationsUI();
    return;
  }
  if (!('Notification' in window)) {
    notificationsStatus.textContent = 'Этот браузер не поддерживает уведомления.';
    return;
  }
  if (!window.isSecureContext) {
    notificationsStatus.textContent = 'Для уведомлений откройте сайт по HTTPS.';
    return;
  }

  let permission;
  try {
    permission = await Notification.requestPermission();
  } catch (error) {
    notificationsStatus.textContent = `Не удалось запросить разрешение: ${error.message}`;
    return;
  }
  if (permission !== 'granted') {
    notificationsStatus.textContent = permission === 'denied'
      ? 'Разрешите уведомления для сайта в настройках браузера.'
      : 'Разрешите уведомления, чтобы получать прогноз.';
    return;
  }

  weatherNotificationsEnabled = true;
  localStorage.setItem('weather-notifications-enabled', 'true');
  updateNotificationsUI();
  await checkWeatherNotifications();
});

Object.entries(notificationSettings).forEach(([type, checkbox]) => {
  checkbox.checked = weatherNotificationTypes[type];
  checkbox.addEventListener('change', async () => {
    weatherNotificationTypes[type] = checkbox.checked;
    localStorage.setItem('weather-notification-types', JSON.stringify(weatherNotificationTypes));
    await checkWeatherNotifications();
  });
});

autoLocationToggle.checked = autoLocationEnabled;
autoLocationToggle.addEventListener('change', () => {
  autoLocationEnabled = autoLocationToggle.checked;
  localStorage.setItem('auto-location-enabled', String(autoLocationEnabled));
});

settingsOpen.addEventListener('click', () => settingsDialog.showModal());
settingsClose.addEventListener('click', () => settingsDialog.close());
settingsDialog.addEventListener('click', (event) => {
  if (event.target === settingsDialog) settingsDialog.close();
});

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
});

installButton?.addEventListener('click', async () => {
  if (installPrompt) {
    installPrompt.prompt();
    await installPrompt.userChoice;
    installPrompt = null;
    return;
  }
  return;
});

window.addEventListener('appinstalled', () => {
  if (!installHint || !installButton) return;
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
    hourly: 'temperature_2m,precipitation_probability,weather_code,is_day',
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
  let loaded = false;
  try {
    const place = latitude !== undefined
      ? { name: 'Моё местоположение', latitude, longitude, country: '' }
      : await resolvePlace(city);
    weatherData = await fetchForecast(place);
    activeCity = place.name === 'Ысык-Көл'
      ? 'Ысык-Көл'
      : place.name === 'Моё местоположение'
        ? 'Бишкек'
        : city || place.name;
    updatePlace(weatherData.place);
    renderWeather();
    showStatus('');
    await checkWeatherNotifications();
    loaded = true;
  } catch (error) {
    showStatus(error.message);
  } finally {
    form.classList.remove('loading');
  }
  return loaded;
}

function updatePlace(place) {
  document.querySelector('#place-title').textContent = activeCity;
  const details = place.name === 'Моё местоположение'
    ? 'Кыргызстан · ваше местоположение'
    : place.name === 'бишкек'
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
  renderHourly(hourly, current);
  renderWeek(daily);
  renderFavorites();
}

function renderHourly(hourly, current) {
  const currentHour = current.time.slice(0, 13);
  let start = hourly.time.findIndex((time) => time.slice(0, 13) === currentHour);
  if (start < 0) start = hourly.time.findIndex((time) => time >= current.time);
  if (start < 0) start = 0;
  const items = hourly.time.slice(start, start + 12).map((time, offset) => {
    const index = start + offset;
    const label = offset === 0 ? 'Сейчас' : formatTime(time);
    const rain = hourly.precipitation_probability[index];
    const temperature = offset === 0 ? current.temperature_2m : hourly.temperature_2m[index];
    const weatherCode = offset === 0 ? current.weather_code : hourly.weather_code[index];
    const isDay = offset === 0 ? current.is_day : hourly.is_day[index];
    return `<div class="hour-item"><span class="hour-time">${label}</span><span class="hour-icon">${weatherIcon(weatherCode, isDay)}</span><strong class="hour-temp">${Math.round(convertTemp(temperature))}°</strong><span class="hour-rain">${rain ? `${Math.round(rain)}% дождя` : ''}</span></div>`;
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
  if (code <= 2) return isDay ? '🌤️' : code === 1 ? '🌙' : '☁️';
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

function updateNotificationsUI() {
  if (weatherNotificationsEnabled && (!('Notification' in window) || Notification.permission !== 'granted')) {
    weatherNotificationsEnabled = false;
    localStorage.setItem('weather-notifications-enabled', 'false');
  }
  notificationsToggle.textContent = weatherNotificationsEnabled ? 'Выключить' : 'Включить';
  notificationsToggle.setAttribute('aria-pressed', String(weatherNotificationsEnabled));
  notificationsStatus.textContent = weatherNotificationsEnabled
    ? ''
    : 'Сообщим о дожде, снеге или грозе в ближайшие 6 часов, пока сайт открыт.';
}

function readNotificationTypes() {
  const defaults = { rain: true, snow: true, storm: true };
  try {
    const saved = JSON.parse(localStorage.getItem('weather-notification-types') || '{}');
    return Object.fromEntries(Object.keys(defaults).map((type) => [type, typeof saved[type] === 'boolean' ? saved[type] : defaults[type]]));
  } catch {
    return defaults;
  }
}

function weatherAlertCategory(code) {
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return 'snow';
  if (code >= 95 && code <= 99) return 'storm';
  return null;
}

async function checkWeatherNotifications() {
  if (!weatherNotificationsEnabled || !('Notification' in window) || Notification.permission !== 'granted' || !weatherData) return;

  const { hourly, current } = weatherData;
  let start = hourly.time.findIndex((time) => time.slice(0, 13) === current.time.slice(0, 13));
  if (start < 0) start = hourly.time.findIndex((time) => time >= current.time);
  if (start < 0) start = 0;

  let alertIndex = -1;
  for (let index = start; index < Math.min(start + 7, hourly.time.length); index += 1) {
    const category = weatherAlertCategory(hourly.weather_code[index]);
    if (category && weatherNotificationTypes[category]) {
      alertIndex = index;
      break;
    }
  }
  if (alertIndex < 0) return;

  const category = weatherAlertCategory(hourly.weather_code[alertIndex]);
  const notificationKey = `last-weather-notification-${encodeURIComponent(activeCity)}-${category}`;
  const previousNotification = Number(localStorage.getItem(notificationKey) || 0);
  if (previousNotification && Date.now() - previousNotification < 6 * 60 * 60 * 1000) return;

  const offset = alertIndex - start;
  const timing = offset === 0 ? 'Сейчас' : `Примерно через ${offset} ч.`;
  const options = {
    body: `${timing}: ${category === 'storm' ? 'гроза' : category === 'snow' ? 'снег' : 'дождь'}.`,
    icon: './icon-192.png',
    tag: `${activeCity}:${category}`
  };
  try {
    const registration = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (registration) await registration.showNotification(`Погода в ${activeCity}`, options);
    else new Notification(`Погода в ${activeCity}`, options);
  } catch (error) {
    showStatus(`Не удалось показать уведомление: ${error.message}`);
    return;
  }
  localStorage.setItem(notificationKey, String(Date.now()));
}

function loadWeatherNearUser() {
  if (!autoLocationEnabled) {
    loadWeather(activeCity);
    return;
  }
  if (!navigator.geolocation || window.location.protocol === 'file:') {
    loadWeather(activeCity).then((loaded) => {
      if (loaded && !navigator.geolocation) showStatus(`Геолокация недоступна. Сейчас показана погода: ${activeCity}.`);
    });
    return;
  }

  showStatus('Определяем ваше местоположение…');
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => loadWeather('', coords.latitude, coords.longitude),
    (error) => {
      const message = error.code === error.PERMISSION_DENIED
        ? 'Разрешите доступ к местоположению в браузере'
        : 'Не удалось определить местоположение';
      loadWeather(activeCity).then((loaded) => {
        if (loaded) showStatus(`${message}. Пока показана погода: ${activeCity}.`);
      });
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 600000 }
  );
}

renderFavorites();
updateNotificationsUI();
loadWeatherNearUser();
window.setInterval(async () => {
  if (!weatherData) return;
  const place = weatherData.place;
  try {
    const refreshedWeather = await fetchForecast(place);
    if (weatherData?.place !== place) return;
    weatherData = refreshedWeather;
    updatePlace(place);
    renderWeather();
    await checkWeatherNotifications();
  } catch (error) {
    showStatus(`Не удалось обновить температуру: ${error.message}`);
  }
}, 15 * 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
if (installButton && (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone)) {
  installButton.hidden = true;
}

const promoShareButton = document.getElementById('promo-share-button');
promoShareButton?.addEventListener('click', async () => {
  const shareUrl = window.location.href.split('#')[0].split('?')[0];
  const shareData = {
    title: 'Погода Кыргызстана',
    text: 'Прогноз погоды для городов Кыргызстана — сейчас, по часам и на неделю.',
    url: shareUrl
  };
  if (navigator.share) {
    try {
      await navigator.share(shareData);
    } catch (error) {
      if (error.name !== 'AbortError') showStatus('Не удалось поделиться ссылкой.');
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(shareUrl);
    showStatus('Ссылка скопирована — отправь её друзьям!');
  } catch {
    showStatus(`Ссылка на сайт: ${shareUrl}`);
  }
});
