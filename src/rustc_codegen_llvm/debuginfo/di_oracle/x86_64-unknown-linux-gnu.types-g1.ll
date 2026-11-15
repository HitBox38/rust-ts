; ModuleID = 'types.ca9a2c18325d504-cgu.0'
source_filename = "types.ca9a2c18325d504-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@_RNvCs15oYSsIuqjM_5types6GLOBAL = constant <{ [13 x i8], [3 x i8] }> <{ [13 x i8] c"\00\00\00\00\00\00\00@\01\00\00\00\03", [3 x i8] undef }>, align 8, !guid !0
@vtable.0 = private unnamed_addr constant [24 x i8] c"\00\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00\04\00\00\00\00\00\00\00", align 8, !guid !1
@vtable.1 = private unnamed_addr constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\10\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area }>, align 8, !guid !2

; types::take::<types::closure::{closure#0}>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %t) unnamed_addr #0 !dbg !11 !guid !16 {
start:
  ret i32 0, !dbg !17
}

; types::take::<types::rec_impl>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_() unnamed_addr #0 !dbg !18 !guid !19 {
start:
  ret i32 0, !dbg !20
}

; types::diverge
; Function Attrs: noreturn nonlazybind uwtable
define internal void @_RNvCs15oYSsIuqjM_5types7diverge() unnamed_addr #1 !dbg !21 !guid !22 {
start:
  br label %bb1, !dbg !23

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !23
}

; types::rec_impl
; Function Attrs: nonlazybind uwtable
define void @_RNvCs15oYSsIuqjM_5types8rec_impl() unnamed_addr #2 !dbg !24 !guid !25 {
start:
  ret void, !dbg !26
}

; <types::Point as types::Shape>::area
; Function Attrs: nonlazybind uwtable
define i32 @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area(ptr align 8 %self) unnamed_addr #2 !dbg !27 !guid !29 {
start:
  %0 = getelementptr inbounds i8, ptr %self, i64 12, !dbg !30
  %_2 = load i8, ptr %0, align 4, !dbg !30
  %_0 = zext i8 %_2 to i32, !dbg !30
  ret i32 %_0, !dbg !31
}

; Function Attrs: nonlazybind uwtable
define i32 @basics(i8 %a, i64 %b, float %c, double %d, i64 %e, i64 %f, i128 %g, i128 %h, half %i, fp128 %j, i32 %l) unnamed_addr #2 !dbg !32 !guid !33 {
start:
  ret i32 0, !dbg !34
}

; Function Attrs: nonlazybind uwtable
define i32 @closure(i32 %x) unnamed_addr #2 !dbg !35 !guid !36 {
start:
; call types::take::<types::closure::{closure#0}>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %x), !dbg !37
  ret i32 %_0, !dbg !39
}

; Function Attrs: nonlazybind uwtable
define i32 @enums(i8 %c, ptr align 8 %t, ptr align 4 %o, i8 %n, i64 %s.0, i32 %s.1, ptr %e, i128 %w.0, i8 %w.1, ptr align 8 %r) unnamed_addr #2 !dbg !40 !guid !41 {
start:
  ret i32 0, !dbg !42
}

; Function Attrs: nonlazybind uwtable
define align 8 ptr @global() unnamed_addr #2 !dbg !43 !guid !44 {
start:
  ret ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL, !dbg !45
}

; Function Attrs: nonlazybind uwtable
define i32 @never(i1 zeroext %flag) unnamed_addr #2 !dbg !46 !guid !47 {
start:
  br i1 %flag, label %bb1, label %bb2, !dbg !48

bb2:                                              ; preds = %start
  ret i32 1, !dbg !49

bb1:                                              ; preds = %start
; call types::diverge
  call void @_RNvCs15oYSsIuqjM_5types7diverge() #4, !dbg !50
  unreachable, !dbg !50
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @no_principal(ptr align 4 %x) unnamed_addr #2 !dbg !51 !guid !52 {
start:
  %0 = insertvalue { ptr, ptr } poison, ptr %x, 0, !dbg !53
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1, !dbg !53
  ret { ptr, ptr } %1, !dbg !53
}

; Function Attrs: nonlazybind uwtable
define i32 @pointers(ptr align 8 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1, ptr %d.0, ptr align 8 %d.1, ptr %raw, ptr align 2 %m, ptr %f, ptr %op) unnamed_addr #2 !dbg !54 !guid !55 {
start:
  %0 = getelementptr inbounds i8, ptr %d.1, i64 24, !dbg !56
  %1 = load ptr, ptr %0, align 8, !dbg !56, !invariant.load !15, !nonnull !15
  %_0 = call i32 %1(ptr %d.0), !dbg !58
  ret i32 %_0, !dbg !59
}

; Function Attrs: nonlazybind uwtable
define i32 @recursive_fn_type() unnamed_addr #2 !dbg !60 !guid !61 {
start:
; call types::rec_impl
  call void @_RNvCs15oYSsIuqjM_5types8rec_impl(), !dbg !62
; call types::take::<types::rec_impl>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_(), !dbg !63
  ret i32 %_0, !dbg !64
}

; Function Attrs: nonlazybind uwtable
define i32 @structs(ptr align 8 %p, i64 %q.0, i16 %q.1, ptr align 4 %g, ptr align 8 %l) unnamed_addr #2 !dbg !65 !guid !66 {
start:
  %0 = getelementptr inbounds i8, ptr %p, i64 12, !dbg !67
  %_6 = load i8, ptr %0, align 4, !dbg !67
  %_0 = zext i8 %_6 to i32, !dbg !67
  ret i32 %_0, !dbg !69
}

; Function Attrs: nonlazybind uwtable
define i32 @union_(i32 %0) unnamed_addr #2 !dbg !70 !guid !71 {
start:
  %1 = alloca [4 x i8], align 4
  %u = alloca [4 x i8], align 4
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %u, ptr align 4 %1, i64 4, i1 false)
  %_0 = load i32, ptr %u, align 4, !dbg !72
  ret i32 %_0, !dbg !73
}

; Function Attrs: nonlazybind uwtable
define i8 @visibility(ptr %v) unnamed_addr #2 !dbg !74 !guid !75 {
start:
  %0 = getelementptr inbounds i8, ptr %v, i64 3, !dbg !76
  %_0 = load i8, ptr %0, align 1, !dbg !76
  ret i8 %_0, !dbg !77
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @vtable(ptr align 8 %p) unnamed_addr #2 !dbg !78 !guid !79 {
start:
  %0 = insertvalue { ptr, ptr } poison, ptr %p, 0, !dbg !80
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.1, 1, !dbg !80
  ret { ptr, ptr } %1, !dbg !80
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #3

attributes #0 = { noinline nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #4 = { noreturn }

!llvm.module.flags = !{!3, !4, !5, !6, !7}
!llvm.ident = !{!8}
!llvm.dbg.cu = !{!9}

!0 = !{i64 -2440327355056123239}
!1 = !{i64 -6426483837549638915}
!2 = !{i64 -9115322521351085872}
!3 = !{i32 8, !"PIC Level", i32 2}
!4 = !{i32 2, !"RtLibUseGOT", i32 1}
!5 = !{i32 7, !"uwtable", i32 2}
!6 = !{i32 7, !"Dwarf Version", i32 4}
!7 = !{i32 2, !"Debug Info Version", i32 3}
!8 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!9 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !10, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, splitDebugInlining: false, nameTableKind: None)
!10 = !DIFile(filename: "types.rs/@/types.ca9a2c18325d504-cgu.0", directory: ".")
!11 = distinct !DISubprogram(name: "take<types::closure::{closure_env#0}>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_", scope: !13, file: !12, line: 156, type: !14, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !9, templateParams: !15)
!12 = !DIFile(filename: "types.rs", directory: ".", checksumkind: CSK_MD5, checksum: "7cefe7493fc42711a47beabb62f45844")
!13 = !DINamespace(name: "types", scope: null)
!14 = !DISubroutineType(types: !15)
!15 = !{}
!16 = !{i64 1915899645086356215}
!17 = !DILocation(line: 159, column: 2, scope: !11)
!18 = distinct !DISubprogram(name: "take<fn() -> <recursive_type>>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_", scope: !13, file: !12, line: 156, type: !14, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !9, templateParams: !15)
!19 = !{i64 -740690765248574201}
!20 = !DILocation(line: 159, column: 2, scope: !18)
!21 = distinct !DISubprogram(name: "diverge", linkageName: "_RNvCs15oYSsIuqjM_5types7diverge", scope: !13, file: !12, line: 147, type: !14, scopeLine: 147, flags: DIFlagPrototyped | DIFlagNoReturn, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !9, templateParams: !15)
!22 = !{i64 3518661633375468340}
!23 = !DILocation(line: 148, column: 5, scope: !21)
!24 = distinct !DISubprogram(name: "rec_impl", linkageName: "_RNvCs15oYSsIuqjM_5types8rec_impl", scope: !13, file: !12, line: 173, type: !14, scopeLine: 173, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!25 = !{i64 73545626838823865}
!26 = !DILocation(line: 175, column: 2, scope: !24)
!27 = distinct !DISubprogram(name: "area", linkageName: "_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area", scope: !28, file: !12, line: 109, type: !14, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!28 = !DINamespace(name: "{impl#9}", scope: !13)
!29 = !{i64 -4356820192056016148}
!30 = !DILocation(line: 110, column: 9, scope: !27)
!31 = !DILocation(line: 111, column: 6, scope: !27)
!32 = distinct !DISubprogram(name: "basics", scope: !13, file: !12, line: 132, type: !14, scopeLine: 132, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!33 = !{i64 -5181654353206422152}
!34 = !DILocation(line: 135, column: 2, scope: !32)
!35 = distinct !DISubprogram(name: "closure", scope: !13, file: !12, line: 151, type: !14, scopeLine: 151, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!36 = !{i64 -8001930764763462056}
!37 = !DILocation(line: 153, column: 5, scope: !38)
!38 = distinct !DILexicalBlock(scope: !35, file: !12, line: 152, column: 5)
!39 = !DILocation(line: 154, column: 2, scope: !35)
!40 = distinct !DISubprogram(name: "enums", scope: !13, file: !12, line: 122, type: !14, scopeLine: 122, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!41 = !{i64 -6981848288932498368}
!42 = !DILocation(line: 125, column: 2, scope: !40)
!43 = distinct !DISubprogram(name: "global", scope: !13, file: !12, line: 170, type: !14, scopeLine: 170, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!44 = !{i64 7866218443099566236}
!45 = !DILocation(line: 172, column: 2, scope: !43)
!46 = distinct !DISubprogram(name: "never", scope: !13, file: !12, line: 141, type: !14, scopeLine: 141, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!47 = !{i64 4169515925740803783}
!48 = !DILocation(line: 142, column: 8, scope: !46)
!49 = !DILocation(line: 146, column: 2, scope: !46)
!50 = !DILocation(line: 143, column: 9, scope: !46)
!51 = distinct !DISubprogram(name: "no_principal", scope: !13, file: !12, line: 166, type: !14, scopeLine: 166, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!52 = !{i64 -9201868857759523069}
!53 = !DILocation(line: 168, column: 2, scope: !51)
!54 = distinct !DISubprogram(name: "pointers", scope: !13, file: !12, line: 127, type: !14, scopeLine: 127, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!55 = !{i64 5285204393774026867}
!56 = !DILocation(line: 129, column: 5, scope: !57)
!57 = distinct !DILexicalBlock(scope: !54, file: !12, line: 128, column: 5)
!58 = !DILocation(line: 129, column: 7, scope: !57)
!59 = !DILocation(line: 130, column: 2, scope: !54)
!60 = distinct !DISubprogram(name: "recursive_fn_type", scope: !13, file: !12, line: 177, type: !14, scopeLine: 177, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!61 = !{i64 -4635464101160348947}
!62 = !DILocation(line: 178, column: 10, scope: !60)
!63 = !DILocation(line: 178, column: 5, scope: !60)
!64 = !DILocation(line: 179, column: 2, scope: !60)
!65 = distinct !DISubprogram(name: "structs", scope: !13, file: !12, line: 117, type: !14, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!66 = !{i64 -3801848370686489254}
!67 = !DILocation(line: 119, column: 5, scope: !68)
!68 = distinct !DILexicalBlock(scope: !65, file: !12, line: 118, column: 5)
!69 = !DILocation(line: 120, column: 2, scope: !65)
!70 = distinct !DISubprogram(name: "union_", scope: !13, file: !12, line: 137, type: !14, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!71 = !{i64 3738193153085972219}
!72 = !DILocation(line: 138, column: 14, scope: !70)
!73 = !DILocation(line: 139, column: 2, scope: !70)
!74 = distinct !DISubprogram(name: "visibility", scope: !13, file: !12, line: 190, type: !14, scopeLine: 190, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!75 = !{i64 3148254357277744119}
!76 = !DILocation(line: 191, column: 5, scope: !74)
!77 = !DILocation(line: 192, column: 2, scope: !74)
!78 = distinct !DISubprogram(name: "vtable", scope: !13, file: !12, line: 161, type: !14, scopeLine: 161, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !9, templateParams: !15)
!79 = !{i64 3405836996193402751}
!80 = !DILocation(line: 163, column: 2, scope: !78)
