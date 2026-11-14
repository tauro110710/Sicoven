'use strict';

function isOnlySeedAdmin(users) {
  return Array.isArray(users) && users.length === 1 && Number(users[0]?.is_seed) === 1;
}

function getAuthSetupStatus(users, licensing) {
  const onlySeed = isOnlySeedAdmin(users);
  return {
    // A known bootstrap password must never remain the normal login path,
    // including during the local trial. Replace it before opening the app.
    required: !Array.isArray(users) || users.length === 0 || onlySeed,
    replacingSeed: onlySeed
  };
}

function canReplaceSeedAdmin(licensing) {
  return Boolean(licensing?.authorized);
}

module.exports = { isOnlySeedAdmin, getAuthSetupStatus, canReplaceSeedAdmin };
