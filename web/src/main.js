import Router from './router.js';
import { Overlay } from './ui/overlay.jsx';
import { checkSupportedTech } from './utils.js';
import setTranslation from './translations';
import settings from './settings.js';
import { version } from '../version.json';
import Logger from './logger.js';
const logger = Logger.logger.get();
const IS_ANDROID_SHELL = /\bSubSync2Android\//.test(navigator.userAgent);

function requestedRoute() {
  return new URLSearchParams(window.location.search).get('tab') === 'audio'
    ? 'audioExtractor'
    : 'input';
}

function setActiveTab(route) {
  const audio = route === 'audioExtractor';
  const syncTab = document.getElementById('subsync_tab_sync');
  const audioTab = document.getElementById('subsync_tab_audio');
  if (syncTab) {
    syncTab.classList.toggle('active', !audio);
    syncTab.setAttribute('aria-selected', String(!audio));
  }
  if (audioTab) {
    audioTab.classList.toggle('active', audio);
    audioTab.setAttribute('aria-selected', String(audio));
  }
}

function updateUrl(route, replace = false) {
  const url = new URL(window.location.href);
  if (route === 'audioExtractor') url.searchParams.set('tab', 'audio');
  else url.searchParams.delete('tab');
  window.history[replace ? 'replaceState' : 'pushState']({ route }, '', url);
}

async function main() {
  document.documentElement.classList.toggle('android-shell', IS_ANDROID_SHELL);
  if (IS_ANDROID_SHELL) {
    const localBadge = document.querySelector('.local_badge');
    if (localBadge) localBadge.textContent = 'Android TV · local';
  }

  settings.load();
  setTranslation(settings.lang);

  const id = 'subsync_app';
  Router.init(document.getElementById('main_content'), id);
  Overlay.init(document.getElementById(id));

  const spinner = Overlay.showSpinner();
  const supportedTech = await checkSupportedTech();
  spinner.hide();
  const missing = Object.entries(supportedTech).filter(x => !x[1]).map(x => x[0]);

  const navigate = (route, { push = true } = {}) => {
    setActiveTab(route);
    if (push) updateUrl(route);
    if (route === 'audioExtractor') {
      Router.update('audioExtractor');
      return;
    }
    if (missing.length) {
      logger.warn('browser not supported, missing:', missing.join(', '));
      Router.update('notSupported', { supportedTech });
    } else {
      Router.update('input');
    }
  };

  document.getElementById('subsync_tab_sync')?.addEventListener('click', event => {
    event.preventDefault();
    navigate('input');
  });
  document.getElementById('subsync_tab_audio')?.addEventListener('click', event => {
    event.preventDefault();
    navigate('audioExtractor');
  });
  window.addEventListener('popstate', () => navigate(requestedRoute(), { push: false }));

  const initial = requestedRoute();
  updateUrl(initial, true);
  navigate(initial, { push: false });
}

logger.log(`subsync ${version}`);
document.addEventListener('DOMContentLoaded', main);
