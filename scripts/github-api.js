const { execFileSync } = require('node:child_process');

function gh(args, options = {}) {
  return execFileSync('gh', args, { encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'], ...options });
}

function api(method, endpoint, data) {
  return JSON.parse(gh(['api', '--method', method, endpoint, ...(data === undefined ? [] : ['--input', '-'])], data === undefined ? {} : { input: JSON.stringify(data) }));
}

function isNotFound(error) { return String(error.stderr || error.message).includes('HTTP 404'); }
module.exports = { gh, api, isNotFound };
