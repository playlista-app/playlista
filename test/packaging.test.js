const test = require('node:test');
const assert = require('node:assert/strict');
const { packagingEnvironment } = require('../scripts/package-desktop');

test('unset Actions signing secrets stay absent instead of becoming a certificate directory', () => {
  const source = { CSC_LINK: '', WIN_CSC_LINK: '  ', CSC_INSTALLER_LINK: '', APPLE_ID: '', APPLE_TEAM_ID: '', APPLE_APP_SPECIFIC_PASSWORD: '', PATH: 'tools' };
  const env = packagingEnvironment(source);
  assert.deepEqual(env, { PATH: 'tools' });
  assert.equal(source.CSC_LINK, '', 'the caller environment is not mutated');
});

test('configured signing certificates and intentionally empty certificate passwords are retained', () => {
  const source = { CSC_LINK: 'certificate.p12', CSC_KEY_PASSWORD: '', WIN_CSC_LINK: 'windows.p12', APPLE_ID: 'developer@example.com', APPLE_TEAM_ID: 'team', APPLE_APP_SPECIFIC_PASSWORD: 'synthetic-password' };
  assert.deepEqual(packagingEnvironment(source), source);
});
