/*
 * Platform Breakpoint Tokens
 *
 * Full Tailwind v4 breakpoint range from xxs to 7xl.
 *
 * WHEN TO USE WHAT:
 * - clamp()     → Display type, page/section spacing (smooth fluid scaling)
 * - Breakpoints → Layout structure changes (sidebar collapse, grid columns, row→column)
 * - Fixed       → Component internal sizing (button height, input padding — never scales)
 */

export const breakpoints = {
  xxs: 320,
  xs: 475,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  "2xl": 1536,
  "3xl": 1792,
  "4xl": 2048,
  "5xl": 2304,
  "6xl": 2560,
  "7xl": 2816,
} as const;
