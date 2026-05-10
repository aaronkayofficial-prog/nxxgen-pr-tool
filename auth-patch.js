/* PressReachOut Auth Patch v3 — runs immediately after </body>
   Replaces the bare "Loading..." placeholder with a progress message,
   and shows fallback sign-in buttons ONLY if Clerk hasn't mounted any
   UI after 5 seconds. Never auto-skips authentication — the user
   chooses by clicking. The inline 6s/8s/10s failsafes in index.html
   still handle the hard-failure case where Clerk never loads at all. */
(function() {
  function run() {
    var loadingEl = document.getElementById('auth-loading');
    if (!loadingEl) return;

    // Only act on the original "Loading..." placeholder, so a second
    // run (or a session that's already past auth) doesn't stomp on UI.
    if ((loadingEl.textContent || '').trim() !== 'Loading...') return;

    loadingEl.style.width = '100%';
    loadingEl.style.maxWidth = '380px';
    loadingEl.style.textAlign = 'center';
    loadingEl.innerHTML =
      '<div id="auth-loading-msg" style="font-size:13px;color:#888;margin-bottom:1.5rem;">Setting up sign-in\u2026</div>' +
      '<div id="auth-fallback-btns" style="display:none;flex-direction:column;gap:12px;">' +
        '<a href="#" onclick="event.preventDefault();if(typeof skipAuthFallback===\'function\')skipAuthFallback();" ' +
          'style="display:block;background:#c2185b;color:#fff;border-radius:50px;padding:13px 28px;font-size:15px;font-weight:600;text-align:center;text-decoration:none;">Continue without signing in \u2192</a>' +
        '<a href="https://accounts.pressreachout.com/sign-in" ' +
          'style="display:block;background:transparent;color:#888;border:1.5px solid #e8e4df;border-radius:50px;padding:12px 28px;font-size:14px;font-weight:500;text-align:center;text-decoration:none;">Open sign-in page</a>' +
      '</div>';

    // After 5 seconds, ONLY show the fallback buttons if Clerk hasn't
    // mounted any UI into #clerk-mount. We do NOT call skipAuthFallback
    // automatically — the user decides.
    setTimeout(function() {
      var mount = document.getElementById('clerk-mount');
      var clerkMounted = mount && mount.children.length > 0;
      if (clerkMounted) return; // Clerk rendered fine — leave the page alone.

      var fb = document.getElementById('auth-fallback-btns');
      var msg = document.getElementById('auth-loading-msg');
      if (msg) msg.textContent = 'Sign-in is taking a moment. Continue below:';
      if (fb) fb.style.display = 'flex';
    }, 5000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
})();
