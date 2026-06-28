# Student Insight

**Privacy-first · In-browser AI · Free forever**

A PWA for schools to analyse student performance without sending any data to external servers. All AI runs in the browser. Student data stays in your Google Sheet — always.

---

## Live App

| Environment | URL |
|-------------|-----|
| **Production** | https://sandeephakki.github.io/student-insight/ |
| **QA** | https://sandeephakki-qa.github.io/student-insight/ |

---

## How it works

1. School admin creates a Google Sheet using the provided template
2. Deploys an Apps Script Web App on the sheet (one-time setup, ~5 min)
3. Teachers open the app URL, paste the Web App URL, enter their PIN
4. Marks are entered → AI analysis runs in-browser → PDF reports generated

No data ever leaves the school's Google Sheet. No servers. No tracking. No API keys.

---

## Repo structure

```
index.html        ← The entire app (single-file PWA)
manifest.json     ← PWA install manifest
sw.js             ← Service worker (offline caching)
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

## Apps Script setup (one-time per school)

1. Open your school's Google Sheet
2. **Extensions → Apps Script**
3. Paste the Apps Script code (provided separately as `script_google_sheet`)
4. **Deploy → New deployment**
   - Type: **Web App**
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Copy the Web App URL
6. Open the Student Insight app → paste the URL → Connect

---

## Tech stack

- Vanilla JS + jQuery (no build step, no Node, no bundler)
- Google Sheets as database (via Apps Script Web App)
- SHA-256 PIN auth (browser `crypto.subtle` — no plaintext ever stored)
- PDF generation via jsPDF
- Charts via Chart.js
- PWA: manifest + service worker

---

## Pilot

Hakki Public School, Bangalore — Class 6B, 2026

---

## Licence

MIT — free to use, fork, and deploy. Attribution required.  
Built by Sandeep Hakki as a social cause project.
