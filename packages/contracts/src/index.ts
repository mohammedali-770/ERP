/**
 * @firsttaste/contracts — shared domain primitives.
 *
 * Depends on nothing, so it can be shared verbatim by device, controller and
 * central. See docs/domain/bounded-contexts.md for the dependency rule.
 */
export * from './ids/uuidv7.ts';
export * from './ids/hlc.ts';
export * from './events/envelope.ts';
export * from './events/payment-state.ts';
export * from './sync/protocol.ts';
