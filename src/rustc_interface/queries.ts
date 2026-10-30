// Port of compiler/rustc_interface/src/queries.rs: `Linker`, which carries the result of `start_codegen` out of the
// global context and links it. PORT: without `-C incremental` (D3) the `rustc_incremental` steps of `link` return at
// once, as upstream's do; with it they are `unported` (`rustc_incremental_*` below).
import "../rustc_session/utils.ts"; // `Session::time` / `Session::timer`
import { writeFileSync } from "node:fs";
import { CompiledModules, type CrateInfo } from "../rustc_codegen_ssa/lib.ts";
import type { DepGraph } from "../rustc_middle/dep_graph/graph.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { OutputFilenames } from "../rustc_session/config.ts";
import { CodegenUnits, type Session } from "../rustc_session/session.ts";
import { LOCAL_CRATE } from "../rustc_span/def_id.ts";
import { assert, unported } from "../std/panic.ts";
import { start_codegen } from "./passes.ts";
import type { EncodedMetadata } from "../rustc_metadata/lib.ts";
import type { CodegenBackend, IncrCompSession, WorkProductMap } from "./stand_ins.ts";

export class Linker {
  constructor(
    private dep_graph: DepGraph,
    private output_filenames: OutputFilenames,
    // Only present when incr. comp. is enabled.
    private crate_hash: unknown /* Svh */ | undefined,
    private crate_info: CrateInfo,
    private metadata: EncodedMetadata,
    private ongoing_codegen: unknown /* Box<dyn Any> */,
  ) {}

  // rustc: compiler/rustc_interface/src/queries.rs:29 codegen_and_build_linker
  static codegen_and_build_linker(tcx: TyCtxt, codegen_backend: CodegenBackend): Linker {
    const [ongoing_codegen, crate_info, metadata] = start_codegen(codegen_backend, tcx);

    return new Linker(
      /* dep_graph */ tcx.dep_graph,
      /* output_filenames */ tcx.output_filenames(null) as OutputFilenames,
      /* crate_hash */ tcx.sess.opts.incremental !== undefined ? tcx.crate_hash(LOCAL_CRATE) : undefined,
      crate_info,
      metadata,
      ongoing_codegen,
    );
  }

  // rustc: compiler/rustc_interface/src/queries.rs:49 link
  link(sess: Session, incr_comp_session: IncrCompSession | undefined, codegen_backend: CodegenBackend): void {
    // PORT: `link(self, ..)` consumes the `Linker`: its fields drop when the body returns or unwinds, and dropping
    // `metadata` (an `EncodedMetadata`) removes its temporary directory.
    try {
      const [compiled_modules, work_products] = sess.time("finish_ongoing_codegen", (): [CompiledModules, WorkProductMap] => {
        // match self.ongoing_codegen.downcast::<CompiledModules>()
        if (this.ongoing_codegen instanceof CompiledModules) {
          // This was a check only build
          return [this.ongoing_codegen, new Map()];
        } else {
          return codegen_backend.join_codegen(this.ongoing_codegen, sess, incr_comp_session, this.output_filenames, this.crate_info);
        }
      });

      if (CodegenUnits.as_usize(sess.codegen_units()) === 1 && sess.opts.unstable_opts.time_llvm_passes) {
        codegen_backend.print_pass_timings();
      }

      if (sess.early_sess.print_llvm_stats()) {
        codegen_backend.print_statistics();
      }

      const out_path = sess.early_sess.print_llvm_stats_json();
      if (out_path !== undefined) {
        const llvm_stats_json = codegen_backend.print_statistics_json();

        if (llvm_stats_json.length !== 0) {
          try {
            writeFileSync(out_path, llvm_stats_json);
          } catch (e) {
            // sess.dcx().err(format!("failed to write stats to {}: {}", out_path, e));
            // PORT: `{e}` is the io::Error's Display, which is not modelled for arbitrary errnos.
            unported(`std::io::Error Display (failed to write stats to ${out_path}: ${(e as NodeJS.ErrnoException).code})`);
          }
        } else {
          sess
            .dcx()
            .warn(
              `requested to print LLVM statistics to JSON file ${out_path}, but the codegen backend ` + `did not provide any statistics`,
            );
        }
      }

      sess.timings.end_section(sess.dcx(), "Codegen");

      if (sess.opts.incremental !== undefined) {
        const path = this.metadata.path();
        if (path !== undefined) {
          // let (id, product) = rustc_incremental::copy_cgu_workproduct_to_incr_comp_cache_dir(
          //     sess, incr_comp_session.as_ref().unwrap(), WorkProduct::METADATA_WORKPRODUCT_CGU_NAME,
          //     &[(OutputType::Metadata.extension(), path)]);
          // work_products.insert(id, product);
          void work_products;
          unported("rustc_incremental::copy_cgu_workproduct_to_incr_comp_cache_dir (-C incremental; D3)");
        }
      }

      const guar = sess.dcx().has_errors_or_delayed_bugs();
      if (guar !== undefined) {
        guar.raise_fatal();
      }

      const _timer = sess.timer("link");

      sess.time("serialize_work_products", () => {
        rustc_incremental_save_work_product_index(sess, incr_comp_session, this.dep_graph, work_products);
      });

      const prof = sess.prof;
      prof.generic_activity("drop_dep_graph").run(() => {
        // drop(self.dep_graph)
      });

      // Now that we won't touch anything in the incremental compilation directory
      // any more, we can finalize it (which involves renaming it)
      rustc_incremental_finalize_session_directory(sess, incr_comp_session, this.crate_hash);

      // The `HostMetadata` offload pass only writes the kernel manifest.
      // Codegen was already skipped so there are no files to link.
      if (sess.opts.unstable_opts.offload.some((o) => o.$ === "HostMetadata")) {
        return;
      }

      if (![...sess.opts.output_types.keys()].some((i) => i === "Exe" || i === "Metadata")) {
        return;
      }

      if (sess.opts.unstable_opts.no_link) {
        // let rlink_file = self.output_filenames.with_extension(config::RLINK_EXT);
        // CompiledModules::serialize_rlink(sess, &rlink_file, &compiled_modules, &self.crate_info, &self.metadata,
        //     &self.output_filenames).unwrap_or_else(|error| sess.dcx().emit_fatal(FailedWritingFile { .. }));
        unported("rustc_codegen_ssa::CompiledModules::serialize_rlink (-Z no-link)");
        return;
      }

      const _timer2 = sess.prof.verbose_generic_activity("link_crate");
      const _timing = sess.timings.section_guard(sess.dcx(), "Linking");
      try {
        codegen_backend.link(sess, compiled_modules, this.crate_info, this.metadata, this.output_filenames);
      } finally {
        // PORT: `_timing` is a drop guard (`TimingSectionGuard`): it ends the section when `link` returns or unwinds.
        _timing.drop();
      }
    } finally {
      this.metadata.drop();
    }
  }
}

/** `rustc_incremental::save_work_product_index` (persist/save.rs:93). PORT: stand-in, no incremental (D3). */
function rustc_incremental_save_work_product_index(
  sess: Session,
  _incr_comp_session: IncrCompSession | undefined,
  _dep_graph: DepGraph,
  _new_work_products: WorkProductMap,
): void {
  if (sess.opts.incremental === undefined) {
    return;
  }
  unported("rustc_incremental::save_work_product_index (-C incremental; D3)");
}

/** `rustc_incremental::finalize_session_directory` (persist/fs.rs:277). PORT: stand-in, no incremental (D3). */
function rustc_incremental_finalize_session_directory(sess: Session, _incr_comp_session: IncrCompSession | undefined, _svh: unknown | undefined): void {
  assert(sess.dcx().has_errors_or_delayed_bugs() === undefined, "assertion failed: sess.dcx().has_errors_or_delayed_bugs().is_none()");

  if (sess.opts.incremental === undefined) {
    return;
  }
  unported("rustc_incremental::finalize_session_directory (-C incremental; D3)");
}
