/**
 * T-09's setup, minus the half that needs ZATCA: three devices as three EGS
 * units, central unreachable, invoices issued offline across all three, a device
 * restarted mid-sequence, and one device restored from an earlier backup.
 *
 * Each fault flag is a control. Turning one on must make the run FAIL — a run
 * whose control also passes has proved nothing.
 */
import { EgsUnit, IssuanceLog, verifyChain, CounterReuseError, type Invoice } from './egs.ts';

export interface ZatcaConfig {
  readonly units: number;
  readonly invoicesPerUnit: number;
  /** Control: one counter shared across devices, the design ADR-0006 rejected. */
  readonly sharedCounter?: boolean;
  /** Control: a restored device issues without reconciling against the log. */
  readonly skipRestoreReconciliation?: boolean;
  /** Control: an invoice is linked to the wrong predecessor. */
  readonly breakChain?: boolean;
}

export interface ZatcaResult {
  readonly passed: boolean;
  readonly issued: number;
  readonly counterReuses: number;
  readonly brokenChains: number;
  readonly refusedIssuances: number;
  readonly problems: string[];
}

export function runZatcaScenario(config: ZatcaConfig): ZatcaResult {
  const log = new IssuanceLog();
  const unitIds = Array.from({ length: config.units }, (_, i) => `egs-pos-${i + 1}`);
  // The shared-counter control gives every device the same unit identity, which is
  // exactly what "one counter for the branch" means in practice.
  const units = unitIds.map((id) => new EgsUnit(config.sharedCounter ? 'egs-branch' : id));
  const problems: string[] = [];
  let refusedIssuances = 0;
  let clock = 1000;

  // Interleaved offline issuance across all units.
  for (let n = 0; n < config.invoicesPerUnit; n += 1) {
    for (const unit of units) {
      try {
        unit.issue(1000 + n, (clock += 1), log);
      } catch (e) {
        if (e instanceof CounterReuseError) refusedIssuances += 1;
        else throw e;
      }
    }
    // Restart one device mid-sequence. A restart is not a restore: nothing rewinds.
    if (n === 1) units[0]!.restart();
  }

  // Restore the second device from a backup taken before it had issued everything.
  if (units.length > 1) {
    const victim = units[1]!;
    const stale = log.issued.filter((i) => i.unit_id === victim.unitId)[0];
    if (stale) {
      victim.restoreFrom(
        { unit_id: victim.unitId, icv: stale.icv, last_hash: stale.hash, taken_at: clock },
        !config.skipRestoreReconciliation,
      );
      if (!config.skipRestoreReconciliation) victim.reconcile(log);
      try {
        victim.issue(9999, (clock += 1), log);
      } catch (e) {
        if (e instanceof CounterReuseError) refusedIssuances += 1;
        else throw e;
      }
    }
  }

  if (config.breakChain) {
    // Relink one invoice to the genesis PIH, as a naive "repair" would.
    const target = log.issued.findIndex((i) => i.icv === 2);
    if (target >= 0) {
      const original = log.issued[target]!;
      (log.issued as Invoice[])[target] = { ...original, pih: 'not-the-previous-hash' };
    }
  }

  const chainUnits = [...new Set(log.issued.map((i) => i.unit_id))];
  let brokenChains = 0;
  let counterReuses = 0;
  for (const id of chainUnits) {
    const verdict = verifyChain(id, log.issued);
    if (!verdict.ok) {
      brokenChains += 1;
      problems.push(`${id}: ${verdict.problem}`);
    }
    const reused = log.reusedCounters(id);
    if (reused.length > 0) {
      counterReuses += reused.length;
      problems.push(`${id}: counter values reused — ${reused.join(', ')}`);
    }
  }

  return {
    passed: brokenChains === 0 && counterReuses === 0,
    issued: log.issued.length,
    counterReuses,
    brokenChains,
    refusedIssuances,
    problems,
  };
}
