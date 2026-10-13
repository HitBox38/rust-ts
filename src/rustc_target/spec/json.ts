// compiler/rustc_target/src/spec/json.rs
//
// Ported: `impl ToJson for Target` (`--print target-spec-json`). Not ported: `Target::from_json`
// (json.rs:19; target JSON files, see `Target.from_json` in ./mod.ts), the `Wrapper` deserialization
// helpers and `json_schema` (json.rs:639; `--print target-spec-json-schema`).
import { CanonAbi_to_json, Endian_to_json, type Json, JsonObject, TargetMetadata_to_json, bool_to_json, btree_map_to_json, num_to_json, option_to_json, slice_to_json, str_to_json } from "../json.ts";
import {
  Align_to_json,
  Arch,
  btree_entries,
  CfgAbi,
  CodeModel,
  DebuginfoKind,
  Env,
  FloatAbi,
  FramePointer,
  type LinkArgsCli,
  LinkerFlavorCli,
  LinkerFlavorCli_cmp,
  LinkOutputKind,
  LinkOutputKind_cmp,
  LinkSelfContainedDefault,
  LldFlavor,
  LlvmAbi,
  MergeFunctions,
  Os,
  PanicStrategy,
  RelocModel,
  RelroLevel,
  RustcAbi,
  SanitizerSet_to_json,
  SmallDataThresholdSupport,
  spec_value_eq,
  SplitDebuginfo,
  StackProbeType,
  SymbolVisibility,
  type Target,
  TargetOptions,
  type TargetOptionsFields,
  TlsModel,
  BinaryFormat,
} from "./mod.ts";
import type { CrtObjects } from "./crt_objects.ts";
import { unreachable } from "../../std/panic.ts";

const strs = (v: readonly string[]): Json => slice_to_json(v, str_to_json);
const opt = <T>(f: (v: T) => Json) => (v: T | undefined): Json => option_to_json(v, f);
/** `impl ToJson for BTreeMap<LinkOutputKind, Vec<StaticCow<str>>>` (keys by `Display`, in key order). */
const crt_objects_to_json = (v: CrtObjects): Json => btree_map_to_json(btree_entries(v, LinkOutputKind_cmp), LinkOutputKind.display, strs);

/** The `ToJson` impl of each `TargetOptions` field's type (what `target.$attr.to_json()` dispatches to). */
const FIELD_TO_JSON: { readonly [K in keyof TargetOptionsFields]: (v: TargetOptionsFields[K]) => Json } = {
  endian: Endian_to_json,
  c_int_width: num_to_json,
  os: Os.to_json,
  env: Env.to_json,
  cfg_abi: CfgAbi.to_json,
  vendor: str_to_json,
  linker: opt(str_to_json),
  linker_flavor: () => unreachable("linker_flavor is not serialized"),
  linker_flavor_json: LinkerFlavorCli.to_json,
  lld_flavor_json: LldFlavor.to_json,
  linker_is_gnu_json: bool_to_json,
  pre_link_objects: crt_objects_to_json,
  post_link_objects: crt_objects_to_json,
  pre_link_objects_self_contained: crt_objects_to_json,
  post_link_objects_self_contained: crt_objects_to_json,
  link_self_contained: LinkSelfContainedDefault.to_json,
  pre_link_args: () => unreachable("pre_link_args is not serialized"),
  pre_link_args_json: () => unreachable("link args are serialized by target_option_val_link_args"),
  late_link_args: () => unreachable("late_link_args is not serialized"),
  late_link_args_json: () => unreachable("link args are serialized by target_option_val_link_args"),
  late_link_args_dynamic: () => unreachable("late_link_args_dynamic is not serialized"),
  late_link_args_dynamic_json: () => unreachable("link args are serialized by target_option_val_link_args"),
  late_link_args_static: () => unreachable("late_link_args_static is not serialized"),
  late_link_args_static_json: () => unreachable("link args are serialized by target_option_val_link_args"),
  post_link_args: () => unreachable("post_link_args is not serialized"),
  post_link_args_json: () => unreachable("link args are serialized by target_option_val_link_args"),
  link_script: opt(str_to_json),
  link_env: () => unreachable("link_env is serialized by target_option_val_env"),
  link_env_remove: strs,
  asm_args: strs,
  cpu: str_to_json,
  need_explicit_cpu: bool_to_json,
  requires_consistent_cpu: bool_to_json,
  unsupported_cpus: strs,
  features: str_to_json,
  direct_access_external_data: opt(bool_to_json),
  dynamic_linking: bool_to_json,
  dll_tls_export: bool_to_json,
  only_cdylib: bool_to_json,
  executables: bool_to_json,
  relocation_model: RelocModel.to_json,
  code_model: opt(CodeModel.to_json),
  tls_model: TlsModel.to_json,
  disable_redzone: bool_to_json,
  frame_pointer: FramePointer.to_json,
  function_sections: bool_to_json,
  dll_prefix: str_to_json,
  dll_suffix: str_to_json,
  exe_suffix: str_to_json,
  staticlib_prefix: str_to_json,
  staticlib_suffix: str_to_json,
  families: strs,
  abi_return_struct_as_int: bool_to_json,
  is_like_aix: bool_to_json,
  is_like_darwin: bool_to_json,
  is_like_gpu: bool_to_json,
  is_like_solaris: bool_to_json,
  is_like_windows: bool_to_json,
  is_like_msvc: bool_to_json,
  is_like_wasm: bool_to_json,
  is_like_android: bool_to_json,
  is_like_vexos: bool_to_json,
  binary_format: BinaryFormat.to_json,
  default_dwarf_version: num_to_json,
  has_rpath: bool_to_json,
  no_default_libraries: bool_to_json,
  position_independent_executables: bool_to_json,
  static_position_independent_executables: bool_to_json,
  plt_by_default: bool_to_json,
  relro_level: RelroLevel.to_json,
  archive_format: str_to_json,
  allow_asm: bool_to_json,
  static_initializer_must_be_acyclic: bool_to_json,
  main_needs_argc_argv: bool_to_json,
  has_thread_local: bool_to_json,
  obj_is_bitcode: bool_to_json,
  min_atomic_width: opt(num_to_json),
  max_atomic_width: opt(num_to_json),
  atomic_cas: bool_to_json,
  panic_strategy: PanicStrategy.to_json,
  crt_static_allows_dylibs: bool_to_json,
  crt_static_default: bool_to_json,
  crt_static_respected: bool_to_json,
  stack_probes: StackProbeType.to_json,
  min_global_align: opt(Align_to_json),
  default_codegen_units: opt(num_to_json),
  default_codegen_backend: opt(str_to_json),
  trap_unreachable: bool_to_json,
  requires_lto: bool_to_json,
  singlethread: bool_to_json,
  no_builtins: bool_to_json,
  default_visibility: opt(SymbolVisibility.to_json),
  emit_debug_gdb_scripts: bool_to_json,
  requires_uwtable: bool_to_json,
  default_uwtable: bool_to_json,
  simd_types_indirect: bool_to_json,
  limit_rdylib_exports: bool_to_json,
  override_export_symbols: opt(strs),
  merge_functions: MergeFunctions.to_json,
  mcount: str_to_json,
  llvm_mcount_intrinsic: opt(str_to_json),
  llvm_abiname: LlvmAbi.to_json,
  llvm_floatabi: opt(FloatAbi.to_json),
  rustc_abi: opt(RustcAbi.to_json),
  relax_elf_relocations: bool_to_json,
  llvm_args: strs,
  use_ctors_section: bool_to_json,
  eh_frame_header: bool_to_json,
  has_thumb_interworking: bool_to_json,
  debuginfo_kind: DebuginfoKind.to_json,
  split_debuginfo: SplitDebuginfo.to_json,
  supported_split_debuginfo: (v) => slice_to_json(v, SplitDebuginfo.to_json),
  supported_sanitizers: SanitizerSet_to_json,
  default_sanitizers: SanitizerSet_to_json,
  c_enum_min_bits: opt(num_to_json),
  generate_arange_section: bool_to_json,
  supports_stack_protector: bool_to_json,
  entry_name: str_to_json,
  entry_abi: CanonAbi_to_json,
  supports_fentry: bool_to_json,
  supports_xray: bool_to_json,
  default_address_space: () => unreachable("default_address_space is not serialized"),
  small_data_threshold_support: SmallDataThresholdSupport.to_json,
};

// impl ToJson for Target
// rustc: compiler/rustc_target/src/spec/json.rs:245 to_json
export function Target_to_json(self: Target): Json {
  const d = new JsonObject();
  const default_: TargetOptions = TargetOptions.default();
  const target = self.clone();
  target.update_to_cli();

  // macro_rules! target_val
  const target_val = (attr: "llvm_target" | "metadata" | "pointer_width" | "arch" | "data_layout", name: string): void => {
    let v: Json;
    switch (attr) {
      case "llvm_target":
        v = str_to_json(target.llvm_target);
        break;
      case "metadata":
        v = TargetMetadata_to_json(target.metadata);
        break;
      case "pointer_width":
        v = num_to_json(target.pointer_width);
        break;
      case "arch":
        v = Arch.to_json(target.arch);
        break;
      case "data_layout":
        v = str_to_json(target.data_layout);
        break;
    }
    d.insert(name, v);
  };

  // macro_rules! target_option_val
  const target_option_val = <K extends keyof TargetOptionsFields>(attr: K, name: string): void => {
    // #[allow(rustc::bad_opt_access)]
    if (!spec_value_eq(default_[attr], target.options[attr])) {
      d.insert(name, FIELD_TO_JSON[attr](target.options[attr]));
    }
  };
  // (link_args - $attr:ident, $json_name:expr)
  const target_option_val_link_args = (
    attr: "pre_link_args_json" | "late_link_args_json" | "late_link_args_dynamic_json" | "late_link_args_static_json" | "post_link_args_json",
    name: string,
  ): void => {
    if (!spec_value_eq(default_[attr], target.options[attr])) {
      const args: LinkArgsCli = target.options[attr];
      const obj = new Map<string, string[]>(btree_entries(args, LinkerFlavorCli_cmp).map(([k, v]) => [LinkerFlavorCli.desc(k), [...v]]));
      // `.collect::<BTreeMap<_, _>>()` + `obj.to_json()`
      d.insert(name, btree_map_to_json(obj, (k) => k, strs));
    }
  };
  // (env - $attr:ident)
  const target_option_val_env = (attr: "link_env"): void => {
    const name = attr.replaceAll("_", "-");
    if (!spec_value_eq(default_[attr], target.options[attr])) {
      const obj = target.options[attr].map(([k, v]) => `${k}=${v}`);
      d.insert(name, strs(obj));
    }
  };

  target_val("llvm_target", "llvm-target");
  target_val("metadata", "metadata");
  target_val("pointer_width", "target-pointer-width");
  target_val("arch", "arch");
  target_val("data_layout", "data-layout");
  target_option_val("endian", "target-endian");
  target_option_val("c_int_width", "target-c-int-width");
  target_option_val("os", "os");
  target_option_val("env", "env");
  target_option_val("cfg_abi", "abi");
  target_option_val("vendor", "vendor");
  target_option_val("linker", "linker");
  target_option_val("linker_flavor_json", "linker-flavor");
  target_option_val("lld_flavor_json", "lld-flavor");
  target_option_val("linker_is_gnu_json", "linker-is-gnu");
  target_option_val("pre_link_objects", "pre-link-objects");
  target_option_val("post_link_objects", "post-link-objects");
  target_option_val("pre_link_objects_self_contained", "pre-link-objects-fallback");
  target_option_val("post_link_objects_self_contained", "post-link-objects-fallback");
  target_option_val_link_args("pre_link_args_json", "pre-link-args");
  target_option_val_link_args("late_link_args_json", "late-link-args");
  target_option_val_link_args("late_link_args_dynamic_json", "late-link-args-dynamic");
  target_option_val_link_args("late_link_args_static_json", "late-link-args-static");
  target_option_val_link_args("post_link_args_json", "post-link-args");
  target_option_val("link_script", "link-script");
  target_option_val_env("link_env");
  target_option_val("link_env_remove", "link-env-remove");
  target_option_val("asm_args", "asm-args");
  target_option_val("cpu", "cpu");
  target_option_val("need_explicit_cpu", "need-explicit-cpu");
  target_option_val("requires_consistent_cpu", "requires-consistent-cpu");
  target_option_val("unsupported_cpus", "unsupported-cpus");
  target_option_val("features", "features");
  target_option_val("dynamic_linking", "dynamic-linking");
  target_option_val("direct_access_external_data", "direct-access-external-data");
  target_option_val("dll_tls_export", "dll-tls-export");
  target_option_val("only_cdylib", "only-cdylib");
  target_option_val("executables", "executables");
  target_option_val("relocation_model", "relocation-model");
  target_option_val("code_model", "code-model");
  target_option_val("tls_model", "tls-model");
  target_option_val("disable_redzone", "disable-redzone");
  target_option_val("frame_pointer", "frame-pointer");
  target_option_val("function_sections", "function-sections");
  target_option_val("dll_prefix", "dll-prefix");
  target_option_val("dll_suffix", "dll-suffix");
  target_option_val("exe_suffix", "exe-suffix");
  target_option_val("staticlib_prefix", "staticlib-prefix");
  target_option_val("staticlib_suffix", "staticlib-suffix");
  target_option_val("families", "target-family");
  target_option_val("abi_return_struct_as_int", "abi-return-struct-as-int");
  target_option_val("is_like_aix", "is-like-aix");
  target_option_val("is_like_darwin", "is-like-darwin");
  target_option_val("is_like_solaris", "is-like-solaris");
  target_option_val("is_like_windows", "is-like-windows");
  target_option_val("is_like_gpu", "is-like-gpu");
  target_option_val("is_like_msvc", "is-like-msvc");
  target_option_val("is_like_wasm", "is-like-wasm");
  target_option_val("is_like_android", "is-like-android");
  target_option_val("is_like_vexos", "is-like-vexos");
  target_option_val("binary_format", "binary-format");
  target_option_val("default_dwarf_version", "default-dwarf-version");
  target_option_val("has_rpath", "has-rpath");
  target_option_val("no_default_libraries", "no-default-libraries");
  target_option_val("position_independent_executables", "position-independent-executables");
  target_option_val("static_position_independent_executables", "static-position-independent-executables");
  target_option_val("plt_by_default", "plt-by-default");
  target_option_val("relro_level", "relro-level");
  target_option_val("archive_format", "archive-format");
  target_option_val("allow_asm", "allow-asm");
  target_option_val("static_initializer_must_be_acyclic", "static-initializer-must-be-acyclic");
  target_option_val("main_needs_argc_argv", "main-needs-argc-argv");
  target_option_val("has_thread_local", "has-thread-local");
  target_option_val("obj_is_bitcode", "obj-is-bitcode");
  target_option_val("min_atomic_width", "min-atomic-width");
  target_option_val("max_atomic_width", "max-atomic-width");
  target_option_val("atomic_cas", "atomic-cas");
  target_option_val("panic_strategy", "panic-strategy");
  target_option_val("crt_static_allows_dylibs", "crt-static-allows-dylibs");
  target_option_val("crt_static_default", "crt-static-default");
  target_option_val("crt_static_respected", "crt-static-respected");
  target_option_val("stack_probes", "stack-probes");
  target_option_val("min_global_align", "min-global-align");
  target_option_val("default_codegen_units", "default-codegen-units");
  target_option_val("default_codegen_backend", "default-codegen-backend");
  target_option_val("trap_unreachable", "trap-unreachable");
  target_option_val("requires_lto", "requires-lto");
  target_option_val("singlethread", "singlethread");
  target_option_val("no_builtins", "no-builtins");
  target_option_val("default_visibility", "default-visibility");
  target_option_val("emit_debug_gdb_scripts", "emit-debug-gdb-scripts");
  target_option_val("requires_uwtable", "requires-uwtable");
  target_option_val("default_uwtable", "default-uwtable");
  target_option_val("simd_types_indirect", "simd-types-indirect");
  target_option_val("limit_rdylib_exports", "limit-rdylib-exports");
  target_option_val("override_export_symbols", "override-export-symbols");
  target_option_val("merge_functions", "merge-functions");
  target_option_val("mcount", "target-mcount");
  target_option_val("llvm_mcount_intrinsic", "llvm-mcount-intrinsic");
  target_option_val("llvm_abiname", "llvm-abiname");
  target_option_val("llvm_floatabi", "llvm-floatabi");
  target_option_val("rustc_abi", "rustc-abi");
  target_option_val("relax_elf_relocations", "relax-elf-relocations");
  target_option_val("llvm_args", "llvm-args");
  target_option_val("use_ctors_section", "use-ctors-section");
  target_option_val("eh_frame_header", "eh-frame-header");
  target_option_val("has_thumb_interworking", "has-thumb-interworking");
  target_option_val("debuginfo_kind", "debuginfo-kind");
  target_option_val("split_debuginfo", "split-debuginfo");
  target_option_val("supported_split_debuginfo", "supported-split-debuginfo");
  target_option_val("supported_sanitizers", "supported-sanitizers");
  target_option_val("default_sanitizers", "default-sanitizers");
  target_option_val("c_enum_min_bits", "c-enum-min-bits");
  target_option_val("generate_arange_section", "generate-arange-section");
  target_option_val("supports_stack_protector", "supports-stack-protector");
  target_option_val("small_data_threshold_support", "small-data-threshold-support");
  target_option_val("entry_name", "entry-name");
  target_option_val("entry_abi", "entry-abi");
  target_option_val("supports_fentry", "supports-fentry");
  target_option_val("supports_xray", "supports-xray");

  // Serializing `-Clink-self-contained` needs a dynamic key to support the
  // backwards-compatible variants.
  d.insert(LinkSelfContainedDefault.json_key(self.link_self_contained), LinkSelfContainedDefault.to_json(self.link_self_contained));

  return d;
}
