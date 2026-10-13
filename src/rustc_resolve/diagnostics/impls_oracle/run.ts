// Test driver for lane res-diag-a's diagnostics tests (not a port).
//
//   bun src/rustc_resolve/diagnostics/impls_oracle/run.ts <case>.rs      (run in `cases/`)
//
// Runs the resolver part of `configure_and_expand` / `resolve_crate` that is ported, in process, on the crate
// built by macros_oracle/with_resolver.ts (`Resolver::new` for the nocore arguments):
//   1. expansion (`MacroExpander::expand_crate`: `build_reduced_graph`, `resolve_imports`), as
//      build_reduced_graph.test.ts's `run_case` runs it;
//   2. `finalize_imports` (resolve_crate, lib.rs:2084);
//   3. `report_errors` with no use injections (lib.rs:2098; `late_resolve_crate` is lane res-late's);
//   4. `FatalError.raise()` if `raise_fatal_after_resolve` (lib.rs:2106).
// Diagnostics go to stderr like the driver's. Test-only stand-ins (installed here, not ports):
//   - `CStore::from_tcx` is an empty crate store (no extern crates: `had_extern_crate_load_failure` is false;
//     anything else is `unported`), until rustc_metadata (wave 11);
//   - the visibility re-feed of structs/unions is checked by value (rustc_middle `query_feed` leaves the stable
//     hashing check `unported`), as build_reduced_graph.test.ts does;
//   - while late.rs is still the stub (lane res-late), `PathSource::is_expected` for `PathSource::Type` only (the
//     one `resolve_path` asks, ident.rs), the upstream arm (late.rs:586); any other source is `unported`.
import { basename } from "node:path";
import "../../lib.ts";
import type { Attribute } from "../../../rustc_ast/lib.ts";
import { AttributeParser } from "../../../rustc_attr_parsing/lib.ts";
import { FatalError, FatalErrorMarker } from "../../../rustc_errors/lib.ts";
import { ExtCtxt } from "../../../rustc_expand/base.ts";
import { ExpansionConfig } from "../../../rustc_expand/expand.ts";
import * as limits from "../../../rustc_interface/limits.ts";
import { TyCtxtFeed } from "../../../rustc_middle/ty/context.ts";
import type { Visibility } from "../../../rustc_middle/ty/mod.ts";
import type { Session } from "../../../rustc_session/session.ts";
import { LOCAL_CRATE, type LocalDefId, type ModId, ModId_eq } from "../../../rustc_span/def_id.ts";
import { DUMMY_SP } from "../../../rustc_span/lib.ts";
import { sym } from "../../../rustc_span/symbol.ts";
import type { Limit } from "../../../rustc_structures/limit.ts";
import { Unported, unported } from "../../../std/panic.ts";
import { PathSource } from "../../late.ts";
import { CStore, type Res } from "../../lib.ts";
import { with_resolver } from "../../macros_oracle/with_resolver.ts";

/** An empty `CStore` (test stand-in). */
const EMPTY_CSTORE = new Proxy(
  {
    had_extern_crate_load_failure: () => false,
  },
  {
    get: (t, p) => (p in t ? t[p as keyof typeof t] : () => unported(`test stand-in: empty CStore::${String(p)}`)),
  },
) as unknown as CStore;

function install_stand_ins(): void {
  if (String(PathSource.is_expected).includes("unported(")) {
    PathSource.is_expected = (self: PathSource, res: Res): boolean => {
      if (self.$ !== "Type") return unported(`test stand-in: PathSource::is_expected(${self.$})`);
      return (
        (res.$ === "Def" &&
          (res._0.$ === "Struct" ||
            res._0.$ === "Union" ||
            res._0.$ === "Enum" ||
            res._0.$ === "Trait" ||
            res._0.$ === "TraitAlias" ||
            res._0.$ === "TyAlias" ||
            res._0.$ === "AssocTy" ||
            res._0.$ === "TyParam" ||
            res._0.$ === "OpaqueTy" ||
            res._0.$ === "ForeignTy")) ||
        res.$ === "PrimTy" ||
        res.$ === "SelfTyParam" ||
        res.$ === "SelfTyAlias"
      );
    };
  }
  CStore.from_tcx = () => EMPTY_CSTORE;
  CStore.from_tcx_mut = () => EMPTY_CSTORE;
  const proto = TyCtxtFeed.prototype as unknown as Record<string, (this: TyCtxtFeed<LocalDefId>, v: Visibility<ModId>) => void>;
  const orig = proto.visibility!;
  const fed = new Map<LocalDefId, Visibility<ModId>>();
  proto.visibility = function (this: TyCtxtFeed<LocalDefId>, v: Visibility<ModId>): void {
    const key = this.key();
    const old = fed.get(key);
    if (old !== undefined) {
      const same = old.$ === v.$ && (old.$ === "Public" || ModId_eq(old._0, (v as { _0: ModId })._0));
      if (!same) unported("test stand-in: re-feeding a different visibility (query_feed stable hashing)");
      return;
    }
    fed.set(key, v);
    orig.call(this, v);
  };
}

/** passes.rs:1523 `get_recursion_limit` (as build_reduced_graph.test.ts). */
function get_recursion_limit(krate_attrs: readonly Attribute[], sess: Session): Limit {
  const attr = AttributeParser.parse_limited_sym_should_emit(sess, krate_attrs, [sym.recursion_limit], DUMMY_SP, undefined, {
    $: "EarlyFatal",
    also_emit_lints: false,
  });
  return limits.get_recursion_limit(attr === undefined ? [] : [attr], sess);
}

export function run(file: string): void {
  install_stand_ins();
  with_resolver(file, (resolver, krate, tcx) => {
    const sess = tcx.sess;
    const cfg = new ExpansionConfig(
      tcx.crate_name(LOCAL_CRATE),
      tcx.features(),
      get_recursion_limit(krate.attrs, sess),
      sess.opts.unstable_opts.trace_macros,
      sess.is_test_crate(),
      sess.opts.unstable_opts.span_debug,
      sess.opts.unstable_opts.proc_macro_backtrace,
    );
    const ecx = ExtCtxt.new(sess, cfg, resolver, undefined);
    const krate_ = ecx.monotonic_expander().expand_crate(krate);
    resolver.finalize_imports();
    resolver.report_errors(krate_, []);
    if (resolver.raise_fatal_after_resolve) {
      new FatalError().raise();
    }
  });
}

if (import.meta.main) {
  const file = process.argv[2];
  if (file === undefined) throw new Error(`usage: bun ${basename(import.meta.path)} <case>.rs`);
  // The driver's exit codes: 1 after a fatal error (the compiler aborts when errors were emitted); unported
  // code exits 70 (the harness's UNPORTED) after one `UNPORTED: <what>` line.
  try {
    run(file);
  } catch (e) {
    if (e instanceof FatalErrorMarker) process.exit(1);
    if (e instanceof Unported) {
      process.stderr.write(`UNPORTED: ${e.what}\n`);
      process.exit(70);
    }
    throw e;
  }
}
