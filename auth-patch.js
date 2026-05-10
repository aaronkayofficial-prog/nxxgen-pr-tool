/* PressReachOut Auth Patch — fixes Clerk loading hang */
(function() {
  function showFallbackUI() {
    var fb = document.getElementById('auth-fallback-btns');
    if (fb) fb.style.display = 'flex';
    var msg = document.getElementById('auth-loading-msg');
    if (msg) msg.style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', function() {
    var loadingEl = document.getElementById('auth-loading');
    if (loadingEl && loadingEl.textContent.trim() === 'Loading...') {
      loadingEl.innerHTML = '<div id="auth-loading-msg" style="font-size:13px;color:#888;margin-bottom:1.5rem;">Setting up sign-in…</div>' +
        '<div id="auth-fallback-btns" style="display:none;flex-direction:column;gap:12px;">' +
        '<a href="/app" onclick="if(typeof skipAuthFallback===\'function\')skipAuthFallback();return false;" style="display:block;background:#c2185b;color:#fff;border-radius:50px;padding:13px 28px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;">Get started free →</a>' +
        '<a href="/app" onclick="if(typeof skipAuthFallback===\'function\')skipAuthFallback();return false;" style="display:block;background:transparent;color:#888;border:1.5px solid #e8e4df;border-radius:50px;padding:12px 28px;font-size:14px;font-weight:500;text-align:center;text-decoration:none;">Sign in to my account</a>' +
        '</div>';
    }
    // Force app load after 2 seconds regardless of Clerk status
    setTimeout(function() {
      showFallbackUI();
      if (typeof skipAuthFallback === 'function') skipAuthFallback();
    }, 2000);
  }, false);
})();
