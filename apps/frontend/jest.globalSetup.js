/**
 * Pins the timezone for the whole frontend suite.
 *
 * This has to happen in `globalSetup`, not `setupFilesAfterEnv` and not at
 * the top of a test file: Node resolves the zone once, before user code
 * runs, so `process.env.TZ = …` inside a module is too late to affect
 * `toLocaleDateString`. Workers inherit this process's environment, so
 * setting it here is what actually takes effect.
 *
 * ── Why it matters (#1167) ───────────────────────────────────────────────
 *
 * `formatDate` rendered date-only values one day early anywhere WEST of
 * UTC — the entire California audience. CI runs in UTC, where that bug is
 * invisible: the regression tests written for it passed against the broken
 * implementation, so they guarded nothing on the machine that matters.
 *
 * Pacific is the right choice rather than an arbitrary offset: it is where
 * the audience is, so a date bug that would reach users fails here first.
 *
 * Any test asserting on a formatted date now behaves identically on a
 * laptop and in CI, which was not previously true.
 */
module.exports = async () => {
  process.env.TZ = "America/Los_Angeles";
};
