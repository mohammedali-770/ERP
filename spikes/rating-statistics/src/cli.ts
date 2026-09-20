/**
 * npm run spike:rating-statistics
 *
 * Proves the rating statistics (RTG-P03, RTG-P04, RTG-P05, proposed) before
 * anything is built on them. Needs no data and no service.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import {
  runSampleSizeScenario, runAttributionScenario,
  type SampleSizeConfig, type AttributionConfig,
} from './scenario.ts';

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return fallback;
  const v = Number(process.argv[i + 1]);
  return Number.isFinite(v) ? v : fallback;
}

const seed = arg('seed', 20260918);

const sampleConfig: SampleSizeConfig = {
  people: arg('people', 100),
  periods: arg('periods', 300),
  minSample: arg('min-sample', 30),
  responseRate: 0.25,
  bottomSetSize: 3,
  seed,
};

const attributionConfig: AttributionConfig = {
  orders: arg('orders', 60_000),
  drivers: 30,
  branches: 6,
  responseRate: 0.25,
  driverQualityBase: 0.86,
  kitchenQualityBaseline: 0.88,
  kitchenQualityDegraded: 0.55,
  seed,
};

console.log('spike:rating-statistics — proves RTG-P03, RTG-P04, RTG-P05 (proposed)\n');
console.log(`  people / periods    ${sampleConfig.people} / ${sampleConfig.periods}`);
console.log(`  minimum sample      ${sampleConfig.minSample} ratings`);
console.log(`  response rate       ${sampleConfig.responseRate}`);
console.log(`  orders (gate B)     ${attributionConfig.orders}`);
console.log(`  seed                ${seed}\n`);

const started = Date.now();

// -- Gate A ------------------------------------------------------------------
const sample = runSampleSizeScenario(sampleConfig);
console.log('Gate A — sample size and ranking');
console.log(`  scores shown below threshold        ${sample.scoresShownBelowThreshold}`);
console.log(`  rankings naming an unrankable person ${sample.rankedBelowThreshold}`);
console.log(`  ranking decisions judged             ${sample.decisions}`);
console.log(`  named worst was above the median     ${sample.namedWorstAboveMedian}  (${(sample.namedWorstAboveMedianRate * 100).toFixed(1)}%)`);
console.log(`  named worst was truly bottom decile  ${sample.namedWorstInBottomDecile}  (${((sample.namedWorstInBottomDecile / sample.decisions) * 100).toFixed(1)}%)`);
console.log(`  bottom-3 agreement between draws     ${sample.bottomSetOverlapMean.toFixed(2)} of 3`);
console.log(`  draws named nobody in common         ${sample.bottomSetDisjoint}  (${(sample.bottomSetDisjointRate * 100).toFixed(1)}%)`);
console.log(`  median ratings behind the naming     ${sample.medianRatingsOfNamedWorst}`);
console.log(`  ${sample.passed ? 'PASS' : 'FAIL'}\n`);

const leagueTable = runSampleSizeScenario({ ...sampleConfig, leagueTable: true, seed: seed + 1 });
const controlA = !leagueTable.passed && leagueTable.namedWorstAboveMedian > 0;
console.log(`  control (raw-mean league table) detected: ${controlA ? 'YES' : 'NO'}`);
console.log(`    named someone above the median in ${leagueTable.namedWorstAboveMedian} of ${leagueTable.decisions} decisions (${(leagueTable.namedWorstAboveMedianRate * 100).toFixed(1)}%)`);
console.log(`    median ratings behind those namings: ${leagueTable.medianRatingsOfNamedWorst}`);
console.log(`    named an unrankable person ${leagueTable.rankedBelowThreshold} times`);
console.log(`    two draws named nobody in common in ${(leagueTable.bottomSetDisjointRate * 100).toFixed(1)}% of periods\n`);

// -- Gate B ------------------------------------------------------------------
const attribution = runAttributionScenario(attributionConfig);
console.log('Gate B — attribution');
console.log(`  kitchen degraded by                 ${attribution.kitchenDropPp.toFixed(0)}pp`);
console.log(`  largest driver score movement       ${attribution.maxDriverShiftPp.toFixed(2)}pp`);
console.log(`  drivers wrongly downgraded (>5pp)   ${attribution.driversWronglyDowngraded}`);
console.log(`  ${attribution.passed ? 'PASS' : 'FAIL'}\n`);

const fanOut = runAttributionScenario({ ...attributionConfig, fanOut: true });
const controlB = !fanOut.passed && fanOut.driversWronglyDowngraded > 0;
console.log(`  control (fan-out attribution) detected: ${controlB ? 'YES' : 'NO'}`);
console.log(`    ${fanOut.driversWronglyDowngraded} of ${fanOut.drivers} drivers lost more than 5pp`);
console.log(`    largest movement ${fanOut.maxDriverShiftPp.toFixed(2)}pp, mean ${fanOut.meanDriverShiftPp.toFixed(2)}pp\n`);

const elapsed = Date.now() - started;

const controlsDetected = controlA && controlB;
const passed = sample.passed && attribution.passed && controlsDetected;

const report = {
  spike: 'rating-statistics',
  requirements: ['RTG-P03', 'RTG-P04', 'RTG-P05'],
  seed,
  elapsedMs: elapsed,
  gateA: sample,
  gateB: attribution,
  controls: {
    leagueTable: { detected: controlA, result: leagueTable },
    fanOutAttribution: { detected: controlB, result: fanOut },
  },
  passed,
};

mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
writeFileSync(new URL('../out/report.json', import.meta.url), `${JSON.stringify(report, null, 2)}\n`);

if (!controlsDetected) {
  console.error('  A control case did NOT fail.');
  console.error('  A pass from this harness would mean nothing. Fix the harness before reading the result.');
}

for (const f of [...sample.failures, ...attribution.failures]) console.error(`  FAILURE: ${f}`);

console.log(`  wall time ${elapsed} ms`);
console.log(`\n  ${passed ? 'PASS' : 'FAIL'} — report written to spikes/rating-statistics/out/report.json`);
process.exit(passed ? 0 : 1);
