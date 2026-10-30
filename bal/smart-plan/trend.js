// bal/smart-plan/trend.js  (Smart Planner task 14, amendment A3) - pure logic, no DOM, no app imports.
// ONE small deterministic line per student: facts computed from the marks that are sent, never opinion.
//   <trend overall="80>59>38>14" direction="sharp_decline" netChange="-66" lastStep="-24" weakest="Science"/>
// Thresholds live in quality-config.js.
import { TREND_SHARP_DROP_PCT, TREND_DROP_PCT, TREND_LAST_STEP_DROP_PCT, TREND_RISE_PCT, TREND_SHARP_RISE_PCT } from './quality-config.js';

const DIRECTIONS = ['single_test', 'steady', 'improving', 'strong_improvement', 'decline', 'sharp_decline'];

// Direction from the overall series. Net change (last vs first) decides; the last step only matters when it is a sharp fall, or when
// the net change is flat. (A student who went 48>89>79 has clearly improved - the 10-point dip is shown in lastStep, not called a decline.)
function directionFor(series) {
  if (!series || series.length < 2) return 'single_test';
  const last = series[series.length - 1], net = last - series[0], step = last - series[series.length - 2];
  if (net <= -TREND_SHARP_DROP_PCT) return 'sharp_decline';
  if (step <= -TREND_SHARP_DROP_PCT) return net < 0 ? 'sharp_decline' : 'decline';   // a big last-test fall after a net GAIN is a dip, not a collapse
  if (net <= -TREND_DROP_PCT) return 'decline';
  if (net >= TREND_SHARP_RISE_PCT) return 'strong_improvement';
  if (net >= TREND_RISE_PCT) return 'improving';
  if (step <= -TREND_LAST_STEP_DROP_PCT) return 'decline';
  return 'steady';
}

// tests: [{ marks: {subject: score}, max: {subject: maxMarks} }] in test order (only tests that have >=1 entered mark).
// Returns null when there is nothing to compute.
function computeTrend(tests) {
  const series = []; const bySubject = {};
  for (const t of tests || []) {
    let sum = 0, tot = 0;
    for (const sub of Object.keys(t.marks || {})) {
      const sc = Number(t.marks[sub]); const mx = Number((t.max || {})[sub]) || 100;
      if (!isFinite(sc) || sc < 0) continue;
      sum += sc; tot += mx;
      (bySubject[sub] = bySubject[sub] || []).push(sc / mx * 100);
    }
    if (tot > 0) series.push(Math.round(sum / tot * 100));
  }
  if (!series.length) return null;
  let weakest = '', weakestPct = Infinity;
  for (const sub of Object.keys(bySubject)) { const a = bySubject[sub]; const avg = a.reduce((x, y) => x + y, 0) / a.length; if (avg < weakestPct) { weakestPct = avg; weakest = sub; } }
  const last = series[series.length - 1], prev = series.length > 1 ? series[series.length - 2] : null;
  const net = series.length > 1 ? last - series[0] : 0, step = prev == null ? 0 : last - prev;
  const direction = directionFor(series);
  return { series, direction, netChange: net, lastStep: step, weakest, weakestPct: Math.round(weakestPct) };
}

const isDecline = d => d === 'decline' || d === 'sharp_decline';
const isImprove = d => d === 'improving' || d === 'strong_improvement';

// `scrub` hides the institution/student words in the subject name, `xe` escapes XML - both injected by the prompt builder.
function trendXml(tr, scrub, xe) {
  if (!tr) return '';
  const sc = scrub || (s => s), esc = xe || (s => s);
  return `<trend overall="${tr.series.join('>')}" direction="${tr.direction}" netChange="${tr.netChange}" lastStep="${tr.lastStep}" weakest="${esc(sc(tr.weakest))}"/>`;
}

export { computeTrend, directionFor, trendXml, isDecline, isImprove, DIRECTIONS };
