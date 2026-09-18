/**
 * The mechanisms RTG-P03, RTG-P04 and RTG-P05 claim, implemented exactly as the
 * design states them — and, beside each, the natural-looking implementation that
 * the design rejects.
 *
 * The two live side by side deliberately: a control case is only evidence if it
 * REPLACES the mechanism under test rather than running alongside it.
 */

export type Role = 'cashier' | 'driver' | 'kitchen' | 'branch';

export interface RatedPerson {
  readonly id: string;
  readonly role: Role;
  /**
   * Probability this person's work satisfies a customer. The simulator knows it;
   * nothing that ranks or scores is ever allowed to see it. That gap is what
   * makes misidentification measurable.
   */
  readonly trueQuality: number;
  /** Orders served in the period. Deliberately very unequal. */
  readonly exposure: number;
}

export interface Tally {
  readonly id: string;
  readonly satisfied: number;
  readonly n: number;
}

export interface DisplayedScore {
  readonly id: string;
  readonly n: number;
  /** null means "insufficient data" — RTG-P04 forbids a number here, provisional or otherwise. */
  readonly score: number | null;
  readonly lowerBound: number | null;
}

/** Deterministic LCG, so a failing run is reproducible from its seed alone. */
export function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

/**
 * Wilson score interval, lower bound. Chosen because it needs no dependency, is
 * defined at 0 and 1 successes, and shrinks a sparse sample toward the middle
 * rather than trusting it — which is precisely what RTG-P05 asks for.
 */
export function wilsonLowerBound(satisfied: number, n: number, z = 1.96): number {
  if (n <= 0) return 0;
  const p = satisfied / n;
  const z2 = z * z;
  const denominator = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return (centre - margin) / denominator;
}

// ---------------------------------------------------------------------------
// The mechanism the design requires
// ---------------------------------------------------------------------------

/** RTG-P04: below the minimum sample there is no score, only "insufficient data". */
export function present(tallies: readonly Tally[], minSample: number): DisplayedScore[] {
  return tallies.map((t) =>
    t.n < minSample
      ? { id: t.id, n: t.n, score: null, lowerBound: null }
      : { id: t.id, n: t.n, score: t.satisfied / t.n, lowerBound: wilsonLowerBound(t.satisfied, t.n) },
  );
}

/**
 * RTG-P05: ranking uses the lower confidence bound, never the raw mean, and only
 * over people who have a score at all.
 */
export function rankWorst(displayed: readonly DisplayedScore[], take: number): string[] {
  return displayed
    .filter((d): d is DisplayedScore & { lowerBound: number } => d.lowerBound !== null)
    .slice()
    .sort((a, b) => a.lowerBound - b.lowerBound || a.id.localeCompare(b.id))
    .slice(0, take)
    .map((d) => d.id);
}

// ---------------------------------------------------------------------------
// The control: a league table. No threshold, raw means, nothing else changed.
// ---------------------------------------------------------------------------

export function presentRawMeans(tallies: readonly Tally[]): DisplayedScore[] {
  return tallies.map((t) => ({
    id: t.id,
    n: t.n,
    score: t.n > 0 ? t.satisfied / t.n : 0,
    lowerBound: t.n > 0 ? t.satisfied / t.n : 0,
  }));
}

export function rankWorstByRawMean(displayed: readonly DisplayedScore[], take: number): string[] {
  return displayed
    .filter((d): d is DisplayedScore & { score: number } => d.score !== null)
    .slice()
    .sort((a, b) => a.score - b.score || a.id.localeCompare(b.id))
    .slice(0, take)
    .map((d) => d.id);
}

// ---------------------------------------------------------------------------
// Attribution — RTG-P03
// ---------------------------------------------------------------------------

export type Dimension = 'delivery_experience' | 'food_quality' | 'overall';

/**
 * The recorded mapping from ADR-0017 §3, as configuration rather than logic.
 * A driver is answerable for the delivery leg and for nothing else.
 */
export const ATTRIBUTION: Readonly<Record<Dimension, readonly Role[]>> = {
  delivery_experience: ['driver'],
  food_quality: ['kitchen', 'branch'],
  overall: ['branch'],
};

/** The control: whoever touched the order wears every dimension of it. */
export const FAN_OUT_ATTRIBUTION: Readonly<Record<Dimension, readonly Role[]>> = {
  delivery_experience: ['driver', 'kitchen', 'branch'],
  food_quality: ['driver', 'kitchen', 'branch'],
  overall: ['driver', 'kitchen', 'branch'],
};

export function attributesTo(
  mapping: Readonly<Record<Dimension, readonly Role[]>>,
  dimension: Dimension,
  role: Role,
): boolean {
  return mapping[dimension].includes(role);
}
