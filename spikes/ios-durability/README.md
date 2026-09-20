# Spike: iOS background durability

**Decides ADR-0004. Blocked on B-03 (real devices, lab hardware).**
**Schedule in week 1–2.**

---

## Why this is not a simulation

Whether iOS keeps an application alive, scheduled and able to drive printers for a
full trading day is a property of the operating system and the device
configuration. No model of it is evidence.

> Will a backgrounded, locked or memory-pressured iPad still serve peer sync and
> drive the print queue?

If it will not, **a controller becomes mandatory for printing and unattended
operation** — independently of whether peer sync works.

## Setup

- iPad under **Guided Access / MDM kiosk mode**, as production would run
- Network thermal printer (Q-04 — not Bluetooth)
- Peer devices generating sync traffic
- Battery and thermal monitoring

## Procedure

1. Run continuously for **12 hours** under realistic order load.
2. Serve peer sync and drive the print queue throughout.
3. Induce memory pressure until the app is jetsam-relaunched.
4. Lock the screen for a sustained period during trading hours.
5. Verify the SQLite WAL is intact and no committed event was lost after relaunch.
6. Measure local database growth and full resync time after a simulated 48-hour
   offline period.

## Pass criteria

| # | Criterion | Threshold |
|---|---|---|
| 1 | Continuous operation | 12h with no intervention |
| 2 | Peer sync during background | maintained |
| 3 | Print queue during screen lock | maintained through the operating window |
| 4 | Jetsam relaunch | zero committed events lost; WAL intact |
| 5 | Catch-up after 48h offline | under 10 minutes |
| 6 | Local storage growth | within device capacity across the retention window |

## Fail consequences

Failure on 1, 3 or 4 makes a controller mandatory for printing and unattended
operation. Record in ADR-0004.

Criterion 5 or 6 failing changes the retention design rather than the hardware
decision — but it changes it before the design is committed, which is the point.

## Output

Record in `docs/lab/hardware-decision-matrix.md` (criterion 3) and attach device
logs to the evidence package.
