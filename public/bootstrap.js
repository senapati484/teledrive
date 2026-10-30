// Global unhandled rejection handler - logs safely and never interrupts the UI
window.addEventListener('unhandledrejection', function (event) {
  console.warn('[TeleDrive Unhandled Rejection]', event.reason);
  if (event && event.preventDefault) {
    event.preventDefault();
  }
});

// Fatal launch error fallback - only activated if the app fails to boot and root is empty
window.addEventListener('error', function (event) {
  console.error('[TeleDrive Runtime Error]', event.error || event.message);

  var root = document.getElementById('root');
  // If React has already rendered, let React / ErrorBoundary handle it
  if (root && root.children && root.children.length > 0) {
    return;
  }

  // Only show clean recovery screen if the root completely failed to mount
  var existingFallback = document.getElementById('teledrive-fatal-error');
  if (!existingFallback) {
    var fallback = document.createElement('div');
    fallback.id = 'teledrive-fatal-error';
    fallback.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;background:#020617;display:flex;flex-direction:column;align-items:center;justify-content:center;color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;text-align:center;box-sizing:border-box;z-index:999999;user-select:none;';
    fallback.innerHTML =
      '<div style="width:64px;height:64px;border-radius:16px;background:#0f172a;border:1px solid #1e293b;display:flex;align-items:center;justify-content:center;margin-bottom:24px;box-shadow:0 10px 25px -5px rgba(0,0,0,0.3);">' +
        '<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>' +
      '</div>' +
      '<h2 style="font-size:20px;font-weight:600;margin:0 0 8px 0;color:#f8fafc;">Something went wrong</h2>' +
      '<p style="font-size:14px;color:#94a3b8;margin:0 0 24px 0;max-width:360px;line-height:1.5;">An unexpected issue occurred. Please reload the application to continue.</p>' +
      '<button onclick="window.location.reload()" style="background:#2563eb;color:#ffffff;border:none;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;display:inline-flex;align-items:center;gap:8px;box-shadow:0 4px 14px 0 rgba(37,99,235,0.39);transition:background 0.2s;">' +
        '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path><path d="M3 3v5h5"></path></svg>' +
        'Reload Application' +
      '</button>';
    document.body.appendChild(fallback);
  }
});
