# Student Insight

**Privacy-first · In-browser AI · Free forever**

A PWA for schools to analyse student performance without sending any data to external servers. All analysis runs in the browser. The app is stateless — you import an Excel/CSV file of marks, work with it in the session, and export PDF report cards. No accounts, no backend database, and no student data is persisted anywhere outside your own device (page memory only — closing or refreshing the tab discards the session; see "Trust & Privacy" in the app's About panel).

---

## Live App

| Environment | URL |
|-------------|-----|
| **Production** | https://sandeephakki.github.io/student-insight/ |
| **QA** | https://sandeephakki-qa.github.io/student-insight/ |

---

## How it works

1. Teacher sets up the class (institution, subjects, tests, scoring rules, alert thresholds) — or skips this and lets the app infer it from the uploaded workbook.
2. Marks are imported from an Excel workbook with two sheets, `STUDENTS` and `MARKS+CONTEXT` (a downloadable template and four sample class-marks spreadsheets are available via "Download Template" / the "Sample Files" button).
3. Analysis runs entirely in-browser across five categories the teacher can toggle: performance (averages, rank, trend, predictions), warnings (at-risk, sharp drops, plateaus), narrative summaries (parent summaries, study plans, intervention notes), wellbeing (stress/burnout/resilience indicators), and management-level class health.
4. A tabbed dashboard (KPIs, student cards, heatmap, flags table, wellbeing panel, charts) and exportable PDF reports (per-student report card, teacher summary, management report) are generated and downloaded locally.

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

---

## Sample files

Four sample class-marks spreadsheets are hosted in the `samples/` folder of this repo and are linked from the "Sample Files" button next to About in the app. They're handy for trying the app out or as a template for formatting your own class data.

---

## Tech stack

- Vanilla JS + jQuery 3.7.1 (no build step, no Node, no bundler)
- Stateless in-browser data model (no backend, no database, no persisted storage)
- Excel/CSV import & export via SheetJS (xlsx 0.18.5)
- PDF generation via jsPDF 2.5.1 (with JSZip 3.10.1 as a supporting dependency)
- Charts via Chart.js 4.4.1
- Fonts: Google Fonts "Inter" + "DM Sans"
- PWA: manifest + service worker (app shell cached for offline use)

> **Known open item:** only the jQuery `<script>` tag is currently SRI-pinned; the SheetJS/jsPDF/JSZip/Chart.js CDN tags are not yet pinned with integrity hashes. Contributions welcome.

---

## Pilot

Hakki Public School, Bangalore — Class 6B, 2026

---

## Licence

MIT — free to use, fork, and deploy. Attribution required.
Built by Sandeep Hakki as a social cause project.
