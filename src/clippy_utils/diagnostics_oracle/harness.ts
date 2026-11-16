// Test glue for src/clippy_utils/{diagnostics,msrvs}.test.ts (not ported code): compiles a fixture of this directory with
// the ported front end, as `clippy-driver <file> --edition=2024 --emit=metadata` run from here (capture.ts runs the
// oracle the same way), with the session's human emitter writing into a buffer, and returns what it rendered.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Crate } from "../../rustc_ast/lib.ts";
import { compiler_entrypoint } from "../../rustc_driver_impl/lib.ts";
import { AnnotateSnippetEmitter } from "../../rustc_errors/annotate_snippet_emitter_writer.ts";
import { FatalErrorMarker } from "../../rustc_errors/lib.ts";
import { type Config, run_compiler } from "../../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../../rustc_interface/passes.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Session } from "../../rustc_session/session.ts";
import { type BytePos, Span } from "../../rustc_span/lib.ts";
import { AutoStream, ColorChoice } from "../../vendor/anstream/lib.ts";
import { dyn_write, VecU8 } from "../../vendor/anstream/stream.ts";
import { EXTRA_SYMBOLS } from "../sym.ts";

export const DIR = import.meta.dir;

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["clippy-driver", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

/** A span of the fixture from 1-based line and column numbers (ASCII), end exclusive. */
export type SpanAt = (line: number, col: number, end_line: number, end_col: number) => Span;

export interface Hooks {
  /** Right after parsing, before expansion (where clippy's pre-expansion passes run). */
  pre?(sess: Session, krate: Crate): void;
  /** Once the crate is lowered to HIR. */
  post?(tcx: TyCtxt, sp: SpanAt): void;
}

/** Compiles `file` (in DIR, named as the oracle was given it), runs the hooks, and returns the rendered stderr, including
 *  `finish_diagnostics`' error count. */
export function render_with(file: string, hooks: Hooks): string {
  const buf = new VecU8();
  const cwd = process.cwd();
  process.chdir(DIR);
  try {
    const config = config_from_args([file, "--edition=2024", "--emit=metadata"]);
    // as clippy's driver.rs `ClippyCallbacks::config` does: clippy's `sym` constants index these
    config.extra_symbols = [...EXTRA_SYMBOLS];
    const text = readFileSync(join(DIR, file), "utf8");
    const line_starts = [0];
    for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) line_starts.push(i + 1);
    try {
      run_compiler(config, (compiler) => {
        const sess = compiler.sess;
        // the session's default human emitter (session.rs `default_emitter`), into a buffer
        let em = AnnotateSnippetEmitter.new(AutoStream.new(dyn_write(buf), ColorChoice.Never));
        em = AnnotateSnippetEmitter.sm(em, sess.psess.clone_source_map());
        sess.dcx().set_emitter(em);
        const krate = parse(sess);
        hooks.pre?.(sess, krate);
        create_and_enter_global_ctxt(compiler, krate, (tcx) => {
          void tcx.resolver_for_lowering();
          const sf = sess.source_map().files().deref().find((x) => x.name.$ === "Real")!;
          const start = sf.start_pos as number;
          const sp: SpanAt = (line, col, end_line, end_col) =>
            Span.with_root_ctxt((start + line_starts[line - 1]! + col - 1) as BytePos, (start + line_starts[end_line - 1]! + end_col - 1) as BytePos);
          hooks.post?.(tcx, sp);
        });
      });
    } catch (e) {
      // run_compiler aborts after `finish_diagnostics` when an error was emitted, as rustc does
      if (!(e instanceof FatalErrorMarker)) throw e;
    }
  } finally {
    process.chdir(cwd);
  }
  return new TextDecoder().decode(buf.bytes());
}
