// Keep OS credential access in Electron's main process, never in the renderer.
function createDesktopEncryption(safeStorage, platform = process.platform) {
  const linux = platform === 'linux';
  return {
    async isAvailable() {
      try {
        // Electron's Linux basic_text fallback uses a hardcoded password.
        // Use the matching sync key provider on Electron 45/Linux: the async
        // provider has a separate fallback without a backend-inspection API.
        if (linux) return safeStorage.isEncryptionAvailable() && ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(safeStorage.getSelectedStorageBackend());
        return await safeStorage.isAsyncEncryptionAvailable();
      } catch { return false; }
    },
    encrypt: async (text) => linux ? safeStorage.encryptString(text) : safeStorage.encryptStringAsync(text),
    async decrypt(buffer) {
      if (linux) return safeStorage.decryptString(buffer);
      let result = await safeStorage.decryptStringAsync(buffer);
      if (result.shouldReEncrypt) result = await safeStorage.decryptStringAsync(buffer);
      return result.result;
    },
  };
}

module.exports = { createDesktopEncryption };
