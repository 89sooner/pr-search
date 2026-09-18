/** FR-REG-001: explicit build-time UI opt-in, never inferred from adapter absence. */
export const regressionEnabled = process.env['NEXT_PUBLIC_REGRESSION_ENABLED'] === '1';
