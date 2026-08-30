/**
 * The one class prefix every rule and every element in this widget carries.
 *
 * Its own module because both `index.ts` and `styles.ts` need it and neither
 * should import the other: the stylesheet must not pull in the 5800-line
 * widget closure just to know what to call a class (#320).
 */
export const PREFIX = "sgiant-aiw";
