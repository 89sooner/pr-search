/**
 * FR-REG-001: Regression is an analysis surface, not an opt-in compiled-out route.
 *
 * An unconfigured provider renders its explicit empty state. Hiding the page behind a
 * NEXT_PUBLIC build flag made an imported image unable to expose the configured route
 * through runtime configuration, because Next inlines that variable during its build.
 * Fixture data remains a separate server-side opt-in in the route.
 */
export const regressionEnabled = true;
