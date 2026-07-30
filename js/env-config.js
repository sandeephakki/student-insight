/* ============================================================
   ENV CONFIG — single source of truth for environment-specific
   values (asset base URL, project page URL, env label).

   No manual "point to QA or Prod" step needed at deploy time —
   this auto-detects from location.hostname at runtime, so the
   exact same files can be pushed to either repo/host unchanged.

   To add another environment (e.g. a new QA host, a custom
   staging domain), just add one more branch below.
   ============================================================ */
(function(){
  var h = location.hostname;

  var ENVS = {
    prod: {
      label: "PROD",
      // Sample .xlsx files + anything else served from the site root
      assetBase: "https://studin.in/",
      projectPageUrl: "https://studin.in/"
    },
    qa: {
      label: "QA",
      // Verified directly (raw.githubusercontent.com HEAD checks, 2026-07-22):
      // the QA repo keeps sample .xlsx files under /samples/, unlike prod
      // which flattens them to the site root. Pointing this at root (as it
      // was before) 404'd on every "Try Now" click — see PIB changelog v4.1.
      assetBase: "https://sandeephakki-qa.github.io/student-insight/samples/",
      projectPageUrl: "https://sandeephakki-qa.github.io/student-insight/"
    },
    local: {
      label: "LOCAL",
      // Sample files live in /samples locally; prod/QA serve them flattened at root
      assetBase: "samples/",
      projectPageUrl: "https://studin.in/"
    }
  };

  var env;
  if (h.includes("sandeephakki-qa")) env = ENVS.qa;
  else if (h.includes("localhost") || h.includes("127.")) env = ENVS.local;
  else env = ENVS.prod; // studin.in and any other custom/prod host default here

  window.APP_CONFIG = {
    env: env.label,
    assetBase: env.assetBase,     // prefix for sample files etc — use directly, always ends in "/" (or is "")
    projectPageUrl: env.projectPageUrl
  };
})();
