# dev-tests

Node.js scripts used during development to unit-test the scholarship
eligibility engine (`js/scholarship-eligibility-engine.js`,
`js/scholarship-completeness-grid.js`, `js/scholarship-report-views.js`)
against a fixture roster (`students.json`). Not loaded by the app — `index.html`
never references this folder. Run any of them from the project root with:

```
node dev-tests/test-engine.js
node dev-tests/test-completeness.js
node dev-tests/test-report-views.js
```

Moved here from the project root, where they'd previously been left alongside
the shipped app files; their `require()` paths were also pointing at a
`studin-prod/js/...` folder that doesn't exist in this package (the real path
is just `js/...`), so they wouldn't have run as-is. Fixed and verified to pass.
