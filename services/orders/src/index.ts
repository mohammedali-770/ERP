/**
 * Service boundary: orders
 *
 * Order lifecycle across every channel, external references, exception queue, order-time snapshots.
 *
 * Requirements: OMS-001..018, POS-001..030
 * Context: docs/domain/bounded-contexts.md
 *
 * F0 STATUS — this is a reserved boundary, not an implementation. The PRD's
 * architecture gate (PRG-010, PRG-011) has not been passed, so no F1 feature code
 * belongs here yet. The boundary exists now so that when it is, the code lands
 * inside a shape the gate approved, and so nothing else grows into this space.
 *
 * This module may import only from @firsttaste/contracts. That rule is enforced
 * by `npm run boundary:check`.
 */
export const SERVICE_NAME = 'orders' as const;
