// Loads the Cloudflare Web Analytics beacon — but ONLY on the real prod
// domain. Two problems this fixes vs. the old static <script data-cf-
// beacon> tag that used to sit directly in <head>:
//
//   1. Cloudflare's beacon internally executes an inline script once it
//      loads, which our CSP's script-src (no 'unsafe-inline', by design —
//      see the CSP hardening notes in index.html) blocks outright:
//      "Executing inline script violates ... script-src 'self' ...".
//   2. The beacon then tries to POST/XHR its RUM payload to
//      cloudflareinsights.com. Cloudflare's endpoint only sets a matching
//      Access-Control-Allow-Origin for the domain the token is actually
//      registered to (studin.in), so from local dev
//      (http://127.0.0.1:*, http://localhost:*) or the QA host every
//      request fails as a CORS error — pure console noise, since
//      analytics for an unregistered origin was never going to work
//      anyway.
//
// Mirrors the same hostname check js/env-config.js already uses to
// distinguish prod/QA/local, so behavior stays consistent between the
// two files. Loaded as a plain external script (not inline) so it never
// itself trips the CSP inline-script rule.
(function(){
  var h = location.hostname;
  var isProd = !(h.includes("sandeephakki-qa") || h.includes("localhost") || h.includes("127."));
  if (!isProd) return;

  var s = document.createElement("script");
  s.type = "module";
  s.src = "https://static.cloudflareinsights.com/beacon.min.js";
  s.setAttribute("data-cf-beacon", '{"token": "5d1b88ed8f544c49995869f42e8d127c"}');
  document.head.appendChild(s);
})();
