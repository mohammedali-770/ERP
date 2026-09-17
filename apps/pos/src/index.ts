/**
 * Application boundary: pos
 *
 * Cashier point of sale. Expo / React Native, iPad (ADR-0004 keeps the hardware standard open; the sync protocol is identical in every option).
 *
 * Requirements: POS-001..030
 *
 * F0 STATUS — reserved boundary, no implementation. See any service boundary
 * for the same note and the reasoning behind it.
 */
export const APP_NAME = 'pos' as const;
