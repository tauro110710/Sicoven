import assert from 'node:assert/strict';
import testCase from 'node:test';
import { createBankOutgoingLock } from './bankOutgoingLock';

testCase('blocks a second outgoing operation on the same bank account until SQLite confirms the first', () => {
  const locks = createBankOutgoingLock();
  const release = locks.acquire('company-a:bank-1');

  assert.equal(locks.isLocked('company-a:bank-1'), true);
  assert.throws(
    () => locks.acquire('company-a:bank-1'),
    /pendiente de confirmación en SQLite/
  );

  release();
  assert.equal(locks.isLocked('company-a:bank-1'), false);
  assert.doesNotThrow(() => locks.acquire('company-a:bank-1'));
});

testCase('allows independent bank accounts and companies to proceed concurrently', () => {
  const locks = createBankOutgoingLock();
  const releaseA = locks.acquire('company-a:bank-1');

  assert.doesNotThrow(() => locks.acquire('company-a:bank-2'));
  assert.doesNotThrow(() => locks.acquire('company-b:bank-1'));
  assert.equal(locks.isLocked('company-a:bank-1'), true);

  releaseA();
  assert.equal(locks.isLocked('company-a:bank-1'), false);
});

testCase('releasing a bank reservation more than once is safe', () => {
  const locks = createBankOutgoingLock();
  const release = locks.acquire('company-a:bank-1');

  release();
  release();

  assert.equal(locks.isLocked('company-a:bank-1'), false);
  assert.doesNotThrow(() => locks.acquire('company-a:bank-1'));
});
