# Student Insight (StudIn)

**Privacy-first · In-browser analytics · Open source**

**StudIn with Excel** is an open-source PWA that lets schools, colleges, coaching centres and parents analyse student performance **without sending any data to a server**. You import an Excel workbook of marks, work with the results in the page, and export PDF report cards. No accounts, no backend, no database: student data lives only in page memory, so closing or refreshing the tab discards the session (see "Trust & Privacy" in the app's About panel).

> Stateless by design. The only things kept in the browser are non-student UI/QA items: theme choice, "seen" flags (intro, videos, shell hint), the onboarding language, a left-rail open/closed flag, the StudInPro form-submitted flag, a "recent files" list (file / institution / class / section names only) and a counts-and-codes debug log. Never marks, scores or student IDs.

---

## Live app

| Environment | URL |
|-------------|-----|
| **Production** | https://studin.in/ |
| **QA** | https://sandeephakki-qa.github.io/student-insight/ |

Production is served by GitHub Pages on a custom domain (`CNAME` at the repo root contains `studin.in`, plus a DNS `A`/`ALIAS` record). QA stays on the default `github.io` project URL.

---

## Editions

| | **StudIn with Excel** (this repository) | **StudInPro** (planned) |
|---|---|---|
| Licence | Open source (MIT) | Separate edition |
| Data | Your Excel workbook; nothing stored or sent anywhere | Database-based |
| Setup | You fill and re-import a workbook | Remembered automatically |
| Scope | One file at a time, local storage only | Multi-year tracking, cloud backup on any device, school-wide dashboards |
| Features | Dashboard, Compare, Continuity, Scholarship, Smart Search, PDF reports | Everything in the Excel edition, plus the database-backed features |

StudIn with Excel stays open source and keeps working as it does today. StudInPro is for institutions that find managing Excel files difficult and want more; it does not replace or limit the Excel edition. Interested? Use "Tell us about your school" on the About page, or write to sandeep@hakki.in. The Pro column is a plan, not a shipped product: nothing in this repository depends on it, and details (including any pricing) will be published when it is ready.

---

## How it works

1. First visit: choose **Institution/Teacher** or **Individual/Parent** (switchable later in Setup).
2. Set up the class (institution, subjects, tests, scoring rules, alert thresholds), or skip it and let the app infer everything from the uploaded workbook.
3. Import an Excel workbook: a `SETUP` tab, a `STUDENTS` roster tab and one tab per test. Each test tab has marks per subject, absent days, an optional **`<Subject> Chapter`** column per subject (the chapter that subject's paper covered; fill it once, it applies to the whole class) and an optional remark. A downloadable template and 11 sample files (school, PU/junior college, coaching, MBBS, UPSC, international master's, individual child, scholarship eligibility, continuity) are built in.
4. Analysis runs entirely in the browser: performance (averages, rank, trend, predictions), warnings (at-risk, sharp drops, plateaus), rule-based narratives (parent summary, home plan, school plan, strengths letter), wellbeing indicators and class-level health. All narrative text is template-based, not AI-generated.
5. Explore a bucket-driven dashboard (whole class, one student, one subject, who needs help, top performers, clusters, continuity, smart search) and export PDFs: per-student report card, teacher report, management report, or a ZIP of everything.

Extra modes:

- **Compare Sections / Batches** (Institution mode): upload several already-filled files (Class 5-A/B/C, coaching batches...). The first file sets the shared schema; every section is analysed and compared side by side, with a section comparison report and per-section exports.
- **Continuity**: one workbook with `Period Count` > 1 tracks a cohort across school years or semesters (roster joins/leaves, cohort trends, per-student trajectory). See `samples/Sample_07_*_CONTINUITY.xlsx`.
- **Scholarship eligibility** (India): scheme configuration, eligibility engine with audit trail, shortlist / by-category / subject-topper views, XLSX report and certificates.
- **Smart Planner** (on by default; `Feature_SmartPlanner: No` in the `SETUP` tab hides it): pick tests and students, download a prompt that contains only student IDs, run it in any AI assistant you like, upload the result and get a personal study-plan PDF per student. The upload is checked against a per-session validation code, and any chapter claim that does not match your data is marked unverified in the PDF.
- **Smart Search**: ask plain-language questions about the loaded data; answers come from a local question bank (`knowledge/smart-questions.json`), no network.
- **Languages**: English plus 16 more (Hindi, Kannada, Tamil, Telugu, Marathi, Bengali, Gujarati, Malayalam, Punjabi, Odia, Assamese, Urdu, German, French, Russian, Chinese), lazy-loaded.

Nothing leaves the device. No tracking of student data. No API keys.

---

## Architecture

Static site, **no build step**: native ES modules loaded through a single entry point, `core/main.js`.

```
index.html     shell + markup (one <script type="module" src="core/main.js">)
core/          boot, state, i18n, shared helpers, app shell
ui/            per-feature UI (common/, compare/, export/, scholarship/)
bal/           business logic: pure, no DOM (common/, compare/, export/, scholarship/, smart-search/)
dal/           data access (in-memory today; swap point for a future database tier)
css/ i18n/ knowledge/ data/ samples/ img/
dev-tests/     node tests (scholarship engine)      scripts/  guards + generators
```

Rules (full ruleset and decisions log in [`planner.md`](planner.md); AI/dev reference in [`PIB.md`](PIB.md)):

- **Layers**: UI → BAL → DAL. `bal/` never imports `ui/` and never touches page DOM, jQuery, toasts or navigation.
- **Acyclic imports**: the static import graph is a DAG. A module imports only from layers below it. An upward call goes through a port (`core/ports.js`): `const goStep = port('goStep')` in the caller, `provide({ goStep })` in the provider.
- **Feature toggles**: `Feature_X: Yes/No` rows in the `SETUP` tab (Scholarship, Compare, Smart Search, Reports). A missing row means on. See `core/feature-registry.js` and `core/read-feature-flags.js`.
- **Offline**: `sw.js` precaches the whole app shell at install, so the app works offline from the first visit (other languages are cached on first use).

### Developer commands

```bash
python3 -m http.server 8000      # modules need HTTP; file:// will not work, then open http://localhost:8000/
npm run check:all                # cycles + layer rule + SW list + i18n lint + unit tests
npm run check:cycles             # import graph must be acyclic and every import path must resolve
npm run check:layers             # bal/ may not use ui/ or the DOM
npm run gen:sw                   # regenerate the service-worker precache list (run after adding/removing files)
npm run check:sw                 # fail if that list is stale
npm run lint:i18n                # locale key parity + hardcoded-string lint
npm run test:engine              # also: test:completeness, test:report-views
```

After adding or removing any JS, CSS or `en.json` file: run `npm run gen:sw` and bump `CACHE_VERSION` in `sw.js`. New modules must be imported from `core/main.js`.

---

## Deploy

No build, no server code: upload the repository folder to any static host.

**GitHub Pages**: fork the repo, enable Pages (branch or Actions), push to `main`. To use a custom domain add a `CNAME` file with your domain and a matching DNS record ([GitHub guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site)). Production uses this for `studin.in`.

Returning users get updates automatically when `CACHE_VERSION` in `sw.js` changes.

Security headers such as `frame-ancestors` cannot be set from the `<meta>` CSP; set them at the host (for example a `_headers` file).

---

## Sample files

11 spreadsheets in `samples/` (also reachable from the "Sample Files" button in the app): school sections A/B/C for Compare, PU/junior college, a 100-student scale file, MBBS, an engineering college continuity file, an international master's programme, UPSC coaching, an individual/parent file and a scholarship-eligibility file. They double as formatting templates. `samples/README.md` describes what each one demonstrates.

---

## Tech stack

- Vanilla JavaScript as native ES modules, plus a small jQuery-compatible DOM helper (`core/dom-shim.js`). jQuery itself is not loaded.
- Excel import/export: `xlsx-js-style` 1.2.0 (SheetJS 0.18.5 core with cell-style writing)
- PDF: jsPDF 2.5.1, ZIP bundles: JSZip 3.10.1
- Charts: Chart.js 4.4.1
- Optional modal polish: GSAP 3.12.4 (the app works without it)
- PWA: `manifest.json` + `sw.js`
- All libraries load from CDNs at pinned versions. xlsx-js-style, jsPDF, JSZip and GSAP carry SRI hashes. **Chart.js is version-pinned but has no SRI hash** (cdnjs serves its own minified build, so a hash has to be computed from cdnjs itself before it can be added safely). `package.json` ranges intentionally track newer releases so `npm audit`/Dependabot flag upgrades; the pins in `index.html` are authoritative at runtime.

---

## Design system

Tokens live in `css/core.css` (`--c-*` colours, `--r-*` radii, `--e-*` shadows, `--fs-*`/`--lh-*` type scale).

- **Colour**: primary green `#0F5C4E` (`#3DA88F` in dark mode) with soft tints for surfaces.
- **Type**: SF Pro Text/Display where available, falling back to Inter, then the system UI font.
- **Shape and depth**: pill-radius buttons and chips, stepped card radii, a soft four-step shadow scale.
- **Dark mode**: token-only override under `[data-theme="dark"]`, no duplicated structural CSS. The saved choice is applied before first paint by `core/theme-init.js`.
- **Mobile**: the app-shell side panels become a top strip and a bottom sheet at 768px and below.

---

## Pilot

Hakki Public School, Bangalore, Class 6B, 2026.

---

## Licence

MIT. Open source: use, fork and deploy it; the licence and copyright notice must be kept (see `LICENSE.md`).
Built by Sandeep Hakki as a social-cause project.
