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
3. Marks are imported from an Excel workbook with two sheets, `SETUP` and `MARKS+CONTEXT` (a downloadable template and six sample spreadsheets — four institution, two individual — are available via "Download Template" / the "Sample Files" button).
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

---

## Sample files

Six sample spreadsheets — four Institution-mode class examples and two Individual-mode (parent/aspirant) examples — are hosted in the `samples/` folder of this repo and are linked from the "Sample Files" button next to About in the app. They're handy for trying the app out or as a template for formatting your own class data.

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
