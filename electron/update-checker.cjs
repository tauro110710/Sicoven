'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DOWNLOADS_URL = 'https://sicoven-descargas';
const RELEASES_API = 'https://api.github.com/repos/fenixlife1978/sicoven-descargas/releases/latest';
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

function parseVersion(value) {
  const match = String(value || '').trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match ? match.slice(1, 4).map(Number) : null;
}

function isVersionNewer(candidate, current) {
  const next = parseVersion(candidate);
  const installed = parseVersion(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function readNotificationState(statePath) {
  try {
    const value = JSON.parse(fs.readFileSync(statePath, 'utf8'));
    return value && typeof value.lastNotifiedVersion === 'string' ? value : {};
  } catch {
    return {};
  }
}

async function checkForUpdate({
  currentVersion,
  userDataPath,
  NotificationImpl,
  shellImpl,
  fetchImpl = globalThis.fetch
}) {
  if (typeof fetchImpl !== 'function') return { status: 'unavailable' };
  try {
    const response = await fetchImpl(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'SICOVEN-Desktop-Updater' },
      signal: AbortSignal.timeout(12000),
      cache: 'no-store'
    });
    if (!response.ok) return { status: 'offline-or-unavailable', httpStatus: response.status };
    const release = await response.json();
    if (!release || release.draft || release.prerelease || !/^v?\d+\.\d+\.\d+$/.test(String(release.tag_name || ''))) {
      return { status: 'invalid-release' };
    }
    const availableVersion = String(release.tag_name).replace(/^v/i, '');
    if (!isVersionNewer(availableVersion, currentVersion)) return { status: 'up-to-date', currentVersion };
    if (!NotificationImpl || !NotificationImpl.isSupported || !NotificationImpl.isSupported()) {
      return { status: 'notifications-unavailable', availableVersion };
    }

    const statePath = path.join(userDataPath, 'update-notification.json');
    const state = readNotificationState(statePath);
    if (state.lastNotifiedVersion === availableVersion) return { status: 'already-notified', availableVersion };

    const notification = new NotificationImpl({
      title: 'Hay una nueva actualización de SICOVEN',
      body: 'Está disponible SICOVEN v' + availableVersion + '. Conéctate a Internet y visita sicoven-descargas para revisar las novedades y descargarla.',
      silent: false
    });
    notification.on('click', () => {
      if (shellImpl && typeof shellImpl.openExternal === 'function') shellImpl.openExternal(DOWNLOADS_URL);
    });
    notification.show();
    fs.mkdirSync(userDataPath, { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify({ lastNotifiedVersion: availableVersion, notifiedAt: new Date().toISOString() }, null, 2), 'utf8');
    return { status: 'notified', availableVersion };
  } catch {
    return { status: 'offline-or-unavailable' };
  }
}

function startUpdateChecks(options) {
  let stopped = false;
  let running = false;
  const check = async () => {
    if (stopped || running) return;
    running = true;
    try { await checkForUpdate(options); } finally { running = false; }
  };
  const initialTimer = setTimeout(check, 8000);
  const interval = setInterval(check, CHECK_INTERVAL_MS);
  if (typeof initialTimer.unref === 'function') initialTimer.unref();
  if (typeof interval.unref === 'function') interval.unref();
  return () => {
    stopped = true;
    clearTimeout(initialTimer);
    clearInterval(interval);
  };
}

module.exports = { DOWNLOADS_URL, RELEASES_API, CHECK_INTERVAL_MS, parseVersion, isVersionNewer, checkForUpdate, startUpdateChecks };
