// What the ratchet may protect (plan-m8 D19, lane harness-m8a-gate): "never protected" made mechanical. Two mechanisms:
// - ENV (scripts/difftest.ts) is a status of its own, decided from oracle runs only; the protected set grows only from MATCH
//   (`matchIdsOfJsonl`, which `scripts/gate.ts` `matchesOfRun` reads), so an ENV case is never protected;
// - `Suite.neverProtect`: `gate accept` skips such a suite's matches with a note, whatever the run's suites were (`planAccept`), and
//   `gate run` and `accept` refuse while such a suite has a baseline file (`neverProtectBaselineErrors`), so skipping a suite can
//   never also skip a loss check against an existing baseline.
// No imports, so unit tests can load it without scripts/lib/common.ts (see scripts/lib/deps.test.ts).

/** The part of a `Suite` this file reads. */
export interface ProtectSuite {
  name: string;
  neverProtect?: string;
}

/** One line (no `ERROR:` prefix) per `neverProtect` suite that has a baseline file, in the order given. */
export function neverProtectBaselineErrors(suites: readonly ProtectSuite[], hasBaseline: (suite: string) => boolean): string[] {
  return suites
    .filter((s) => s.neverProtect !== undefined && hasBaseline(s.name))
    .map((s) => `suite ${s.name} is never protected (neverProtect: ${s.neverProtect}) but has a baseline file, harness/baseline/${s.name}.txt; a skipped suite must not skip a loss check against an existing baseline: clear neverProtect in a reviewed harness batch (a baseline is never removed to make a run pass)`);
}

/** The MATCH ids of a run's `<suite>.jsonl` (one `{ id, status }` per line): the only ids `accept` may protect. ENV never is. */
export function matchIdsOfJsonl(text: string): Set<string> {
  const ids = new Set<string>();
  for (const line of text.split("\n")) {
    if (!line) continue;
    const r = JSON.parse(line) as { id: string; status: string };
    if (r.status === "MATCH") ids.add(r.id);
  }
  return ids;
}

export interface AcceptInputs {
  /** The registered suite (throws on an unknown name). */
  suite(name: string): ProtectSuite;
  /** Its protected set now. */
  baseline(name: string): Set<string>;
  /** Whether it has a baseline file (a `neverProtect` suite that has one is refused, as `neverProtectBaselineErrors` says). */
  hasBaseline(name: string): boolean;
  /** Its MATCH ids in the run (`matchIdsOfJsonl` of the run's own results). */
  matches(name: string): Set<string>;
  /** Ids of `base` the suite lists as unstable (gate.ts `protectedUnstable`). */
  unstable(name: string, base: Set<string>): string[];
}

export type AcceptPlan =
  | {
      /** The suites whose protected set is written, grown by the run's MATCHes. */
      grown: { suite: string; base: Set<string>; before: number }[];
      /** `neverProtect` suites the run ran: their matches are not read, nothing is written for them. */
      skipped: { suite: string; why: string }[];
    }
  | { refusal: string };

/**
 * What `gate accept` does with a run's suites (`runSuites`, as gate.json lists them), or why it accepts nothing. Every suite is checked
 * before any baseline is written, so a refusal leaves every baseline as it was. A `neverProtect` suite is skipped whatever the run's
 * suites named: its matches are not read and its baseline is not written. A `neverProtect` suite that has a baseline file refuses the
 * whole run (review harness-m8a-gate N1): the refusal lives in the same code as the skip, so a skip can never pass over a loss check
 * against an existing baseline, whatever the caller checked before.
 */
export function planAccept(runId: string, runSuites: readonly string[], inp: AcceptInputs): AcceptPlan {
  const grown: { suite: string; base: Set<string>; before: number }[] = [];
  const skipped: { suite: string; why: string }[] = [];
  for (const name of runSuites) {
    const s = inp.suite(name); // registered suite names only (also keeps the baseline path inside harness/baseline)
    if (s.neverProtect !== undefined) {
      if (inp.hasBaseline(name)) return { refusal: `gate run ${runId}: ${neverProtectBaselineErrors([s], () => true)[0]!}; nothing accepted` };
      skipped.push({ suite: name, why: s.neverProtect });
      continue;
    }
    const base = inp.baseline(name);
    const before = base.size;
    const match = inp.matches(name);
    const lost = [...base].filter((id) => !match.has(id));
    if (lost.length) return { refusal: `gate run ${runId}: ${name} results lose ${lost.length} protected case(s) (e.g. ${lost[0]})` };
    for (const id of match) base.add(id);
    const unstable = inp.unstable(name, base);
    if (unstable.length) return { refusal: `gate run ${runId}: ${name} would protect ${unstable.length} case(s) the suite lists as unstable (e.g. ${unstable[0]}); nothing accepted` };
    grown.push({ suite: name, base, before });
  }
  return { grown, skipped };
}
