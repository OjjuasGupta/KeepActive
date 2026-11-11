// The same welcome page ships in both packages. Mark the active variant so
// full-build-only instructions stay out of the browser-only store build.
const manifest = chrome.runtime.getManifest();
const permissions = Array.isArray(manifest.permissions) ? manifest.permissions : [];
const isFullBuild = permissions.includes('nativeMessaging');
document.documentElement.dataset.build = isFullBuild ? 'full' : 'store';

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
document.getElementById('closeWelcome').addEventListener('click', () => {
  window.close();
});
