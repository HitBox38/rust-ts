; ModuleID = 'gdb.59a7e0cc6e7fded4-cgu.0'
source_filename = "gdb.59a7e0cc6e7fded4-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@__rustc_debug_gdb_scripts_section__ = linkonce_odr unnamed_addr constant [34 x i8] c"\01gdb_load_rust_pretty_printers.py\00", section ".debug_gdb_scripts", align 1, !guid !0

; gdb::start::<()>
; Function Attrs: nonlazybind uwtable
define hidden i64 @_RINvCs7HeBztP8FDI_3gdb5startuEB2_(ptr %_main, i64 %_argc, ptr %_argv, i8 %_sigpipe) unnamed_addr #0 !dbg !10 !guid !15 {
start:
  ret i64 0, !dbg !16
}

; gdb::main
; Function Attrs: nonlazybind uwtable
define hidden void @_RNvCs7HeBztP8FDI_3gdb4main() unnamed_addr #0 !dbg !17 !guid !18 {
start:
  ret void, !dbg !19
}

; Function Attrs: nonlazybind
define i32 @main(i32 %0, ptr %1) unnamed_addr #1 !guid !20 {
top:
  %2 = load volatile i8, ptr @__rustc_debug_gdb_scripts_section__, align 1
  %3 = sext i32 %0 to i64
; call gdb::start::<()>
  %4 = call i64 @_RINvCs7HeBztP8FDI_3gdb5startuEB2_(ptr @_RNvCs7HeBztP8FDI_3gdb4main, i64 %3, ptr %1, i8 0)
  %5 = trunc i64 %4 to i32
  ret i32 %5
}

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nonlazybind "target-cpu"="x86-64" }

!llvm.module.flags = !{!1, !2, !3, !4, !5, !6}
!llvm.ident = !{!7}
!llvm.dbg.cu = !{!8}

!0 = !{i64 -6971401179101347155}
!1 = !{i32 8, !"PIC Level", i32 2}
!2 = !{i32 7, !"PIE Level", i32 2}
!3 = !{i32 2, !"RtLibUseGOT", i32 1}
!4 = !{i32 7, !"uwtable", i32 2}
!5 = !{i32 7, !"Dwarf Version", i32 4}
!6 = !{i32 2, !"Debug Info Version", i32 3}
!7 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!8 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !9, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, splitDebugInlining: false, nameTableKind: None)
!9 = !DIFile(filename: "gdb.rs/@/gdb.59a7e0cc6e7fded4-cgu.0", directory: ".")
!10 = distinct !DISubprogram(name: "start<()>", linkageName: "_RINvCs7HeBztP8FDI_3gdb5startuEB2_", scope: !12, file: !11, line: 17, type: !13, scopeLine: 17, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !8, templateParams: !14)
!11 = !DIFile(filename: "gdb.rs", directory: ".", checksumkind: CSK_MD5, checksum: "56dce56332d59085aa6f4c717bb36acb")
!12 = !DINamespace(name: "gdb", scope: null)
!13 = !DISubroutineType(types: !14)
!14 = !{}
!15 = !{i64 -5550952039340957732}
!16 = !DILocation(line: 19, column: 2, scope: !10)
!17 = distinct !DISubprogram(name: "main", linkageName: "_RNvCs7HeBztP8FDI_3gdb4main", scope: !12, file: !11, line: 21, type: !13, scopeLine: 21, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition | DISPFlagMainSubprogram, unit: !8, templateParams: !14)
!18 = !{i64 -7318750184558024473}
!19 = !DILocation(line: 21, column: 13, scope: !17)
!20 = !{i64 -2624081020897602054}
