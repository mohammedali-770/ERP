import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  wilsonLowerBound, present, presentRawMeans, rankWorst, rankWorstByRawMean,
  ATTRIBUTION, FAN_OUT_ATTRIBUTION, attributesTo, type Tally,
} from '../src/model.ts';
import {
  runSampleSizeScenario, runAttributionScenario,
  type SampleSizeConfig, type AttributionConfig,
} from '../src/scenario.ts';

const SAMPLE: SampleSizeConfig = {
  people: 60, periods: 40, minSample: 30, responseRate: 0.25, bottomSetSize: 3, seed: 4242,
};

const ATTRIB: AttributionConfig = {
  orders: 20_000, drivers: 20, branches: 4, responseRate: 0.25,
  driverQualityBase: 0.86, kitchenQualityBaseline: 0.88, kitchenQualityDegraded: 0.55, seed: 4242,
};

const TALLIES: Tally[] = [
  { id: 'sparse', satisfied: 0, n: 2 },    // 0% — and meaningless
  { id: 'solid', satisfied: 150, n: 200 }, // 75% over a real sample
];

test('wilson lower bound distrusts a sparse sample more than a large one', () => {
  assert.equal(wilsonLowerBound(0, 0), 0);
  assert.ok(wilsonLowerBound(2, 2) < wilsonLowerBound(200, 200));
  assert.ok(wilsonLowerBound(15, 20) < wilsonLowerBound(150, 200));
});

test('RTG-P04: below the minimum sample there is no number at all', () => {
  const shown = present(TALLIES, 30);
  const sparse = shown.find((s) => s.id === 'sparse')!;
  assert.equal(sparse.score, null, 'a provisional score is still a score');
  assert.equal(sparse.lowerBound, null);
  assert.notEqual(shown.find((s) => s.id === 'solid')!.score, null);
});

test('RTG-P05: nobody below the threshold can be ranked', () => {
  assert.deepEqual(rankWorst(present(TALLIES, 30), 3), ['solid']);
});

test('the control ranks the two-rating person bottom — which is the whole problem', () => {
  assert.equal(rankWorstByRawMean(presentRawMeans(TALLIES), 1)[0], 'sparse');
});

test('RTG-P03: food quality does not attribute to the driver', () => {
  assert.equal(attributesTo(ATTRIBUTION, 'food_quality', 'driver'), false);
  assert.equal(attributesTo(ATTRIBUTION, 'overall', 'driver'), false);
  assert.equal(attributesTo(ATTRIBUTION, 'delivery_experience', 'driver'), true);
  assert.equal(attributesTo(FAN_OUT_ATTRIBUTION, 'food_quality', 'driver'), true);
});

test('degrading only the kitchen moves no driver score', () => {
  const r = runAttributionScenario(ATTRIB);
  assert.equal(r.maxDriverShiftPp, 0, 'drivers did not change, so their scores must not');
  assert.equal(r.driversWronglyDowngraded, 0);
  assert.ok(r.passed);
});

test('control: fan-out attribution downgrades drivers for the kitchen', () => {
  const r = runAttributionScenario({ ...ATTRIB, fanOut: true });
  assert.ok(r.driversWronglyDowngraded > 0, 'a control that passes proves nothing');
  assert.ok(r.maxDriverShiftPp > 5);
  assert.equal(r.passed, false);
});

test('the correct method rarely names someone who is above the median', () => {
  const r = runSampleSizeScenario(SAMPLE);
  assert.equal(r.scoresShownBelowThreshold, 0);
  assert.equal(r.rankedBelowThreshold, 0);
  assert.ok(r.namedWorstAboveMedianRate <= 0.05);
  assert.ok(r.passed);
});

test('control: a raw-mean league table names above-median people, on a handful of ratings', () => {
  const r = runSampleSizeScenario({ ...SAMPLE, leagueTable: true });
  assert.ok(r.namedWorstAboveMedian > 0);
  assert.ok(r.rankedBelowThreshold > 0);
  assert.ok(r.medianRatingsOfNamedWorst < SAMPLE.minSample);
  assert.equal(r.passed, false);
});
