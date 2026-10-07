'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

test('installer transactions and standalone helper lookup use isolated homes', { timeout: 60000 }, () => {
  const result = spawnSync('python3', ['-B', path.join(__dirname, 'installer_cases.py')], {
    encoding: 'utf8',
    timeout: 55000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});
