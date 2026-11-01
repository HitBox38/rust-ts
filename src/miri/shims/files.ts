// Port of src/tools/miri/src/shims/files.rs (crate `miri`, plan-m6 D2): STUB by lane miri-contract (wave 35).
// Fill lane: `miri-shims-b` (plan-m6 wave 37). Contract and rules: docs/handoff/miri-contract.md ("How to fill a stub").
// Its types are generated into files.gen.ts (tools/codegen set `miri`); this module re-exports them.
// Until ported, every method declared below is an `unported` placeholder (`stub_*` calls at the end, installed by
// src/miri/lib.ts) and every free fn stops with `unported`. The declarations were translated mechanically from the
// upstream signatures (`Pending<"..">` = a type the translation did not map); the fill lane owns and corrects them.
import { type Pointer } from "../lib.ts";
import { type DynMachineCallback, type MiriInterpCx } from "../machine.ts";
import { type DynFileDescriptionRef, FdId, type FdNum, FdTable, FileDescriptionRef, NullOutput, Stderr, Stdin, Stdout, WeakFileDescriptionRef } from "./files.gen.ts";
import { type IoError } from "./io_error.ts";
import { type Readiness, type ReadinessWatched } from "./readiness.ts";
import { type UnixFileDescription } from "./unix/fd.ts";
import { stub_methods, stub_statics } from "../../rust_ts/miri_stub.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { type InterpResult } from "../../rustc_middle/mir/interpret/mod.ts";
import { type Pending } from "../../rustc_type_ir/decls.ts";
import { type IoError as io_Error } from "../../std/io.ts";
import { unported } from "../../std/panic.ts";
import { type Result } from "../../std/result.ts";
export * from "./files.gen.ts";

// ---- manual impls the generated modules call (stand-ins until the fill lane ports them) ----
/** `impl Clone for WeakFileDescriptionRef` (src/tools/miri/src/shims/files.rs:77): lane miri-shims-b. */
export function clone_WeakFileDescriptionRef<T>(_v: WeakFileDescriptionRef<T>, _clone_T: (v: T) => T): never {
  return unported("miri::shims::files::WeakFileDescriptionRef: Clone (src/tools/miri/src/shims/files.rs:77; lane miri-shims-b)");
}

/** `trait FileDescription` (src/tools/miri/src/shims/files.rs): implemented by the file description / sync object types; `(provided)`
 * members are the trait's default methods (PORTING §8: a `<Trait>_provided` helper holds them once ported). */
export interface FileDescription {
  // shims/files.rs:132
  name(): string;
  // shims/files.rs:140 (provided) // self: FileDescriptionRef<Self>
  read(_communicate_allowed: boolean, _ptr: Pointer, _len: number, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  // shims/files.rs:157 (provided) // self: FileDescriptionRef<Self>
  write(_communicate_allowed: boolean, _ptr: Pointer, _len: number, _ecx: MiriInterpCx, _finish: DynMachineCallback<Result<number, IoError>>): InterpResult;
  // shims/files.rs:169 (provided)
  short_fd_operations(): boolean;
  // shims/files.rs:176 (provided)
  seek(_communicate_allowed: boolean, _offset: Pending<"SeekFrom">): InterpResult<Result<bigint, io_Error>>;
  // shims/files.rs:188 (provided)
  metadata(): InterpResult<Pending<"Either<io::Result<fs::Metadata>, &'static str>">>;
  // shims/files.rs:192 (provided)
  is_tty(_communicate_allowed: boolean): boolean;
  // shims/files.rs:200 (provided) // self: FileDescriptionRef<Self>
  as_unix(): FileDescriptionRef<UnixFileDescription>;
  // shims/files.rs:205 (provided)
  readiness_watched(): ReadinessWatched | undefined;
  // shims/files.rs:210 (provided)
  readiness(): Readiness;
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/files.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/files.rs:666
    read_from_host(this: MiriInterpCx, read_cb: ((_0: Uint8Array) => Result<number, io_Error>), len: number, ptr: Pointer): InterpResult<Result<number, IoError>>;
    // shims/files.rs:689
    write_to_host(this: MiriInterpCx, file: Pending<"impl io::Write">, len: number, ptr: Pointer): InterpResult<Result<number, IoError>>;
  }
}

declare module "./files.gen.ts" {
  interface FdId {
    // shims/files.rs:23
    to_usize(): number;
  }
  namespace FdId {
    // shims/files.rs:28
    export let new_unchecked: (id: number) => FdId;
  }
}
declare module "./files.gen.ts" {
  interface FileDescriptionRef<T> {
    // shims/files.rs:60
    id(): FdId;
    // shims/files.rs:124
    downcast<T>(): FileDescriptionRef<T> | undefined;
  }
  namespace FileDescriptionRef {
    // shims/files.rs:84
    export let downgrade: <T>(this_: FileDescriptionRef<T>) => WeakFileDescriptionRef<T>;
  }
}
declare module "./files.gen.ts" {
  interface WeakFileDescriptionRef<T> {
    // shims/files.rs:90
    upgrade(): FileDescriptionRef<T> | undefined;
    // shims/files.rs:96
    is_closed(): boolean;
  }
}
declare module "./files.gen.ts" {
  namespace Stdin {
    // shims/files.rs:222
    function new_(): Stdin;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  namespace Stdout {
    // shims/files.rs:279
    function new_(): Stdout;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  namespace Stderr {
    // shims/files.rs:336
    function new_(): Stderr;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  namespace NullOutput {
    // shims/files.rs:387
    function new_(): NullOutput;
    export { new_ as new };
  }
}
declare module "./files.gen.ts" {
  interface FdTable {
    // shims/files.rs:607
    new_ref<T>(fd: T): FileDescriptionRef<T>;
    // shims/files.rs:615
    insert_new(fd: Pending<"impl FileDescription">): FdNum;
    // shims/files.rs:621
    insert(fd_ref: DynFileDescriptionRef): FdNum;
    // shims/files.rs:626
    insert_with_min_num(file_handle: DynFileDescriptionRef, min_fd_num: FdNum): FdNum;
    // shims/files.rs:648
    get(fd_num: FdNum): DynFileDescriptionRef | undefined;
    // shims/files.rs:653
    remove(fd_num: FdNum): DynFileDescriptionRef | undefined;
    // shims/files.rs:657
    is_fd_num(fd_num: FdNum): boolean;
  }
  namespace FdTable {
    // shims/files.rs:591
    function new_(): FdTable;
    export { new_ as new };
    // shims/files.rs:594
    export let init: (mute_stdout_stderr: boolean) => FdTable;
  }
}

// shims/files.rs:706 (pub)
export function open_file_or_dir(root: Pending<"fs::Dir"> | undefined, path: string, opts: Pending<"fs::OpenOptions">): Result<Pending<"Either<fs::File, fs::Dir>">, io_Error> {
  return unported("miri::shims::files::open_file_or_dir (src/tools/miri/src/shims/files.rs:706; lane miri-shims-b)");
}

// ---- inventory: the other fns of the file (trait impls, private fns, macros), in upstream order of kind ----
// impl Clone for FileDescriptionRef<T> (shims/files.rs:46): clone (:47)
// impl Deref for FileDescriptionRef<T> (shims/files.rs:52): deref (:54)
// impl PartialEq for FileDescriptionRef<T> (shims/files.rs:65): eq (:66)
// impl Eq for FileDescriptionRef<T> (shims/files.rs:71)
// impl Clone for WeakFileDescriptionRef<T> (shims/files.rs:77): clone (:78)
// impl VisitProvenance for FileDescriptionRef<T> (shims/files.rs:101): visit_provenance (:102)
// trait FileDescriptionExt (shims/files.rs:110): into_rc_any (:111)
// impl FileDescriptionExt for T (shims/files.rs:114): into_rc_any (:115)
// impl FileDescription for Stdin (shims/files.rs:227): name (:228), read (:232), is_tty (:250), readiness_watched (:254), readiness (:258), as_unix (:267)
// impl FileDescription for Stdout (shims/files.rs:284): name (:285), write (:289), is_tty (:309), readiness_watched (:313), readiness (:317), as_unix (:324)
// impl FileDescription for Stderr (shims/files.rs:341): name (:342), write (:346), is_tty (:360), readiness_watched (:364), readiness (:368), as_unix (:375)
// impl FileDescription for NullOutput (shims/files.rs:392): name (:393), write (:397), readiness_watched (:409), readiness (:413), as_unix (:420)
// impl FileDescription for FileHandle (shims/files.rs:432): name (:433), read (:437), write (:462), seek (:485), metadata (:494), is_tty (:498), short_fd_operations (:502), as_unix (:509)
// impl FileDescription for DirHandle (shims/files.rs:521): name (:522), metadata (:526), read (:535), write (:551), as_unix (:568)
// impl VisitProvenance for FdTable (shims/files.rs:584): visit_provenance (:585)

// ---- placeholders (src/rust_ts/miri_stub.ts; the fill lane deletes each name it ports) ----
stub_methods("miri::shims::files::EvalContextExt", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => InterpCx.prototype, ["read_from_host", "write_to_host"]);
stub_methods("miri::shims::files::FdId", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => FdId.prototype, ["to_usize"]);
stub_statics("miri::shims::files::FdId", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => FdId, ["new_unchecked"]);
stub_methods("miri::shims::files::FileDescriptionRef", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => FileDescriptionRef.prototype, ["id", "downcast"]);
stub_statics("miri::shims::files::FileDescriptionRef", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => FileDescriptionRef, ["downgrade"]);
stub_methods("miri::shims::files::WeakFileDescriptionRef", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => WeakFileDescriptionRef.prototype, ["upgrade", "is_closed"]);
stub_statics("miri::shims::files::Stdin", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => Stdin, ["new"]);
stub_statics("miri::shims::files::Stdout", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => Stdout, ["new"]);
stub_statics("miri::shims::files::Stderr", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => Stderr, ["new"]);
stub_statics("miri::shims::files::NullOutput", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => NullOutput, ["new"]);
stub_methods("miri::shims::files::FdTable", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => FdTable.prototype, ["new_ref", "insert_new", "insert", "insert_with_min_num", "get", "remove", "is_fd_num"]);
stub_statics("miri::shims::files::FdTable", "src/tools/miri/src/shims/files.rs", "miri-shims-b", () => FdTable, ["new", "init"]);
