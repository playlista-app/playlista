const path = require('node:path');
const { createPythonBridge, pythonExecutable } = require('./python-bridge');
const runBridge = createPythonBridge({ provider: 'YouTube Music', script: path.join(__dirname, '../integrations/youtube/bridge.py'), setupCommand: 'setup:youtube' });
module.exports = { runBridge, pythonExecutable };
