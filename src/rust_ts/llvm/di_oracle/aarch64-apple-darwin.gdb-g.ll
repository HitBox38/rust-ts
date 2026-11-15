; ModuleID = 'gdb.59a7e0cc6e7fded4-cgu.0'
source_filename = "gdb.59a7e0cc6e7fded4-cgu.0"
target datalayout = "e-m:o-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-n32:64-S128-Fn32"
target triple = "arm64-apple-macosx11.0.0"

; gdb::start::<()>
; Function Attrs: uwtable
define hidden i64 @_RINvCs7HeBztP8FDI_3gdb5startuEB2_(ptr %_main, i64 %_argc, ptr %_argv, i8 %_sigpipe) unnamed_addr #0 !dbg !9 !guid !29 {
start:
  %_sigpipe.dbg.spill = alloca [1 x i8], align 1
  %_argv.dbg.spill = alloca [8 x i8], align 8
  %_argc.dbg.spill = alloca [8 x i8], align 8
  %_main.dbg.spill = alloca [8 x i8], align 8
  store ptr %_main, ptr %_main.dbg.spill, align 8
    #dbg_declare(ptr %_main.dbg.spill, !22, !DIExpression(), !30)
  store i64 %_argc, ptr %_argc.dbg.spill, align 8
    #dbg_declare(ptr %_argc.dbg.spill, !23, !DIExpression(), !31)
  store ptr %_argv, ptr %_argv.dbg.spill, align 8
    #dbg_declare(ptr %_argv.dbg.spill, !24, !DIExpression(), !32)
  store i8 %_sigpipe, ptr %_sigpipe.dbg.spill, align 1
    #dbg_declare(ptr %_sigpipe.dbg.spill, !25, !DIExpression(), !33)
  ret i64 0, !dbg !34
}

; gdb::main
; Function Attrs: uwtable
define hidden void @_RNvCs7HeBztP8FDI_3gdb4main() unnamed_addr #0 !dbg !35 !guid !37 {
start:
  ret void, !dbg !38
}

define i32 @main(i32 %0, ptr %1) unnamed_addr #1 !guid !39 {
top:
  %2 = sext i32 %0 to i64
; call gdb::start::<()>
  %3 = call i64 @_RINvCs7HeBztP8FDI_3gdb5startuEB2_(ptr @_RNvCs7HeBztP8FDI_3gdb4main, i64 %2, ptr %1, i8 0)
  %4 = trunc i64 %3 to i32
  ret i32 %4
}

attributes #0 = { uwtable "frame-pointer"="non-leaf" "probe-stack"="inline-asm" "target-cpu"="apple-m1" }
attributes #1 = { "frame-pointer"="non-leaf" "target-cpu"="apple-m1" }

!llvm.module.flags = !{!0, !1, !2, !3, !4, !5}
!llvm.ident = !{!6}
!llvm.dbg.cu = !{!7}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 7, !"PIE Level", i32 2}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{i32 7, !"frame-pointer", i32 1}
!4 = !{i32 7, !"Dwarf Version", i32 4}
!5 = !{i32 2, !"Debug Info Version", i32 3}
!6 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!7 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !8, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, splitDebugInlining: false, nameTableKind: None)
!8 = !DIFile(filename: "gdb.rs/@/gdb.59a7e0cc6e7fded4-cgu.0", directory: ".")
!9 = distinct !DISubprogram(name: "start<()>", linkageName: "_RINvCs7HeBztP8FDI_3gdb5startuEB2_", scope: !11, file: !10, line: 17, type: !12, scopeLine: 17, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !7, templateParams: !26, retainedNodes: !21)
!10 = !DIFile(filename: "gdb.rs", directory: ".", checksumkind: CSK_MD5, checksum: "56dce56332d59085aa6f4c717bb36acb")
!11 = !DINamespace(name: "gdb", scope: null)
!12 = !DISubroutineType(types: !13)
!13 = !{!14, !15, !14, !18, !20}
!14 = !DIBasicType(name: "isize", size: 64, encoding: DW_ATE_signed)
!15 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "fn()", baseType: !16, size: 64, align: 64, dwarfAddressSpace: 0)
!16 = !DISubroutineType(types: !17)
!17 = !{null}
!18 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const *const u8", baseType: !19, size: 64, align: 64, dwarfAddressSpace: 0)
!19 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const u8", baseType: !20, size: 64, align: 64, dwarfAddressSpace: 0)
!20 = !DIBasicType(name: "u8", size: 8, encoding: DW_ATE_unsigned)
!21 = !{!22, !23, !24, !25}
!22 = !DILocalVariable(name: "_main", arg: 1, scope: !9, file: !10, line: 17, type: !15)
!23 = !DILocalVariable(name: "_argc", arg: 2, scope: !9, file: !10, line: 17, type: !14)
!24 = !DILocalVariable(name: "_argv", arg: 3, scope: !9, file: !10, line: 17, type: !18)
!25 = !DILocalVariable(name: "_sigpipe", arg: 4, scope: !9, file: !10, line: 17, type: !20)
!26 = !{!27}
!27 = !DITemplateTypeParameter(name: "T", type: !28)
!28 = !DIBasicType(name: "()", encoding: DW_ATE_unsigned)
!29 = !{i64 -5550952039340957732}
!30 = !DILocation(line: 17, column: 13, scope: !9)
!31 = !DILocation(line: 17, column: 31, scope: !9)
!32 = !DILocation(line: 17, column: 45, scope: !9)
!33 = !DILocation(line: 17, column: 70, scope: !9)
!34 = !DILocation(line: 19, column: 2, scope: !9)
!35 = distinct !DISubprogram(name: "main", linkageName: "_RNvCs7HeBztP8FDI_3gdb4main", scope: !11, file: !10, line: 21, type: !16, scopeLine: 21, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition | DISPFlagMainSubprogram, unit: !7, templateParams: !36)
!36 = !{}
!37 = !{i64 -7318750184558024473}
!38 = !DILocation(line: 21, column: 13, scope: !35)
!39 = !{i64 -2624081020897602054}
