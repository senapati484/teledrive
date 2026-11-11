// Pre-paint theme initialization to prevent blank white flash before React & CSS mount
(function applyInitialTheme() {
  try {
    var raw = localStorage.getItem('teledrive-ui-storage');
    var theme = 'system';
    if (raw) {
      var parsed = JSON.parse(raw);
      if (parsed && parsed.state && typeof parsed.state.theme === 'string') {
        theme = parsed.state.theme;
      }
    }
    var prefersDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    if (theme === 'dark' || (theme === 'system' && prefersDark)) {
      document.documentElement.classList.add('dark');
    } else if (theme === 'light') {
      document.documentElement.classList.add('light');
    }
  } catch (e) {
    // Ignore restricted localStorage or malformed storage JSON
  }
})();

function isRootMounted() {
  if (window.__TELEDRIVE_MOUNTED__) return true;
  var root = document.getElementById('root');
  return Boolean(root && root.children && root.children.length > 0);
}

function showFatalBootScreen(reason) {
  if (isRootMounted()) return;
  if (reason) {
    console.error('[TeleDrive Boot Recovery]', reason);
  }

  var existingFallback = document.getElementById('teledrive-fatal-error');
  if (existingFallback) return;

  var mountPoint = document.body || document.documentElement;
  if (!mountPoint) {
    window.addEventListener('DOMContentLoaded', function () {
      showFatalBootScreen(reason);
    }, { once: true });
    return;
  }

  var fallback = document.createElement('div');
  fallback.id = 'teledrive-fatal-error';
  fallback.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#020617;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;text-align:center;box-sizing:border-box;z-index:999999;user-select:none;';
  fallback.innerHTML =
    '<div style="width:64px;height:64px;border-radius:16px;background:#0f172a;border:1px solid #1e293b;display:flex;align-items:center;justify-content:center;margin-bottom:24px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);">' +
      '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
    '</div>' +
    '<h2 style="font-size:20px;font-weight:600;margin:0 0 8px 0;color:#f8fafc;">Something went wrong</h2>' +
    '<p style="font-size:14px;color:#94a3b8;margin:0 0 24px 0;max-width:360px;line-height:1.5;">An unexpected issue occurred while starting TeleDrive. Please reload the application to continue.</p>' +
    '<button type="button" id="teledrive-fatal-reload" style="background:#2563eb;color:#ffffff;border:none;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 14px 0 rgba(37,99,235,0.39);transition:background 0.2s;">' +
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>' +
      'Reload Application' +
    '</button>';

  mountPoint.appendChild(fallback);
  var reloadBtn = document.getElementById('teledrive-fatal-reload');
  if (reloadBtn) {
    reloadBtn.addEventListener('click', function () {
      window.location.reload();
    });
  }
}

// Global unhandled rejection handler - logs safely and never interrupts mounted UI
window.addEventListener('unhandledrejection', function (event) {
  console.warn('[TeleDrive Unhandled Rejection]', event.reason);
  if (!isRootMounted() && event && event.reason) {
    showFatalBootScreen(event.reason);
  }
  if (event && event.preventDefault) {
    event.preventDefault();
  }
});

// Fatal launch error fallback (capture=true also catches module script / preload load failures)
window.addEventListener('error', function (event) {
  if (event.target && event.target !== window) {
    var tag = event.target.tagName;
    var rel = event.target.rel;
    if (tag !== 'SCRIPT' && !(tag === 'LINK' && rel === 'modulepreload')) {
      return;
    }
    showFatalBootScreen('Failed to load startup script resource');
    return;
  }

  console.error('[TeleDrive Runtime Error]', event.error || event.message);
  if (!isRootMounted()) {
    showFatalBootScreen(event.error || event.message);
  }
}, true);

// Watchdog: if React has not mounted anything into #root after 10s, surface recovery UI instead of blank screen
(function startBootWatchdog() {
  var bootTimer = setTimeout(function () {
    if (!isRootMounted()) {
      showFatalBootScreen('Application boot timed out before React mounted');
    }
  }, 10000);

  function stopWatchdogIfMounted() {
    if (isRootMounted()) {
      clearTimeout(bootTimer);
      var existing = document.getElementById('teledrive-fatal-error');
      if (existing && existing.parentNode) {
        existing.parentNode.removeChild(existing);
      }
      return true;
    }
    return false;
  }

  var observer = typeof MutationObserver === 'function'
    ? new MutationObserver(function () {
        if (stopWatchdogIfMounted()) {
          observer.disconnect();
        }
      })
    : null;

  function attachObserver() {
    if (stopWatchdogIfMounted()) return;
    var root = document.getElementById('root');
    if (observer && root) {
      observer.observe(root, { childList: true });
    }
  }

  if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', attachObserver, { once: true });
  } else {
    attachObserver();
  }
})();
