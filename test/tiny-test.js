/* ============================================================
   Tiny zero-dependency test runner.
   No npm install needed — plain Node. Deliberately minimal:
   this project has no build step (see index.html's own PIB notes
   on that being an intentional constraint), so the test setup
   shouldn't introduce one either.

   Usage: node test/compute-engine.test.js
   Exit code 0 = all pass, 1 = at least one failure (CI-friendly).
   ============================================================ */
let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    fail++;
    failures.push({ name, error: e.message });
  }
}

function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error((msg ? msg + " — " : "") + `expected ${e}, got ${a}`);
  }
}

function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    failures.forEach(f => console.log(`  ✗ ${f.name}\n    ${f.error}`));
  }
  process.exitCode = fail ? 1 : 0;
}

module.exports = { test, assertEqual, summary };
