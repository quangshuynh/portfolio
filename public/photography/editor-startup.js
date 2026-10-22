// Startup watchdog for /photography/editor. A classic script that runs before the app
// bundle and does not depend on React: if the editor has not marked itself started
// (<html data-editor="ready">, set by EditorApp) or shown its own error page, it shows
// what failed and a Retry button instead of a blank page. Deliberately ES5 so it still
// runs in browsers that cannot parse the bundle. It records only error messages, script
// paths and browser capabilities: never photographs, file names or storage contents.
(function () {
  var TIMEOUT_MS = 12000;
  var ERROR_GRACE_MS = 2500;
  var MAX_EVENTS = 12;
  var events = [];
  var panel = null;
  var root = document.documentElement;

  function pathOf(url) {
    if (!url) return '';
    try { return new URL(url, location.href).pathname; } catch (error) { return String(url).slice(0, 120); }
  }

  function record(kind, message) {
    if (events.length >= MAX_EVENTS) return;
    events.push({ kind: kind, message: String(message || 'Unknown error').slice(0, 300), at: Math.round(performance.now()) });
    if (panel) render();
  }

  function started() {
    return root.getAttribute('data-editor') === 'ready' || !!document.querySelector('.route-error');
  }

  function supports() {
    var checks = [];
    var webgl2 = 'no';
    try { webgl2 = document.createElement('canvas').getContext('webgl2') ? 'yes' : 'no'; } catch (error) { webgl2 = 'error: ' + error.message; }
    var storage = 'yes';
    try { localStorage.getItem('pe-startup-probe'); } catch (error) { storage = 'blocked'; }
    checks.push('WebGL2: ' + webgl2);
    checks.push('Workers: ' + (typeof Worker === 'function' ? 'yes' : 'no'));
    checks.push('OffscreenCanvas: ' + (typeof OffscreenCanvas === 'function' ? 'yes' : 'no'));
    checks.push('createImageBitmap: ' + (typeof createImageBitmap === 'function' ? 'yes' : 'no'));
    checks.push('localStorage: ' + storage);
    return checks;
  }

  function report(reason) {
    var lines = [
      'Photo editor startup report',
      'Reason: ' + reason,
      'Page: ' + location.pathname,
      'Browser: ' + navigator.userAgent,
      'Viewport: ' + innerWidth + 'x' + innerHeight + ' @' + (window.devicePixelRatio || 1) + 'x',
      'React root children: ' + (document.getElementById('root') ? document.getElementById('root').childElementCount : 'missing'),
    ].concat(supports());
    lines.push(events.length ? 'Errors:' : 'Errors: none captured');
    for (var i = 0; i < events.length; i += 1) lines.push('  [' + events[i].at + 'ms ' + events[i].kind + '] ' + events[i].message);
    return lines.join('\n');
  }

  function element(tag, text, style) {
    var node = document.createElement(tag);
    if (text) node.textContent = text;
    if (style) node.setAttribute('style', style);
    return node;
  }

  var reasonShown = '';

  function render() {
    var output = panel.querySelector('textarea');
    output.value = report(reasonShown);
  }

  function show(reason) {
    if (panel || started()) return;
    reasonShown = reason;
    panel = element('section', '', 'position:fixed;top:0;right:0;bottom:0;left:0;z-index:2147483647;overflow:auto;padding:1.5rem 1rem;background:#151515;color:#eee;font:16px/1.5 system-ui,-apple-system,sans-serif');
    panel.id = 'editor-startup-failure';
    panel.setAttribute('role', 'alert');
    panel.setAttribute('aria-labelledby', 'editor-startup-title');
    var box = element('div', '', 'max-width:40rem;margin:0 auto');
    var title = element('h1', 'The photo editor did not start', 'font-size:1.4rem;margin:0 0 .75rem');
    title.id = 'editor-startup-title';
    box.appendChild(title);
    box.appendChild(element('p', 'Something stopped the editor before it could appear. Retry, or copy the report below and send it to the site owner. It contains error messages and browser details only, never your photographs.', 'margin:0 0 1rem;color:#bbb'));
    var actions = element('div', '', 'display:flex;flex-wrap:wrap;gap:.75rem;margin:0 0 1rem');
    var retry = element('button', 'Retry', 'min-height:2.75rem;padding:.5rem 1.1rem;border:0;border-radius:4px;background:#eee;color:#111;font:inherit;cursor:pointer');
    retry.type = 'button';
    retry.onclick = function () { location.reload(); };
    var copy = element('button', 'Copy report', 'min-height:2.75rem;padding:.5rem 1.1rem;border:1px solid #666;border-radius:4px;background:none;color:#eee;font:inherit;cursor:pointer');
    copy.type = 'button';
    copy.onclick = function () {
      var output = panel.querySelector('textarea');
      output.focus();
      output.select();
      try {
        if (navigator.clipboard) navigator.clipboard.writeText(output.value).then(function () { copy.textContent = 'Copied'; }, function () {});
        else if (document.execCommand('copy')) copy.textContent = 'Copied';
      } catch (error) { /* the report stays selected for manual copying */ }
    };
    var back = element('a', 'Back to photography', 'display:inline-flex;align-items:center;min-height:2.75rem;color:#eee');
    back.href = location.pathname.replace(/editor\/?$/, '');
    actions.appendChild(retry);
    actions.appendChild(copy);
    actions.appendChild(back);
    box.appendChild(actions);
    var output = element('textarea', '', 'width:100%;min-height:16rem;box-sizing:border-box;padding:.75rem;border:1px solid #444;border-radius:4px;background:#0c0c0c;color:#ddd;font:12px/1.45 ui-monospace,Menlo,monospace');
    output.readOnly = true;
    output.setAttribute('aria-label', 'Startup report');
    box.appendChild(output);
    panel.appendChild(box);
    (document.body || root).appendChild(panel);
    render();
    retry.focus();
    // A slow but successful start removes the panel.
    var poll = setInterval(function () {
      if (!started()) return;
      clearInterval(poll);
      if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
      panel = null;
    }, 1000);
  }

  function showSoon(reason) {
    setTimeout(function () {
      var mount = document.getElementById('root');
      if (!started() && (!mount || !mount.childElementCount)) show(reason);
    }, ERROR_GRACE_MS);
  }

  // Capture phase also sees failed <script>/<link> loads, which do not bubble.
  window.addEventListener('error', function (event) {
    var target = event.target;
    if (target && target !== window && (target.src || target.href)) {
      record('load', 'Could not load ' + pathOf(target.src || target.href));
      showSoon('a page file failed to load');
      return;
    }
    record('error', (event.message || 'Script error') + (event.filename ? ' (' + pathOf(event.filename) + ':' + event.lineno + ':' + event.colno + ')' : ''));
    showSoon('an error stopped the page');
  }, true);

  window.addEventListener('unhandledrejection', function (event) {
    var reason = event.reason;
    record('rejection', reason && reason.message ? reason.message : String(reason));
    showSoon('an unhandled error stopped the page');
  });

  document.addEventListener('securitypolicyviolation', function (event) {
    record('csp', event.violatedDirective + ' blocked ' + (pathOf(event.blockedURI) || event.blockedURI || 'inline code'));
  });

  setTimeout(function () { show('the editor did not start within ' + TIMEOUT_MS / 1000 + ' seconds'); }, TIMEOUT_MS);

  window.__editorStartup = { events: events, report: function () { return report('requested'); } };
}());
