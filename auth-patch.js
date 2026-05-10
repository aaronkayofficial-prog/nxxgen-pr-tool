/* PressReachOut Auth Patch v2 — runs immediately after body */
(function() {
  function run() {
    // Replace Loading... with proper sign-in UI
    var loadingEl = document.getElementById('auth-loading');
    if (loadingEl) {
      loadingEl.style.width = '100%';
      loadingEl.style.maxWidth = '380px';
      loadingEl.style.textAlign = 'center';
      var inner = loadingEl.textContent || '';
      if (inner.trim() === 'Loading...') {
        loadingEl.innerHTML =
          '<div id="auth-loading-msg" style="font-size:13px;color:#888;margin-bottom:1.5rem;">Setting up sign-in\u2026</div>' +
          '<div id="auth-fallback-btns" style="display:none;flex-direction:column;gap:12px;">' +
          '<a href="/app" onclick="if(typeof skipAuthFallback===\'function\')skipAuthFallback();return false;" ' +
          'style="display:block;background:#c2185b;color:#fff;border-radius:50px;padding:13px 28px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;">Get started free \u2192</a>' +
          '<a href="/app" onclick="if(typeof skipAuthFallback===\'function\')skipAuthFallback();return false;" ' +
          'style="display:block;background:transparent;color:#888;border:1.5px solid #e8e4df;border-radius:50px;padding:12px 28px;font-size:14px;font-weight:500;text-align:center;text-decoration:none;">Sign in to my account</a>' +
          '</div>';
      }
    }

    // After 2 seconds, show the fallback buttons and load the app
    setTimeout(function() {
      var fb = document.getElementById('auth-fallback-btns');
      if (fb) fb.style.display = 'flex';
      var msg = document.getElementById('auth-loading-msg');
      if (msg) msg.style.display = 'none';
      if (typeof skipAuthFallback === 'function') skipAuthFallback();
    }, 2000);
  }

  // DOM is already available since this script is after </body>
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
