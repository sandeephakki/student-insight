# dev-tests

Node.js scripts that unit-test the scholarship eligibility engine
(`bal/scholarship/scholarship-eligibility-engine.js`,
`scholarship-completeness-grid.js`, `scholarship-report-views.js`)
against a fixture roster (`students.json`). Not loaded by the app.
Run from the project root:

```
npm run test:engine
npm run test:completeness
npm run test:report-views
```
