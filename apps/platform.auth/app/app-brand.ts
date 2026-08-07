/**
 * Per-app brand constants for the identity app. Platform-wide brand (the
 * wordmark name) lives in `app/app.config.ts`. Anything app-specific — like
 * the product name shown after the wordmark in this app — lives here.
 */
export const APP_PRODUCT_NAME = "somewhatintelligent account";

/**
 * The same product, named for a place that has ALREADY SAID THE WORDMARK.
 *
 * The social card sets this directly under the lockup, so `APP_PRODUCT_NAME`
 * there would print the studio's name twice in two typefaces. Two constants
 * rather than one derived by trimming a prefix off the other: a rebrand where
 * the product name stops starting with the wordmark would silently keep
 * working and silently be wrong.
 */
export const APP_PRODUCT_EYEBROW = "account";
