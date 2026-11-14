'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getAuthSetupStatus, canReplaceSeedAdmin } = require('./auth-setup-policy.cjs');

test('first launch requires a user-defined administrator when no users exist', () => {
  assert.deepEqual(getAuthSetupStatus([], { authorized: true, status: 'trial' }), { required: true, replacingSeed: false });
});

test('known seed administrator is replaced before login even during the trial', () => {
  const users = [{ id: 1, is_seed: 1 }];
  assert.deepEqual(getAuthSetupStatus(users, { authorized: true, status: 'trial' }), { required: true, replacingSeed: true });
  assert.equal(canReplaceSeedAdmin({ authorized: true, status: 'trial' }), true);
});

test('existing non-seed accounts do not trigger first-run setup', () => {
  assert.deepEqual(getAuthSetupStatus([{ id: 2, is_seed: 0 }], { authorized: true, status: 'licensed' }), { required: false, replacingSeed: false });
});

test('expired or unauthorized installation cannot replace a seed account', () => {
  assert.equal(canReplaceSeedAdmin({ authorized: false, status: 'expired' }), false);
});
