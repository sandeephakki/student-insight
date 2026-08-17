# Student Insight

**Privacy-first · In-browser AI · Free forever**

A PWA for schools to analyse student performance without sending any data to external servers. All analysis runs in the browser. The app is stateless — you import an Excel/CSV file of marks, work with it in the session, and export PDF report cards. No accounts, no backend database, and no student data is persisted anywhere outside your own device (page memory only — closing or refreshing the tab discards the session; see "Trust & Privacy" in the app's About panel).

---

## Live App

| Environment | URL |
|-------------|-----|
| **Production** | https://studin.in/ |
| **QA** | https://sandeephakki-qa.github.io/student-insight/ |

> Production is served via GitHub Pages on a custom domain (`studin.in`) —
> requires a `CNAME` file at the repo root containing `studin.in`, plus a DNS
> `A`/`ALIAS` record pointed at GitHub Pages. QA stays on the default
> `github.io` project URL.

---

## How it works

1. On first visit, the app asks whether you're an **Institution/Teacher** or an **Individual/Parent** — this sets up the right layout below (switchable later in Setup).
2. Teacher sets up the class (institution, subjects, tests, scoring rules, alert thresholds) — or skips this and lets the app infer it from the uploaded workbook.
3. Marks are imported from an Excel workbook — a `SETUP` tab (institution/class/subjects/tests/scoring config), a `STUDENTS` tab (roster), and one tab per test — (a downloadable template and 15 sample spreadsheets covering school, PU/junior college, UG, coaching-centre and individual-parent scenarios are available via "Download Template" / the "Sample Files" button).
4. Analysis runs entirely in-browser across five categories the teacher can toggle: performance (averages, rank, trend, predictions), warnings (at-risk, sharp drops, plateaus), narrative summaries (parent summaries, study plans, intervention notes), wellbeing (stress/burnout/resilience indicators), and management-level class health.
5. A tabbed dashboard (KPIs, student cards, heatmap, flags table, wellbeing panel, charts) and exportable PDF reports (per-student report card, teacher summary, management report) are generated and downloaded locally.
6. **Compare Sections / Batches** (Institution mode): managing more than one class or batch — Class 5-A/B/C, a coaching batch A/B, anything? Upload each section's already-filled sheet directly — no manual re-entry of Subjects/Tests/Max Marks required, since the first file you upload sets the shared schema automatically — and see every section ranked and charted side by side (section-level comparison, not student-vs-student).

No data ever leaves the device. No servers. No tracking. No API keys. Nothing is saved between sessions unless you explicitly export a file.

---

## Repo structure

```
index.html        ← The entire app (single-file PWA)
manifest.json     ← PWA install manifest
sw.js             ← Service worker (offline caching of the app shell + CDN libs)
.github/
  workflows/
    deploy.yml    ← Auto-deploy to GitHub Pages on push to main
README.md         ← This file
```

---

## Deploy your own copy

1. Fork this repo
2. Go to **Settings → Pages → Source → GitHub Actions**
3. Push any change to `main` — the workflow auto-deploys
4. Your app is live at `https://<your-username>.github.io/student-insight/`
5. *(Optional)* Point a custom domain at it: add a `CNAME` file at the repo root containing your domain, then create a matching DNS record — see [GitHub's custom domain guide](https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site). Production here uses this to serve at `studin.in`.

### Testing locally

As of the module-system conversion (`js/*.js` are now ES modules, loaded via
`<script type="module">`), opening `index.html` directly via `file://` (double-
click) no longer works — browsers block ES module loading over `file://` for
CORS reasons. This doesn't affect Production/QA (both serve over `https://`),
only local testing. Serve the folder over plain HTTP instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

Any static server works (`npx serve`, VS Code's Live Server extension, etc).

---

## Sample files

15 sample spreadsheets are hosted in the `samples/` folder of this repo and linked from the "Sample Files" button next to About in the app — covering pre-primary through PG/professional programs (UPSC coaching, MBBS, an international Master's program, primary/high school, PU/junior college, plain UG, a 100-student scale example, and two individual/parent examples), plus Compare-Sections examples for the same class split into three sections. They're handy for trying the app out or as a template for formatting your own class data. See `samples/README.md` for the full breakdown of what each one demonstrates.

One of the 15 (`Sample_11_..._CONTINUITY.xlsx`) uses a different, multi-period schema — see "Continuity feature" below. It works with the app (as of v4.36) and is included in the one-click "Sample Files" picker as Sample 11, which only works live once this file is uploaded to studin.in; until then, download it from `samples/` and use "Import Filled Excel" instead.

---

## Continuity feature

Tracks one cohort across multiple periods (a class across school years, a section across semesters) in a single workbook — roster continuity (who joined/left), cohort trend charts, per-student trajectory + trend projection, and terminology that adapts to school vs. college automatically. As of v4.36 this works end-to-end on a real file: upload a workbook whose `SETUP` tab has `Period Count` > 1 (repeated `Period N Label`/`Subjects`/`Tests` blocks) plus a shared `STUDENTS` roster and `<PeriodLabel>-Test<N>` marks tabs, and the Continuity tab appears with real data — see `samples/Sample_11_For_Engineering_College_Sem1to5_CONTINUITY.xlsx` for a working example. The current (most recent) period gets the full detailed dashboard/PDF treatment; earlier periods feed the lighter Continuity trend view only.

Still open: there's no in-app way to *build up* a multi-period file incrementally (re-upload last year's file, add this year's data, get a new period appended automatically) — you construct the multi-period workbook by hand today, following Sample 11's structure. See the PIB in `index.html` (§7 `parseContinuityPeriods`, §9 `continuity-schema-now-built-v4.36`) for full technical status.

---

## Tech stack

- Vanilla JS + jQuery 3.7.1 (no build step, no Node, no bundler)
- Stateless in-browser data model (no backend, no database, no persisted storage)
- Excel/CSV import & export via SheetJS (xlsx 0.18.5)
- PDF generation via jsPDF 2.5.1 (with JSZip 3.10.1 as a supporting dependency)
- Charts via Chart.js 4.4.1
- Fonts: SF Pro Display / SF Pro Text (native on Apple devices, falls back to system-ui/-apple-system elsewhere)
- PWA: manifest + service worker (app shell cached for offline use)

> **Known open item:** jQuery, SheetJS (xlsx-js-style), jsPDF, and JSZip are SRI-pinned (hashes verified against each package's npm-published dist file). Chart.js remains unpinned — its dist file changes across versions in a way that made guessing a stable hash unsafe. Contributions welcome.

---

## Design system

The UI follows an Apple-inspired visual language (tokens live in `css/core.css`, all under the existing `--c-*`/`--r-*`/`--e-*` variable names, so no markup changes were needed):

- **Colour** — single blue accent `#0066cc` (`#2997ff` in dark mode) for every interactive element; ink `#1d1d1f` on white/`#f5f5f7` canvases; true-black `#000` page background in dark mode with `#1d1d1f` tile surfaces.
- **Typography** — SF Pro Display (headings, weight 600, tight negative letter-spacing) / SF Pro Text (body, weight 400), falling back to `-apple-system`/`system-ui` on non-Apple platforms.
- **Shape** — pill-radius (`--r-pill`) buttons and chips, `8px`/`11px`/`18px` step radii for compact/utility/card surfaces.
- **Depth** — soft neutral shadow scale (`--e-1`…`--e-4`); a single stronger `--c-product-shadow` token reserved for product-style imagery.
- **Motion** — buttons scale to `0.95` on press (`:active`); cards lift `-2px` with a shadow bump on hover.
- **Glass** — the top bar, step nav, and sticky phase action bar use real frosted glass (`backdrop-filter: saturate(180%) blur(20px)` over an 80%-opacity surface) instead of a flat background.
- Dark mode is a token-only override (`[data-theme="dark"]`) — no structural CSS duplication.

---

## Pilot

Hakki Public School, Bangalore — Class 6B, 2026

---

## Licence

MIT — free to use, fork, and deploy. Attribution required.
Built by Sandeep Hakki as a social cause project.
