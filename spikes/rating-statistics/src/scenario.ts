/**
 * Two scenarios, each with its own control.
 *
 * Gate A — sample size and ranking (RTG-P04, RTG-P05):
 *   no score below the minimum sample, nobody ranked without one, and the person
 *   identified as worst is not in fact better than half their colleagues.
 *
 * Gate B — attribution (RTG-P03):
 *   degrade the kitchen and nothing else; every driver's score must be unmoved.
 *
 * The unit of measurement in Gate A is the RANKING DECISION, not the rating. A
 * manager coaches a person once a period; that is the event that can be wrong,
 * and counting ratings instead would report the wrong quantity.
 */
import {
  makeRandom, present, presentRawMeans, rankWorst, rankWorstByRawMean,
  ATTRIBUTION, FAN_OUT_ATTRIBUTION, attributesTo,
  type Tally, type RatedPerson, type Dimension,
} from './model.ts';

// ---------------------------------------------------------------------------
// Gate A
// ---------------------------------------------------------------------------

export interface SampleSizeConfig {
  readonly people: number;
  /** Independent periods. Each is one ranking decision. */
  readonly periods: number;
  readonly minSample: number;
  readonly responseRate: number;
  readonly bottomSetSize: number;
  readonly seed: number;
  /** Control: rank by raw mean with no threshold. */
  readonly leagueTable?: boolean;
}

export interface SampleSizeResult {
  readonly periods: number;
  readonly people: number;
  readonly minSample: number;
  /** RTG-P04 violations: a number shown for someone below the threshold. */
  readonly scoresShownBelowThreshold: number;
  /** RTG-P05 violations: someone ranked without a defensible sample. */
  readonly rankedBelowThreshold: number;
  /** Ranking decisions made: one per draw, two per period. */
  readonly decisions: number;
  /** Decisions where the person named worst is above the population median. */
  readonly namedWorstAboveMedian: number;
  readonly namedWorstAboveMedianRate: number;
  /** Decisions where the person named worst really is in the bottom decile. */
  readonly namedWorstInBottomDecile: number;
  /**
   * Agreement between two independent draws from the SAME population, 0..bottomSetSize.
   * The population did not change, so whatever the two draws disagree about is noise.
   */
  readonly bottomSetOverlapMean: number;
  /** Periods where the two draws named entirely different people. */
  readonly bottomSetDisjoint: number;
  readonly bottomSetDisjointRate: number;
  readonly medianRatingsOfNamedWorst: number;
  readonly passed: boolean;
  readonly failures: string[];
}

function population(config: SampleSizeConfig): RatedPerson[] {
  const rng = makeRandom(config.seed);
  const people: RatedPerson[] = [];
  for (let i = 0; i < config.people; i++) {
    const qu = rng();
    const eu = rng();
    people.push({
      id: `C${String(i).padStart(3, '0')}`,
      role: 'cashier',
      trueQuality: 0.72 + 0.24 * qu,
      // 8 to 800 orders in a period: a weekend-only starter and a full-time
      // supervisor are both in this list, which is the whole difficulty.
      exposure: Math.max(4, Math.round(8 * Math.pow(100, eu))),
    });
  }
  return people;
}

function drawTallies(people: readonly RatedPerson[], responseRate: number, rng: () => number): Tally[] {
  return people.map((p) => {
    let n = 0;
    let satisfied = 0;
    for (let o = 0; o < p.exposure; o++) {
      if (rng() >= responseRate) continue;
      n++;
      if (rng() < p.trueQuality) satisfied++;
    }
    return { id: p.id, satisfied, n };
  });
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(q * (sorted.length - 1))));
  return sorted[idx]!;
}

export function runSampleSizeScenario(config: SampleSizeConfig): SampleSizeResult {
  const people = population(config);
  const quality = new Map(people.map((p) => [p.id, p.trueQuality]));
  const sortedQuality = people.map((p) => p.trueQuality).sort((a, b) => a - b);
  const median = quantile(sortedQuality, 0.5);
  const bottomDecile = quantile(sortedQuality, 0.1);

  const rng = makeRandom(config.seed ^ 0x5eed);
  let scoresShownBelowThreshold = 0;
  let rankedBelowThreshold = 0;
  let namedWorstAboveMedian = 0;
  let namedWorstInBottomDecile = 0;
  let decisions = 0;
  let bottomSetOverlapTotal = 0;
  let bottomSetDisjoint = 0;
  const namedWorstSampleSizes: number[] = [];

  for (let period = 0; period < config.periods; period++) {
    const first = drawTallies(people, config.responseRate, rng);
    const second = drawTallies(people, config.responseRate, rng);
    const sizes = new Map(first.map((t) => [t.id, t.n]));

    // The two paths are mutually exclusive. The control does not get to run the
    // correct check as well — that is what made the callback spike's first
    // control a no-op.
    const bottomA = config.leagueTable
      ? rankWorstByRawMean(presentRawMeans(first), config.bottomSetSize)
      : rankWorst(present(first, config.minSample), config.bottomSetSize);
    const bottomB = config.leagueTable
      ? rankWorstByRawMean(presentRawMeans(second), config.bottomSetSize)
      : rankWorst(present(second, config.minSample), config.bottomSetSize);

    const displayed = config.leagueTable ? presentRawMeans(first) : present(first, config.minSample);
    for (const d of displayed) {
      if (d.score !== null && d.n < config.minSample) scoresShownBelowThreshold++;
    }

    // Each draw is a ranking decision a manager could act on, so both are judged.
    const sizesB = new Map(second.map((t) => [t.id, t.n]));
    for (const [worst, n] of [[bottomA[0], sizes], [bottomB[0], sizesB]] as const) {
      if (worst === undefined) continue;
      decisions++;
      const count = n.get(worst) ?? 0;
      namedWorstSampleSizes.push(count);
      if (count < config.minSample) rankedBelowThreshold++;
      const q = quality.get(worst) ?? 0;
      if (q > median) namedWorstAboveMedian++;
      if (q <= bottomDecile) namedWorstInBottomDecile++;
    }

    // The population did not change between the two draws. Whatever the two
    // disagree about is noise being reported as fact. Exact agreement is not the
    // right bar — several people are genuinely close together at the bottom, so
    // which of them is named will vary honestly. Naming a wholly different set
    // is not honest variation.
    const setB = new Set(bottomB);
    const overlap = bottomA.filter((id) => setB.has(id)).length;
    bottomSetOverlapTotal += overlap;
    if (overlap === 0) bottomSetDisjoint++;
  }

  const rate = (x: number) => (config.periods === 0 ? 0 : x / config.periods);
  const perDecision = (x: number) => (decisions === 0 ? 0 : x / decisions);
  const sortedSizes = namedWorstSampleSizes.slice().sort((a, b) => a - b);

  const failures: string[] = [];
  if (scoresShownBelowThreshold > 0) {
    failures.push(`RTG-P04: ${scoresShownBelowThreshold} score(s) shown below the minimum sample of ${config.minSample}`);
  }
  if (rankedBelowThreshold > 0) {
    failures.push(`RTG-P05: ${rankedBelowThreshold} ranking(s) named someone with fewer than ${config.minSample} ratings`);
  }
  if (perDecision(namedWorstAboveMedian) > 0.05) {
    failures.push(`RTG-P05: the person named worst was above the population median in ${(perDecision(namedWorstAboveMedian) * 100).toFixed(1)}% of decisions (bound 5%)`);
  }
  // Bottom-set disjointness is REPORTED, not gated. See this spike's README: the
  // correct method keeps the naming honest, but does not make a bottom-three
  // list meaningful, and a gate would have hidden that behind a pass.

  return {
    periods: config.periods,
    people: config.people,
    minSample: config.minSample,
    scoresShownBelowThreshold,
    rankedBelowThreshold,
    decisions,
    namedWorstAboveMedian,
    namedWorstAboveMedianRate: perDecision(namedWorstAboveMedian),
    namedWorstInBottomDecile,
    bottomSetOverlapMean: config.periods === 0 ? 0 : bottomSetOverlapTotal / config.periods,
    bottomSetDisjoint,
    bottomSetDisjointRate: rate(bottomSetDisjoint),
    medianRatingsOfNamedWorst: quantile(sortedSizes, 0.5),
    passed: failures.length === 0,
    failures,
  };
}

// ---------------------------------------------------------------------------
// Gate B
// ---------------------------------------------------------------------------

export interface AttributionConfig {
  readonly orders: number;
  readonly drivers: number;
  readonly branches: number;
  readonly responseRate: number;
  readonly driverQualityBase: number;
  readonly kitchenQualityBaseline: number;
  readonly kitchenQualityDegraded: number;
  readonly seed: number;
  /** Control: attribute every dimension to everyone who touched the order. */
  readonly fanOut?: boolean;
}

export interface AttributionResult {
  readonly orders: number;
  readonly drivers: number;
  readonly kitchenDropPp: number;
  /** Largest movement in any driver's displayed score, in percentage points. */
  readonly maxDriverShiftPp: number;
  readonly meanDriverShiftPp: number;
  /** Drivers whose score fell by more than 5pp although no driver changed. */
  readonly driversWronglyDowngraded: number;
  readonly passed: boolean;
  readonly failures: string[];
}

interface SimOrder {
  readonly driver: number;
  readonly branch: number;
  readonly responded: boolean;
  readonly deliveryU: number;
  readonly foodU: number;
  readonly overallU: number;
}

/**
 * Orders and their random draws are generated ONCE and reused by both runs, and
 * each concern draws from its own stream. Degrading the kitchen therefore cannot
 * perturb a single driver outcome or change which customers responded — so under
 * the correct mapping the expected driver shift is not "small", it is zero, and
 * any movement at all is leakage.
 */
function buildOrders(config: AttributionConfig): SimOrder[] {
  const assign = makeRandom(config.seed);
  const response = makeRandom(config.seed + 101);
  const delivery = makeRandom(config.seed + 202);
  const food = makeRandom(config.seed + 303);
  const overall = makeRandom(config.seed + 404);
  const orders: SimOrder[] = [];
  for (let i = 0; i < config.orders; i++) {
    orders.push({
      driver: Math.floor(assign() * config.drivers) % config.drivers,
      branch: Math.floor(assign() * config.branches) % config.branches,
      responded: response() < config.responseRate,
      deliveryU: delivery(),
      foodU: food(),
      overallU: overall(),
    });
  }
  return orders;
}

function driverScores(
  config: AttributionConfig,
  orders: readonly SimOrder[],
  driverQuality: readonly number[],
  kitchenQuality: number,
): Map<number, number> {
  const mapping = config.fanOut ? FAN_OUT_ATTRIBUTION : ATTRIBUTION;
  const tally = new Map<number, { satisfied: number; n: number }>();
  const add = (driver: number, satisfied: boolean) => {
    const t = tally.get(driver) ?? { satisfied: 0, n: 0 };
    t.n++;
    if (satisfied) t.satisfied++;
    tally.set(driver, t);
  };

  for (const o of orders) {
    if (!o.responded) continue;
    const dq = driverQuality[o.driver]!;
    const outcomes: Record<Dimension, boolean> = {
      delivery_experience: o.deliveryU < dq,
      food_quality: o.foodU < kitchenQuality,
      // What customers answer most and reason about least. It moves with the food.
      overall: o.overallU < 0.4 * dq + 0.6 * kitchenQuality,
    };
    for (const dimension of Object.keys(outcomes) as Dimension[]) {
      if (attributesTo(mapping, dimension, 'driver')) add(o.driver, outcomes[dimension]);
    }
  }

  const scores = new Map<number, number>();
  for (const [driver, t] of tally) scores.set(driver, t.n === 0 ? 0 : t.satisfied / t.n);
  return scores;
}

export function runAttributionScenario(config: AttributionConfig): AttributionResult {
  const qualityRng = makeRandom(config.seed + 909);
  const driverQuality = Array.from({ length: config.drivers }, () =>
    config.driverQualityBase + 0.1 * qualityRng(),
  );

  const orders = buildOrders(config);
  const before = driverScores(config, orders, driverQuality, config.kitchenQualityBaseline);
  const after = driverScores(config, orders, driverQuality, config.kitchenQualityDegraded);

  let maxShift = 0;
  let totalShift = 0;
  let wronglyDowngraded = 0;
  for (const [driver, b] of before) {
    const a = after.get(driver) ?? 0;
    const shiftPp = (a - b) * 100;
    maxShift = Math.max(maxShift, Math.abs(shiftPp));
    totalShift += Math.abs(shiftPp);
    if (shiftPp < -5) wronglyDowngraded++;
  }

  const failures: string[] = [];
  if (maxShift > 0) {
    failures.push(`RTG-P03: a driver's score moved ${maxShift.toFixed(2)}pp when only the kitchen changed`);
  }
  if (wronglyDowngraded > 0) {
    failures.push(`RTG-P03: ${wronglyDowngraded} driver(s) lost more than 5pp without doing anything differently`);
  }

  return {
    orders: config.orders,
    drivers: config.drivers,
    kitchenDropPp: (config.kitchenQualityBaseline - config.kitchenQualityDegraded) * 100,
    maxDriverShiftPp: maxShift,
    meanDriverShiftPp: before.size === 0 ? 0 : totalShift / before.size,
    driversWronglyDowngraded: wronglyDowngraded,
    passed: failures.length === 0,
    failures,
  };
}
