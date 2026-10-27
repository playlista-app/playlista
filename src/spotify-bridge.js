const path = require('node:path');
const { createPythonBridge } = require('./python-bridge');
const runBridge = createPythonBridge({ provider: 'Spotify', script: path.join(__dirname, '../integrations/spotify/bridge.py'), setupCommand: 'setup:spotify' });
module.exports = { runBridge };
