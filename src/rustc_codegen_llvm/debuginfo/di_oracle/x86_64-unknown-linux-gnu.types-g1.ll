; ModuleID = 'types.ca9a2c18325d504-cgu.0'
source_filename = "types.ca9a2c18325d504-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

@_RNvCs15oYSsIuqjM_5types6GLOBAL = constant <{ [13 x i8], [3 x i8] }> <{ [13 x i8] c"\00\00\00\00\00\00\00@\01\00\00\00\03", [3 x i8] undef }>, align 8, !guid !0
@vtable.0 = private unnamed_addr constant <{ [24 x i8], ptr }> <{ [24 x i8] c"\00\00\00\00\00\00\00\00\10\00\00\00\00\00\00\00\08\00\00\00\00\00\00\00", ptr @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area }>, align 8, !guid !1

; types::take::<types::closure::{closure#0}>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %t) unnamed_addr #0 !dbg !10 !guid !15 {
start:
  ret i32 0, !dbg !16
}

; types::take::<types::rec_impl>
; Function Attrs: noinline nonlazybind uwtable
define internal i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_() unnamed_addr #0 !dbg !17 !guid !18 {
start:
  ret i32 0, !dbg !19
}

; types::diverge
; Function Attrs: noreturn nonlazybind uwtable
define internal void @_RNvCs15oYSsIuqjM_5types7diverge() unnamed_addr #1 !dbg !20 !guid !21 {
start:
  br label %bb1, !dbg !22

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !22
}

; types::rec_impl
; Function Attrs: nonlazybind uwtable
define void @_RNvCs15oYSsIuqjM_5types8rec_impl() unnamed_addr #2 !dbg !23 !guid !24 {
start:
  ret void, !dbg !25
}

; <types::Point as types::Shape>::area
; Function Attrs: nonlazybind uwtable
define i32 @_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area(ptr align 8 %self) unnamed_addr #2 !dbg !26 !guid !28 {
start:
  %0 = getelementptr inbounds i8, ptr %self, i64 12, !dbg !29
  %_2 = load i8, ptr %0, align 4, !dbg !29
  %_0 = zext i8 %_2 to i32, !dbg !29
  ret i32 %_0, !dbg !30
}

; Function Attrs: nonlazybind uwtable
define i32 @basics(i8 %a, i64 %b, float %c, double %d, i64 %e, i64 %f, i128 %g, i128 %h, half %i, fp128 %j, i32 %l) unnamed_addr #2 !dbg !31 !guid !32 {
start:
  ret i32 0, !dbg !33
}

; Function Attrs: nonlazybind uwtable
define i32 @closure(i32 %x) unnamed_addr #2 !dbg !34 !guid !35 {
start:
; call types::take::<types::closure::{closure#0}>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_(i32 %x), !dbg !36
  ret i32 %_0, !dbg !38
}

; Function Attrs: nonlazybind uwtable
define i32 @enums(i8 %c, ptr align 8 %t, ptr align 4 %o, i8 %n, i64 %s.0, i32 %s.1, ptr %e, i128 %w.0, i8 %w.1, ptr align 8 %r) unnamed_addr #2 !dbg !39 !guid !40 {
start:
  ret i32 0, !dbg !41
}

; Function Attrs: nonlazybind uwtable
define align 8 ptr @global() unnamed_addr #2 !dbg !42 !guid !43 {
start:
  ret ptr @_RNvCs15oYSsIuqjM_5types6GLOBAL, !dbg !44
}

; Function Attrs: nonlazybind uwtable
define i32 @never(i1 zeroext %flag) unnamed_addr #2 !dbg !45 !guid !46 {
start:
  br i1 %flag, label %bb1, label %bb2, !dbg !47

bb2:                                              ; preds = %start
  ret i32 1, !dbg !48

bb1:                                              ; preds = %start
; call types::diverge
  call void @_RNvCs15oYSsIuqjM_5types7diverge() #4, !dbg !49
  unreachable, !dbg !49
}

; Function Attrs: nonlazybind uwtable
define i32 @pointers(ptr align 8 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1, ptr %d.0, ptr align 8 %d.1, ptr %raw, ptr align 2 %m, ptr %f, ptr %op) unnamed_addr #2 !dbg !50 !guid !51 {
start:
  %0 = getelementptr inbounds i8, ptr %d.1, i64 24, !dbg !52
  %1 = load ptr, ptr %0, align 8, !dbg !52, !invariant.load !14, !nonnull !14
  %_0 = call i32 %1(ptr %d.0), !dbg !54
  ret i32 %_0, !dbg !55
}

; Function Attrs: nonlazybind uwtable
define i32 @recursive_fn_type() unnamed_addr #2 !dbg !56 !guid !57 {
start:
; call types::rec_impl
  call void @_RNvCs15oYSsIuqjM_5types8rec_impl(), !dbg !58
; call types::take::<types::rec_impl>
  %_0 = call i32 @_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_(), !dbg !59
  ret i32 %_0, !dbg !60
}

; Function Attrs: nonlazybind uwtable
define i32 @structs(ptr align 8 %p, i64 %q.0, i16 %q.1, ptr align 4 %g, ptr align 8 %l) unnamed_addr #2 !dbg !61 !guid !62 {
start:
  %0 = getelementptr inbounds i8, ptr %p, i64 12, !dbg !63
  %_6 = load i8, ptr %0, align 4, !dbg !63
  %_0 = zext i8 %_6 to i32, !dbg !63
  ret i32 %_0, !dbg !65
}

; Function Attrs: nonlazybind uwtable
define i32 @union_(i32 %0) unnamed_addr #2 !dbg !66 !guid !67 {
start:
  %1 = alloca [4 x i8], align 4
  %u = alloca [4 x i8], align 4
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 4 %u, ptr align 4 %1, i64 4, i1 false)
  %_0 = load i32, ptr %u, align 4, !dbg !68
  ret i32 %_0, !dbg !69
}

; Function Attrs: nonlazybind uwtable
define i8 @visibility(ptr %v) unnamed_addr #2 !dbg !70 !guid !71 {
start:
  %0 = getelementptr inbounds i8, ptr %v, i64 3, !dbg !72
  %_0 = load i8, ptr %0, align 1, !dbg !72
  ret i8 %_0, !dbg !73
}

; Function Attrs: nonlazybind uwtable
define { ptr, ptr } @vtable(ptr align 8 %p) unnamed_addr #2 !dbg !74 !guid !75 {
start:
  %0 = insertvalue { ptr, ptr } poison, ptr %p, 0, !dbg !76
  %1 = insertvalue { ptr, ptr } %0, ptr @vtable.0, 1, !dbg !76
  ret { ptr, ptr } %1, !dbg !76
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #3

attributes #0 = { noinline nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { noreturn nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #2 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #3 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }
attributes #4 = { noreturn }

!llvm.module.flags = !{!2, !3, !4, !5, !6}
!llvm.ident = !{!7}
!llvm.dbg.cu = !{!8}

!0 = !{i64 -2440327355056123239}
!1 = !{i64 -6426483837549638915}
!2 = !{i32 8, !"PIC Level", i32 2}
!3 = !{i32 2, !"RtLibUseGOT", i32 1}
!4 = !{i32 7, !"uwtable", i32 2}
!5 = !{i32 7, !"Dwarf Version", i32 4}
!6 = !{i32 2, !"Debug Info Version", i32 3}
!7 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!8 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !9, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, splitDebugInlining: false, nameTableKind: None)
!9 = !DIFile(filename: "types.rs/@/types.ca9a2c18325d504-cgu.0", directory: ".")
!10 = distinct !DISubprogram(name: "take<types::closure::{closure_env#0}>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNCNvB2_7closure0EB2_", scope: !12, file: !11, line: 156, type: !13, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !8, templateParams: !14)
!11 = !DIFile(filename: "types.rs", directory: ".", checksumkind: CSK_MD5, checksum: "d86d4b8f50e8f521bc7e930537872c82")
!12 = !DINamespace(name: "types", scope: null)
!13 = !DISubroutineType(types: !14)
!14 = !{}
!15 = !{i64 1915899645086356215}
!16 = !DILocation(line: 159, column: 2, scope: !10)
!17 = distinct !DISubprogram(name: "take<fn() -> <recursive_type>>", linkageName: "_RINvCs15oYSsIuqjM_5types4takeNvB2_8rec_implEB2_", scope: !12, file: !11, line: 156, type: !13, scopeLine: 156, flags: DIFlagPrototyped, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !8, templateParams: !14)
!18 = !{i64 -740690765248574201}
!19 = !DILocation(line: 159, column: 2, scope: !17)
!20 = distinct !DISubprogram(name: "diverge", linkageName: "_RNvCs15oYSsIuqjM_5types7diverge", scope: !12, file: !11, line: 147, type: !13, scopeLine: 147, flags: DIFlagPrototyped | DIFlagNoReturn, spFlags: DISPFlagLocalToUnit | DISPFlagDefinition, unit: !8, templateParams: !14)
!21 = !{i64 3518661633375468340}
!22 = !DILocation(line: 148, column: 5, scope: !20)
!23 = distinct !DISubprogram(name: "rec_impl", linkageName: "_RNvCs15oYSsIuqjM_5types8rec_impl", scope: !12, file: !11, line: 168, type: !13, scopeLine: 168, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!24 = !{i64 73545626838823865}
!25 = !DILocation(line: 170, column: 2, scope: !23)
!26 = distinct !DISubprogram(name: "area", linkageName: "_RNvXs7_Cs15oYSsIuqjM_5typesNtB5_5PointNtB5_5Shape4area", scope: !27, file: !11, line: 109, type: !13, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!27 = !DINamespace(name: "{impl#9}", scope: !12)
!28 = !{i64 -4356820192056016148}
!29 = !DILocation(line: 110, column: 9, scope: !26)
!30 = !DILocation(line: 111, column: 6, scope: !26)
!31 = distinct !DISubprogram(name: "basics", scope: !12, file: !11, line: 132, type: !13, scopeLine: 132, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!32 = !{i64 -5181654353206422152}
!33 = !DILocation(line: 135, column: 2, scope: !31)
!34 = distinct !DISubprogram(name: "closure", scope: !12, file: !11, line: 151, type: !13, scopeLine: 151, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!35 = !{i64 -8001930764763462056}
!36 = !DILocation(line: 153, column: 5, scope: !37)
!37 = distinct !DILexicalBlock(scope: !34, file: !11, line: 152, column: 5)
!38 = !DILocation(line: 154, column: 2, scope: !34)
!39 = distinct !DISubprogram(name: "enums", scope: !12, file: !11, line: 122, type: !13, scopeLine: 122, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!40 = !{i64 -6981848288932498368}
!41 = !DILocation(line: 125, column: 2, scope: !39)
!42 = distinct !DISubprogram(name: "global", scope: !12, file: !11, line: 165, type: !13, scopeLine: 165, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!43 = !{i64 7866218443099566236}
!44 = !DILocation(line: 167, column: 2, scope: !42)
!45 = distinct !DISubprogram(name: "never", scope: !12, file: !11, line: 141, type: !13, scopeLine: 141, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!46 = !{i64 4169515925740803783}
!47 = !DILocation(line: 142, column: 8, scope: !45)
!48 = !DILocation(line: 146, column: 2, scope: !45)
!49 = !DILocation(line: 143, column: 9, scope: !45)
!50 = distinct !DISubprogram(name: "pointers", scope: !12, file: !11, line: 127, type: !13, scopeLine: 127, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!51 = !{i64 5285204393774026867}
!52 = !DILocation(line: 129, column: 5, scope: !53)
!53 = distinct !DILexicalBlock(scope: !50, file: !11, line: 128, column: 5)
!54 = !DILocation(line: 129, column: 7, scope: !53)
!55 = !DILocation(line: 130, column: 2, scope: !50)
!56 = distinct !DISubprogram(name: "recursive_fn_type", scope: !12, file: !11, line: 172, type: !13, scopeLine: 172, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!57 = !{i64 -4635464101160348947}
!58 = !DILocation(line: 173, column: 10, scope: !56)
!59 = !DILocation(line: 173, column: 5, scope: !56)
!60 = !DILocation(line: 174, column: 2, scope: !56)
!61 = distinct !DISubprogram(name: "structs", scope: !12, file: !11, line: 117, type: !13, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!62 = !{i64 -3801848370686489254}
!63 = !DILocation(line: 119, column: 5, scope: !64)
!64 = distinct !DILexicalBlock(scope: !61, file: !11, line: 118, column: 5)
!65 = !DILocation(line: 120, column: 2, scope: !61)
!66 = distinct !DISubprogram(name: "union_", scope: !12, file: !11, line: 137, type: !13, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!67 = !{i64 3738193153085972219}
!68 = !DILocation(line: 138, column: 14, scope: !66)
!69 = !DILocation(line: 139, column: 2, scope: !66)
!70 = distinct !DISubprogram(name: "visibility", scope: !12, file: !11, line: 185, type: !13, scopeLine: 185, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!71 = !{i64 3148254357277744119}
!72 = !DILocation(line: 186, column: 5, scope: !70)
!73 = !DILocation(line: 187, column: 2, scope: !70)
!74 = distinct !DISubprogram(name: "vtable", scope: !12, file: !11, line: 161, type: !13, scopeLine: 161, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !8, templateParams: !14)
!75 = !{i64 3405836996193402751}
!76 = !DILocation(line: 163, column: 2, scope: !74)
