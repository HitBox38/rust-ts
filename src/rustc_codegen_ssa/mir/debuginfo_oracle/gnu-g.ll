; ModuleID = 'debuginfo.5788dedd18320a49-cgu.0'
source_filename = "debuginfo.5788dedd18320a49-cgu.0"
target datalayout = "e-m:e-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-unknown-linux-gnu"

; <i8 as debuginfo::Neg>::neg
; Function Attrs: nonlazybind uwtable
define i8 @_RNvXsc_Cs7vWAa3jVger_9debuginfoaNtB5_3Neg3neg(i8 %self) unnamed_addr #0 !dbg !16 !guid !25 {
start:
  %self.dbg.spill = alloca [1 x i8], align 1
  store i8 %self, ptr %self.dbg.spill, align 1
    #dbg_declare(ptr %self.dbg.spill, !23, !DIExpression(), !26)
  br label %bb1, !dbg !27

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !27
}

; Function Attrs: nonlazybind uwtable
define i64 @big(ptr align 8 %b) unnamed_addr #0 !dbg !28 !guid !39 {
start:
    #dbg_declare(ptr %b, !38, !DIExpression(), !40)
  %0 = getelementptr inbounds i8, ptr %b, i64 16, !dbg !41
  %_0 = load i64, ptr %0, align 8, !dbg !41
  ret i64 %_0, !dbg !42
}

; Function Attrs: nonlazybind uwtable
define i32 @borrowed(i32 %0) unnamed_addr #0 !dbg !43 !guid !52 {
start:
  %r.dbg.spill = alloca [8 x i8], align 8
  %x = alloca [4 x i8], align 4
  store i32 %0, ptr %x, align 4
    #dbg_declare(ptr %x, !48, !DIExpression(), !53)
  store ptr %x, ptr %r.dbg.spill, align 8, !dbg !54
    #dbg_declare(ptr %r.dbg.spill, !49, !DIExpression(), !55)
  %_0 = load i32, ptr %x, align 4, !dbg !56
  ret i32 %_0, !dbg !57
}

; Function Attrs: nonlazybind uwtable
define void @closure(i32 %x) unnamed_addr #0 !dbg !58 !guid !70 {
start:
  %rc.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [0 x i8], align 1
  %x.dbg.spill = alloca [4 x i8], align 4
  %_2 = alloca [0 x i8], align 1
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !62, !DIExpression(), !71)
    #dbg_declare(ptr %c.dbg.spill, !63, !DIExpression(), !72)
  store ptr %_2, ptr %rc.dbg.spill, align 8, !dbg !73
    #dbg_declare(ptr %rc.dbg.spill, !67, !DIExpression(), !74)
  ret void, !dbg !75
}

; Function Attrs: nonlazybind uwtable
define i32 @locals(i32 %x) unnamed_addr #0 !dbg !76 !guid !83 {
start:
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !78, !DIExpression(), !84)
    #dbg_declare(ptr %x.dbg.spill, !79, !DIExpression(), !85)
    #dbg_declare(ptr %x.dbg.spill, !81, !DIExpression(), !86)
  ret i32 %x, !dbg !87
}

; Function Attrs: nonlazybind uwtable
define i32 @pair(i32 %p.0, i32 %p.1) unnamed_addr #0 !dbg !88 !guid !97 {
start:
  %p.dbg.spill = alloca [8 x i8], align 4
  store i32 %p.0, ptr %p.dbg.spill, align 4
  %0 = getelementptr inbounds i8, ptr %p.dbg.spill, i64 4
  store i32 %p.1, ptr %0, align 4
    #dbg_declare(ptr %p.dbg.spill, !96, !DIExpression(), !98)
  ret i32 %p.1, !dbg !99
}

; Function Attrs: nonlazybind uwtable
define i32 @pair_by_value(i32 %self.0, i32 %self.1) unnamed_addr #0 !dbg !100 !guid !104 {
start:
  %self.dbg.spill = alloca [8 x i8], align 4
  store i32 %self.0, ptr %self.dbg.spill, align 4
  %0 = getelementptr inbounds i8, ptr %self.dbg.spill, i64 4
  store i32 %self.1, ptr %0, align 4
    #dbg_declare(ptr %self.dbg.spill, !103, !DIExpression(), !105)
  ret i32 %self.1, !dbg !106
}

; Function Attrs: nonlazybind uwtable
define void @pair_closure(ptr align 4 %self) unnamed_addr #0 !dbg !107 !guid !129 {
start:
  %rw.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [0 x i8], align 1
  %c.dbg.spill = alloca [0 x i8], align 1
  %self.dbg.spill = alloca [8 x i8], align 8
  %_2 = alloca [0 x i8], align 1
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !113, !DIExpression(), !130)
    #dbg_declare(ptr %c.dbg.spill, !114, !DIExpression(), !131)
    #dbg_declare(ptr %w.dbg.spill, !119, !DIExpression(), !132)
  store ptr %_2, ptr %rw.dbg.spill, align 8, !dbg !133
    #dbg_declare(ptr %rw.dbg.spill, !126, !DIExpression(), !134)
  ret void, !dbg !135
}

; Function Attrs: nonlazybind uwtable
define i32 @pair_first(ptr align 4 %self) unnamed_addr #0 !dbg !136 !guid !142 {
start:
  %self.dbg.spill = alloca [8 x i8], align 8
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !141, !DIExpression(), !143)
  %_0 = load i32, ptr %self, align 4, !dbg !144
  ret i32 %_0, !dbg !145
}

; Function Attrs: nonlazybind uwtable
define i32 @scalar(i32 %x) unnamed_addr #0 !dbg !146 !guid !149 {
start:
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !148, !DIExpression(), !150)
  ret i32 %x, !dbg !151
}

; Function Attrs: nonlazybind uwtable
define void @types(i32 %w, ptr %ww, i32 %t.0, i1 zeroext %t.1, ptr align 8 %r, ptr %p, ptr %m, ptr %d.0, ptr align 8 %d.1, ptr %ds.0, ptr align 8 %ds.1, ptr %da.0, ptr align 8 %da.1, i1 zeroext %e, i32 %o.0, i32 %o.1, ptr %f, ptr %fu, i32 %0, ptr align 4 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1) unnamed_addr #0 !dbg !152 !guid !272 {
start:
  %cb.dbg.spill = alloca [0 x i8], align 1
  %ci.dbg.spill = alloca [0 x i8], align 1
  %cu.dbg.spill = alloca [0 x i8], align 1
  %i.dbg.spill = alloca [0 x i8], align 1
  %unit.dbg.spill = alloca [0 x i8], align 1
  %_21.dbg.spill = alloca [0 x i8], align 1
  %_20.dbg.spill = alloca [0 x i8], align 1
  %_19.dbg.spill = alloca [0 x i8], align 1
  %s.dbg.spill = alloca [16 x i8], align 8
  %sl.dbg.spill = alloca [16 x i8], align 8
  %fu.dbg.spill = alloca [8 x i8], align 8
  %f.dbg.spill = alloca [8 x i8], align 8
  %_13.dbg.spill = alloca [0 x i8], align 1
  %o.dbg.spill = alloca [8 x i8], align 4
  %e.dbg.spill = alloca [1 x i8], align 1
  %da.dbg.spill = alloca [16 x i8], align 8
  %ds.dbg.spill = alloca [16 x i8], align 8
  %d.dbg.spill = alloca [16 x i8], align 8
  %m.dbg.spill = alloca [8 x i8], align 8
  %p.dbg.spill = alloca [8 x i8], align 8
  %r.dbg.spill = alloca [8 x i8], align 8
  %_4.dbg.spill = alloca [0 x i8], align 1
  %t.dbg.spill = alloca [8 x i8], align 4
  %ww.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [4 x i8], align 4
  %1 = alloca [4 x i8], align 4
  %arr = alloca [4 x i8], align 1
  store i32 %0, ptr %1, align 4
  call void @llvm.memcpy.p0.p0.i64(ptr align 1 %arr, ptr align 4 %1, i64 4, i1 false)
  store i32 %w, ptr %w.dbg.spill, align 4
    #dbg_declare(ptr %w.dbg.spill, !246, !DIExpression(), !273)
  store ptr %ww, ptr %ww.dbg.spill, align 8
    #dbg_declare(ptr %ww.dbg.spill, !247, !DIExpression(), !274)
  store i32 %t.0, ptr %t.dbg.spill, align 4
  %2 = getelementptr inbounds i8, ptr %t.dbg.spill, i64 4
  %3 = zext i1 %t.1 to i8
  store i8 %3, ptr %2, align 4
    #dbg_declare(ptr %t.dbg.spill, !248, !DIExpression(), !275)
    #dbg_declare(ptr %_4.dbg.spill, !267, !DIExpression(), !276)
  store ptr %r, ptr %r.dbg.spill, align 8
    #dbg_declare(ptr %r.dbg.spill, !250, !DIExpression(), !277)
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !251, !DIExpression(), !278)
  store ptr %m, ptr %m.dbg.spill, align 8
    #dbg_declare(ptr %m.dbg.spill, !252, !DIExpression(), !279)
  store ptr %d.0, ptr %d.dbg.spill, align 8
  %4 = getelementptr inbounds i8, ptr %d.dbg.spill, i64 8
  store ptr %d.1, ptr %4, align 8
    #dbg_declare(ptr %d.dbg.spill, !253, !DIExpression(), !280)
  store ptr %ds.0, ptr %ds.dbg.spill, align 8
  %5 = getelementptr inbounds i8, ptr %ds.dbg.spill, i64 8
  store ptr %ds.1, ptr %5, align 8
    #dbg_declare(ptr %ds.dbg.spill, !254, !DIExpression(), !281)
  store ptr %da.0, ptr %da.dbg.spill, align 8
  %6 = getelementptr inbounds i8, ptr %da.dbg.spill, i64 8
  store ptr %da.1, ptr %6, align 8
    #dbg_declare(ptr %da.dbg.spill, !255, !DIExpression(), !282)
  %7 = zext i1 %e to i8
  store i8 %7, ptr %e.dbg.spill, align 1
    #dbg_declare(ptr %e.dbg.spill, !256, !DIExpression(), !283)
  store i32 %o.0, ptr %o.dbg.spill, align 4
  %8 = getelementptr inbounds i8, ptr %o.dbg.spill, i64 4
  store i32 %o.1, ptr %8, align 4
    #dbg_declare(ptr %o.dbg.spill, !257, !DIExpression(), !284)
    #dbg_declare(ptr %_13.dbg.spill, !268, !DIExpression(), !285)
  store ptr %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !259, !DIExpression(), !286)
  store ptr %fu, ptr %fu.dbg.spill, align 8
    #dbg_declare(ptr %fu.dbg.spill, !260, !DIExpression(), !287)
    #dbg_declare(ptr %arr, !261, !DIExpression(), !288)
  store ptr %sl.0, ptr %sl.dbg.spill, align 8
  %9 = getelementptr inbounds i8, ptr %sl.dbg.spill, i64 8
  store i64 %sl.1, ptr %9, align 8
    #dbg_declare(ptr %sl.dbg.spill, !262, !DIExpression(), !289)
  store ptr %s.0, ptr %s.dbg.spill, align 8
  %10 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i64 %s.1, ptr %10, align 8
    #dbg_declare(ptr %s.dbg.spill, !263, !DIExpression(), !290)
    #dbg_declare(ptr %_19.dbg.spill, !269, !DIExpression(), !291)
    #dbg_declare(ptr %_20.dbg.spill, !270, !DIExpression(), !292)
    #dbg_declare(ptr %_21.dbg.spill, !271, !DIExpression(), !293)
    #dbg_declare(ptr %unit.dbg.spill, !249, !DIExpression(), !276)
    #dbg_declare(ptr %i.dbg.spill, !258, !DIExpression(), !285)
    #dbg_declare(ptr %cu.dbg.spill, !264, !DIExpression(), !291)
    #dbg_declare(ptr %ci.dbg.spill, !265, !DIExpression(), !292)
    #dbg_declare(ptr %cb.dbg.spill, !266, !DIExpression(), !293)
  ret void, !dbg !294
}

; Function Attrs: nonlazybind uwtable
define i32 @unnamed(i32 %_1, i32 %y) unnamed_addr #0 !dbg !295 !guid !301 {
start:
  %y.dbg.spill = alloca [4 x i8], align 4
  %_1.dbg.spill = alloca [4 x i8], align 4
  store i32 %_1, ptr %_1.dbg.spill, align 4
    #dbg_declare(ptr %_1.dbg.spill, !300, !DIExpression(), !302)
  store i32 %y, ptr %y.dbg.spill, align 4
    #dbg_declare(ptr %y.dbg.spill, !299, !DIExpression(), !303)
  ret i32 %y, !dbg !304
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #1

attributes #0 = { nonlazybind uwtable "probe-stack"="inline-asm" "target-cpu"="x86-64" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }

!llvm.module.flags = !{!0, !1, !2, !3, !4}
!llvm.ident = !{!5}
!llvm.dbg.cu = !{!6}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 2, !"RtLibUseGOT", i32 1}
!2 = !{i32 7, !"uwtable", i32 2}
!3 = !{i32 7, !"Dwarf Version", i32 4}
!4 = !{i32 2, !"Debug Info Version", i32 3}
!5 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!6 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !7, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, enums: !8, splitDebugInlining: false, nameTableKind: None)
!7 = !DIFile(filename: "debuginfo.rs/@/debuginfo.5788dedd18320a49-cgu.0", directory: ".")
!8 = !{!9}
!9 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "CLike", scope: !11, file: !10, baseType: !12, size: 8, align: 8, flags: DIFlagEnumClass, elements: !13)
!10 = !DIFile(filename: "<unknown>", directory: "")
!11 = !DINamespace(name: "debuginfo", scope: null)
!12 = !DIBasicType(name: "u8", size: 8, encoding: DW_ATE_unsigned)
!13 = !{!14, !15}
!14 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!15 = !DIEnumerator(name: "B", value: 1, isUnsigned: true)
!16 = distinct !DISubprogram(name: "neg", linkageName: "_RNvXsc_Cs7vWAa3jVger_9debuginfoaNtB5_3Neg3neg", scope: !18, file: !17, line: 50, type: !19, scopeLine: 50, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !22)
!17 = !DIFile(filename: "debuginfo.rs", directory: ".", checksumkind: CSK_MD5, checksum: "95de9b73243641da01738a06e2708472")
!18 = !DINamespace(name: "{impl#14}", scope: !11)
!19 = !DISubroutineType(types: !20)
!20 = !{!21, !21}
!21 = !DIBasicType(name: "i8", size: 8, encoding: DW_ATE_signed)
!22 = !{!23}
!23 = !DILocalVariable(name: "self", arg: 1, scope: !16, file: !17, line: 50, type: !21)
!24 = !{}
!25 = !{i64 4870345733078936707}
!26 = !DILocation(line: 50, column: 12, scope: !16)
!27 = !DILocation(line: 51, column: 9, scope: !16)
!28 = distinct !DISubprogram(name: "big", scope: !11, file: !17, line: 133, type: !29, scopeLine: 133, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !37)
!29 = !DISubroutineType(types: !30)
!30 = !{!31, !32}
!31 = !DIBasicType(name: "u64", size: 64, encoding: DW_ATE_unsigned)
!32 = !DICompositeType(tag: DW_TAG_structure_type, name: "Big", scope: !11, file: !10, size: 192, align: 64, flags: DIFlagPublic, elements: !33, templateParams: !24, identifier: "37e2125ca698e5c881fb8802bd277522")
!33 = !{!34, !35, !36}
!34 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !32, file: !10, baseType: !31, size: 64, align: 64, flags: DIFlagPrivate)
!35 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !32, file: !10, baseType: !31, size: 64, align: 64, offset: 64, flags: DIFlagPrivate)
!36 = !DIDerivedType(tag: DW_TAG_member, name: "c", scope: !32, file: !10, baseType: !31, size: 64, align: 64, offset: 128, flags: DIFlagPrivate)
!37 = !{!38}
!38 = !DILocalVariable(name: "b", arg: 1, scope: !28, file: !17, line: 133, type: !32)
!39 = !{i64 5515620527165104600}
!40 = !DILocation(line: 133, column: 12, scope: !28)
!41 = !DILocation(line: 134, column: 5, scope: !28)
!42 = !DILocation(line: 135, column: 2, scope: !28)
!43 = distinct !DISubprogram(name: "borrowed", scope: !11, file: !17, line: 137, type: !44, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !47)
!44 = !DISubroutineType(types: !45)
!45 = !{!46, !46}
!46 = !DIBasicType(name: "u32", size: 32, encoding: DW_ATE_unsigned)
!47 = !{!48, !49}
!48 = !DILocalVariable(name: "x", arg: 1, scope: !43, file: !17, line: 137, type: !46)
!49 = !DILocalVariable(name: "r", scope: !50, file: !17, line: 138, type: !51, align: 64)
!50 = distinct !DILexicalBlock(scope: !43, file: !17, line: 138, column: 5)
!51 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&u32", baseType: !46, size: 64, align: 64, dwarfAddressSpace: 0)
!52 = !{i64 -8233072348051919563}
!53 = !DILocation(line: 137, column: 17, scope: !43)
!54 = !DILocation(line: 138, column: 13, scope: !43)
!55 = !DILocation(line: 138, column: 9, scope: !50)
!56 = !DILocation(line: 139, column: 5, scope: !50)
!57 = !DILocation(line: 140, column: 2, scope: !43)
!58 = distinct !DISubprogram(name: "closure", scope: !11, file: !17, line: 177, type: !59, scopeLine: 177, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !61)
!59 = !DISubroutineType(types: !60)
!60 = !{null, !46}
!61 = !{!62, !63, !67}
!62 = !DILocalVariable(name: "x", arg: 1, scope: !58, file: !17, line: 177, type: !46)
!63 = !DILocalVariable(name: "c", scope: !64, file: !17, line: 178, type: !65, align: 8)
!64 = distinct !DILexicalBlock(scope: !58, file: !17, line: 178, column: 5)
!65 = !DICompositeType(tag: DW_TAG_structure_type, name: "{closure_env#0}", scope: !66, file: !10, align: 8, elements: !24, identifier: "21e455953c3f5e0b6a37ba0a6bd366")
!66 = !DINamespace(name: "closure", scope: !11)
!67 = !DILocalVariable(name: "rc", scope: !68, file: !17, line: 179, type: !69, align: 64)
!68 = distinct !DILexicalBlock(scope: !64, file: !17, line: 179, column: 5)
!69 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&debuginfo::closure::{closure_env#0}", baseType: !65, size: 64, align: 64, dwarfAddressSpace: 0)
!70 = !{i64 -8001930764763462056}
!71 = !DILocation(line: 177, column: 16, scope: !58)
!72 = !DILocation(line: 178, column: 9, scope: !64)
!73 = !DILocation(line: 179, column: 14, scope: !64)
!74 = !DILocation(line: 179, column: 9, scope: !68)
!75 = !DILocation(line: 180, column: 2, scope: !58)
!76 = distinct !DISubprogram(name: "locals", scope: !11, file: !17, line: 146, type: !44, scopeLine: 146, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !77)
!77 = !{!78, !79, !81}
!78 = !DILocalVariable(name: "x", arg: 1, scope: !76, file: !17, line: 146, type: !46)
!79 = !DILocalVariable(name: "a", scope: !80, file: !17, line: 147, type: !46, align: 32)
!80 = distinct !DILexicalBlock(scope: !76, file: !17, line: 147, column: 5)
!81 = !DILocalVariable(name: "b", scope: !82, file: !17, line: 148, type: !46, align: 32)
!82 = distinct !DILexicalBlock(scope: !80, file: !17, line: 148, column: 5)
!83 = !{i64 5053764491818238053}
!84 = !DILocation(line: 146, column: 15, scope: !76)
!85 = !DILocation(line: 147, column: 9, scope: !80)
!86 = !DILocation(line: 148, column: 9, scope: !82)
!87 = !DILocation(line: 150, column: 2, scope: !76)
!88 = distinct !DISubprogram(name: "pair", scope: !11, file: !17, line: 129, type: !89, scopeLine: 129, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !95)
!89 = !DISubroutineType(types: !90)
!90 = !{!46, !91}
!91 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair", scope: !11, file: !10, size: 64, align: 32, flags: DIFlagPublic, elements: !92, templateParams: !24, identifier: "619840ec75ba6bc097ef00bb986322ab")
!92 = !{!93, !94}
!93 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !91, file: !10, baseType: !46, size: 32, align: 32, flags: DIFlagPrivate)
!94 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !91, file: !10, baseType: !46, size: 32, align: 32, offset: 32, flags: DIFlagPrivate)
!95 = !{!96}
!96 = !DILocalVariable(name: "p", arg: 1, scope: !88, file: !17, line: 129, type: !91)
!97 = !{i64 4859215404959254835}
!98 = !DILocation(line: 129, column: 13, scope: !88)
!99 = !DILocation(line: 131, column: 2, scope: !88)
!100 = distinct !DISubprogram(name: "pair_by_value", scope: !91, file: !17, line: 113, type: !89, scopeLine: 113, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, declaration: !101, retainedNodes: !102)
!101 = !DISubprogram(name: "pair_by_value", scope: !91, file: !17, line: 113, type: !89, scopeLine: 113, flags: DIFlagPrototyped, spFlags: 0, templateParams: !24)
!102 = !{!103}
!103 = !DILocalVariable(name: "self", arg: 1, scope: !100, file: !17, line: 113, type: !91)
!104 = !{i64 3613341350573506715}
!105 = !DILocation(line: 113, column: 26, scope: !100)
!106 = !DILocation(line: 115, column: 6, scope: !100)
!107 = distinct !DISubprogram(name: "pair_closure", scope: !91, file: !17, line: 117, type: !108, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, declaration: !111, retainedNodes: !112)
!108 = !DISubroutineType(types: !109)
!109 = !{null, !110}
!110 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&debuginfo::Pair", baseType: !91, size: 64, align: 64, dwarfAddressSpace: 0)
!111 = !DISubprogram(name: "pair_closure", scope: !91, file: !17, line: 117, type: !108, scopeLine: 117, flags: DIFlagPrototyped, spFlags: 0, templateParams: !24)
!112 = !{!113, !114, !119, !126}
!113 = !DILocalVariable(name: "self", arg: 1, scope: !107, file: !17, line: 117, type: !110)
!114 = !DILocalVariable(name: "c", scope: !115, file: !17, line: 118, type: !116, align: 8)
!115 = distinct !DILexicalBlock(scope: !107, file: !17, line: 118, column: 9)
!116 = !DICompositeType(tag: DW_TAG_structure_type, name: "{closure_env#0}", scope: !117, file: !10, align: 8, elements: !24, identifier: "9ec8487219eae5abbcbb070c15d30788")
!117 = !DINamespace(name: "pair_closure", scope: !118)
!118 = !DINamespace(name: "{impl#15}", scope: !11)
!119 = !DILocalVariable(name: "w", scope: !120, file: !17, line: 119, type: !121, align: 8)
!120 = distinct !DILexicalBlock(scope: !115, file: !17, line: 119, column: 9)
!121 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<debuginfo::{impl#15}::pair_closure::{closure_env#0}>", scope: !11, file: !10, align: 8, flags: DIFlagPublic, elements: !122, templateParams: !124, identifier: "35225745ea04af5381cef16a77333aaf")
!122 = !{!123}
!123 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !121, file: !10, baseType: !116, align: 8, flags: DIFlagPrivate)
!124 = !{!125}
!125 = !DITemplateTypeParameter(name: "T", type: !116)
!126 = !DILocalVariable(name: "rw", scope: !127, file: !17, line: 120, type: !128, align: 64)
!127 = distinct !DILexicalBlock(scope: !120, file: !17, line: 120, column: 9)
!128 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&debuginfo::Wrap<debuginfo::{impl#15}::pair_closure::{closure_env#0}>", baseType: !121, size: 64, align: 64, dwarfAddressSpace: 0)
!129 = !{i64 -4772090666375877613}
!130 = !DILocation(line: 117, column: 25, scope: !107)
!131 = !DILocation(line: 118, column: 13, scope: !115)
!132 = !DILocation(line: 119, column: 13, scope: !120)
!133 = !DILocation(line: 120, column: 18, scope: !120)
!134 = !DILocation(line: 120, column: 13, scope: !127)
!135 = !DILocation(line: 121, column: 6, scope: !107)
!136 = distinct !DISubprogram(name: "pair_first", scope: !91, file: !17, line: 109, type: !137, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, declaration: !139, retainedNodes: !140)
!137 = !DISubroutineType(types: !138)
!138 = !{!46, !110}
!139 = !DISubprogram(name: "pair_first", scope: !91, file: !17, line: 109, type: !137, scopeLine: 109, flags: DIFlagPrototyped, spFlags: 0, templateParams: !24)
!140 = !{!141}
!141 = !DILocalVariable(name: "self", arg: 1, scope: !136, file: !17, line: 109, type: !110)
!142 = !{i64 -4966468779482704476}
!143 = !DILocation(line: 109, column: 23, scope: !136)
!144 = !DILocation(line: 110, column: 9, scope: !136)
!145 = !DILocation(line: 111, column: 6, scope: !136)
!146 = distinct !DISubprogram(name: "scalar", scope: !11, file: !17, line: 125, type: !44, scopeLine: 125, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !147)
!147 = !{!148}
!148 = !DILocalVariable(name: "x", arg: 1, scope: !146, file: !17, line: 125, type: !46)
!149 = !{i64 -4572029188287661406}
!150 = !DILocation(line: 125, column: 15, scope: !146)
!151 = !DILocation(line: 127, column: 2, scope: !146)
!152 = distinct !DISubprogram(name: "types", scope: !11, file: !17, line: 152, type: !153, scopeLine: 152, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !245)
!153 = !DISubroutineType(types: !154)
!154 = !{null, !155, !160, !171, !176, !177, !178, !179, !180, !191, !197, !9, !207, !218, !220, !223, !226, !232, !237, !242, !243, !244}
!155 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<u32>", scope: !11, file: !10, size: 32, align: 32, flags: DIFlagPublic, elements: !156, templateParams: !158, identifier: "5cf88beabc502caf9f99c6dcba2e86")
!156 = !{!157}
!157 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !155, file: !10, baseType: !46, size: 32, align: 32, flags: DIFlagPrivate)
!158 = !{!159}
!159 = !DITemplateTypeParameter(name: "T", type: !46)
!160 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&debuginfo::Wrap<debuginfo::Wrap<u8>>", baseType: !161, size: 64, align: 64, dwarfAddressSpace: 0)
!161 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<debuginfo::Wrap<u8>>", scope: !11, file: !10, size: 8, align: 8, flags: DIFlagPublic, elements: !162, templateParams: !169, identifier: "2bb44967ac89d72e23c403eb1dcba09d")
!162 = !{!163}
!163 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !161, file: !10, baseType: !164, size: 8, align: 8, flags: DIFlagPrivate)
!164 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<u8>", scope: !11, file: !10, size: 8, align: 8, flags: DIFlagPublic, elements: !165, templateParams: !167, identifier: "bd32df9605987d80afe5683cb7d15052")
!165 = !{!166}
!166 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !164, file: !10, baseType: !12, size: 8, align: 8, flags: DIFlagPrivate)
!167 = !{!168}
!168 = !DITemplateTypeParameter(name: "T", type: !12)
!169 = !{!170}
!170 = !DITemplateTypeParameter(name: "T", type: !164)
!171 = !DICompositeType(tag: DW_TAG_structure_type, name: "(u32, bool)", file: !10, size: 64, align: 32, elements: !172, templateParams: !24, identifier: "207aae7b51c398d54b045bc76bc3c2be")
!172 = !{!173, !174}
!173 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !171, file: !10, baseType: !46, size: 32, align: 32)
!174 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !171, file: !10, baseType: !175, size: 8, align: 8, offset: 32)
!175 = !DIBasicType(name: "bool", size: 8, encoding: DW_ATE_boolean)
!176 = !DIBasicType(name: "()", encoding: DW_ATE_unsigned)
!177 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&mut u64", baseType: !31, size: 64, align: 64, dwarfAddressSpace: 0)
!178 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*const u8", baseType: !12, size: 64, align: 64, dwarfAddressSpace: 0)
!179 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "*mut debuginfo::Wrap<u8>", baseType: !164, size: 64, align: 64, dwarfAddressSpace: 0)
!180 = !DICompositeType(tag: DW_TAG_structure_type, name: "&dyn debuginfo::Tr", file: !10, size: 128, align: 64, elements: !181, templateParams: !24, identifier: "28c395c7e9d843c4604ec067c6789318")
!181 = !{!182, !185}
!182 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !180, file: !10, baseType: !183, size: 64, align: 64)
!183 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !184, size: 64, align: 64, dwarfAddressSpace: 0)
!184 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn debuginfo::Tr", file: !10, align: 8, elements: !24, identifier: "307bb90f8a0c719eaa198edcdee71ff")
!185 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !180, file: !10, baseType: !186, size: 64, align: 64, offset: 64)
!186 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&[usize; 4]", baseType: !187, size: 64, align: 64, dwarfAddressSpace: 0)
!187 = !DICompositeType(tag: DW_TAG_array_type, baseType: !188, size: 256, align: 64, elements: !189)
!188 = !DIBasicType(name: "usize", size: 64, encoding: DW_ATE_unsigned)
!189 = !{!190}
!190 = !DISubrange(count: 4, lowerBound: 0)
!191 = !DICompositeType(tag: DW_TAG_structure_type, name: "&(dyn debuginfo::Tr + debuginfo::Send)", file: !10, size: 128, align: 64, elements: !192, templateParams: !24, identifier: "9c92c81a87ec464b5048c36d28367bfd")
!192 = !{!193, !196}
!193 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !191, file: !10, baseType: !194, size: 64, align: 64)
!194 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !195, size: 64, align: 64, dwarfAddressSpace: 0)
!195 = !DICompositeType(tag: DW_TAG_structure_type, name: "(dyn debuginfo::Tr + debuginfo::Send)", file: !10, align: 8, elements: !24, identifier: "2ac9d50e679ff94772370e458dffa9da")
!196 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !191, file: !10, baseType: !186, size: 64, align: 64, offset: 64)
!197 = !DICompositeType(tag: DW_TAG_structure_type, name: "&dyn debuginfo::WithAssoc<Out=u32>", file: !10, size: 128, align: 64, elements: !198, templateParams: !24, identifier: "456844d327a4de0a15a4b0b7d602bf08")
!198 = !{!199, !202}
!199 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !197, file: !10, baseType: !200, size: 64, align: 64)
!200 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !201, size: 64, align: 64, dwarfAddressSpace: 0)
!201 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn debuginfo::WithAssoc<Out=u32>", file: !10, align: 8, elements: !24, identifier: "1397c5d324c07541c171d7a36d504b41")
!202 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !197, file: !10, baseType: !203, size: 64, align: 64, offset: 64)
!203 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "&[usize; 3]", baseType: !204, size: 64, align: 64, dwarfAddressSpace: 0)
!204 = !DICompositeType(tag: DW_TAG_array_type, baseType: !188, size: 192, align: 64, elements: !205)
!205 = !{!206}
!206 = !DISubrange(count: 3, lowerBound: 0)
!207 = !DICompositeType(tag: DW_TAG_structure_type, name: "Opt<u32>", scope: !11, file: !10, size: 64, align: 32, flags: DIFlagPublic, elements: !208, templateParams: !24, identifier: "ed88661fd6391fd93123da87d9a8558")
!208 = !{!209}
!209 = !DICompositeType(tag: DW_TAG_variant_part, scope: !207, file: !10, size: 64, align: 32, elements: !210, templateParams: !24, identifier: "5db891fae21a1bc4d1f64843733d16b5", discriminator: !217)
!210 = !{!211, !213}
!211 = !DIDerivedType(tag: DW_TAG_member, name: "None", scope: !209, file: !10, baseType: !212, size: 64, align: 32, extraData: i32 0)
!212 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !207, file: !10, size: 64, align: 32, flags: DIFlagPublic, elements: !24, templateParams: !158, identifier: "dcc0271df181ed276dc73f476cc28325")
!213 = !DIDerivedType(tag: DW_TAG_member, name: "Some", scope: !209, file: !10, baseType: !214, size: 64, align: 32, extraData: i32 1)
!214 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !207, file: !10, size: 64, align: 32, flags: DIFlagPublic, elements: !215, templateParams: !158, identifier: "164fdc60143f3dc897e950da2265e14")
!215 = !{!216}
!216 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !214, file: !10, baseType: !46, size: 32, align: 32, offset: 32, flags: DIFlagPublic)
!217 = !DIDerivedType(tag: DW_TAG_member, scope: !207, file: !10, baseType: !46, size: 32, align: 32, flags: DIFlagArtificial)
!218 = !DICompositeType(tag: DW_TAG_structure_type, name: "In", scope: !219, file: !10, align: 8, flags: DIFlagPublic, elements: !24, identifier: "5d31365491354d1ca99ee6142773e93c")
!219 = !DINamespace(name: "inner", scope: !11)
!220 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "fn(u32) -> bool", baseType: !221, size: 64, align: 64, dwarfAddressSpace: 0)
!221 = !DISubroutineType(types: !222)
!222 = !{!175, !46}
!223 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "unsafe extern \22C\22 fn()", baseType: !224, size: 64, align: 64, dwarfAddressSpace: 0)
!224 = !DISubroutineType(types: !225)
!225 = !{null}
!226 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<[u8; 4]>", scope: !11, file: !10, size: 32, align: 8, flags: DIFlagPublic, elements: !227, templateParams: !230, identifier: "ddce30512c7cdaf65241cfdccba08b4b")
!227 = !{!228}
!228 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !226, file: !10, baseType: !229, size: 32, align: 8, flags: DIFlagPrivate)
!229 = !DICompositeType(tag: DW_TAG_array_type, baseType: !12, size: 32, align: 8, elements: !189)
!230 = !{!231}
!231 = !DITemplateTypeParameter(name: "T", type: !229)
!232 = !DICompositeType(tag: DW_TAG_structure_type, name: "&[u32]", file: !10, size: 128, align: 64, elements: !233, templateParams: !24, identifier: "d88c96c0440e14893a8ceae32ae0ce5")
!233 = !{!234, !236}
!234 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !232, file: !10, baseType: !235, size: 64, align: 64)
!235 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !46, size: 64, align: 64, dwarfAddressSpace: 0)
!236 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !232, file: !10, baseType: !188, size: 64, align: 64, offset: 64)
!237 = !DICompositeType(tag: DW_TAG_structure_type, name: "&str", file: !10, size: 128, align: 64, elements: !238, templateParams: !24, identifier: "6fc9dd7daffb1f73292744aea0793200")
!238 = !{!239, !241}
!239 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !237, file: !10, baseType: !240, size: 64, align: 64)
!240 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !12, size: 64, align: 64, dwarfAddressSpace: 0)
!241 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !237, file: !10, baseType: !188, size: 64, align: 64, offset: 64)
!242 = !DICompositeType(tag: DW_TAG_structure_type, name: "ConstU<4>", scope: !11, file: !10, align: 8, flags: DIFlagPublic, elements: !24, identifier: "360cbb4772f52ea4242076d3b548fa44")
!243 = !DICompositeType(tag: DW_TAG_structure_type, name: "ConstI<-3>", scope: !11, file: !10, align: 8, flags: DIFlagPublic, elements: !24, identifier: "fab23dbd16561e7e18f27ebe184c9658")
!244 = !DICompositeType(tag: DW_TAG_structure_type, name: "ConstB<true>", scope: !11, file: !10, align: 8, flags: DIFlagPublic, elements: !24, identifier: "83251cd4e1c115708795c56acff74d0e")
!245 = !{!246, !247, !248, !249, !250, !251, !252, !253, !254, !255, !256, !257, !258, !259, !260, !261, !262, !263, !264, !265, !266, !267, !268, !269, !270, !271}
!246 = !DILocalVariable(name: "w", arg: 1, scope: !152, file: !17, line: 153, type: !155)
!247 = !DILocalVariable(name: "ww", arg: 2, scope: !152, file: !17, line: 154, type: !160)
!248 = !DILocalVariable(name: "t", arg: 3, scope: !152, file: !17, line: 155, type: !171)
!249 = !DILocalVariable(name: "unit", scope: !152, file: !17, line: 156, type: !176, align: 8)
!250 = !DILocalVariable(name: "r", arg: 5, scope: !152, file: !17, line: 157, type: !177)
!251 = !DILocalVariable(name: "p", arg: 6, scope: !152, file: !17, line: 158, type: !178)
!252 = !DILocalVariable(name: "m", arg: 7, scope: !152, file: !17, line: 159, type: !179)
!253 = !DILocalVariable(name: "d", arg: 8, scope: !152, file: !17, line: 160, type: !180)
!254 = !DILocalVariable(name: "ds", arg: 9, scope: !152, file: !17, line: 161, type: !191)
!255 = !DILocalVariable(name: "da", arg: 10, scope: !152, file: !17, line: 162, type: !197)
!256 = !DILocalVariable(name: "e", arg: 11, scope: !152, file: !17, line: 163, type: !9)
!257 = !DILocalVariable(name: "o", arg: 12, scope: !152, file: !17, line: 164, type: !207)
!258 = !DILocalVariable(name: "i", scope: !152, file: !17, line: 165, type: !218, align: 8)
!259 = !DILocalVariable(name: "f", arg: 14, scope: !152, file: !17, line: 166, type: !220)
!260 = !DILocalVariable(name: "fu", arg: 15, scope: !152, file: !17, line: 167, type: !223)
!261 = !DILocalVariable(name: "arr", arg: 16, scope: !152, file: !17, line: 168, type: !226)
!262 = !DILocalVariable(name: "sl", arg: 17, scope: !152, file: !17, line: 169, type: !232)
!263 = !DILocalVariable(name: "s", arg: 18, scope: !152, file: !17, line: 170, type: !237)
!264 = !DILocalVariable(name: "cu", scope: !152, file: !17, line: 171, type: !242, align: 8)
!265 = !DILocalVariable(name: "ci", scope: !152, file: !17, line: 172, type: !243, align: 8)
!266 = !DILocalVariable(name: "cb", scope: !152, file: !17, line: 173, type: !244, align: 8)
!267 = !DILocalVariable(arg: 4, scope: !152, file: !17, line: 156, type: !176)
!268 = !DILocalVariable(arg: 13, scope: !152, file: !17, line: 165, type: !218)
!269 = !DILocalVariable(arg: 19, scope: !152, file: !17, line: 171, type: !242)
!270 = !DILocalVariable(arg: 20, scope: !152, file: !17, line: 172, type: !243)
!271 = !DILocalVariable(arg: 21, scope: !152, file: !17, line: 173, type: !244)
!272 = !{i64 -1154744837904250159}
!273 = !DILocation(line: 153, column: 5, scope: !152)
!274 = !DILocation(line: 154, column: 5, scope: !152)
!275 = !DILocation(line: 155, column: 5, scope: !152)
!276 = !DILocation(line: 156, column: 5, scope: !152)
!277 = !DILocation(line: 157, column: 5, scope: !152)
!278 = !DILocation(line: 158, column: 5, scope: !152)
!279 = !DILocation(line: 159, column: 5, scope: !152)
!280 = !DILocation(line: 160, column: 5, scope: !152)
!281 = !DILocation(line: 161, column: 5, scope: !152)
!282 = !DILocation(line: 162, column: 5, scope: !152)
!283 = !DILocation(line: 163, column: 5, scope: !152)
!284 = !DILocation(line: 164, column: 5, scope: !152)
!285 = !DILocation(line: 165, column: 5, scope: !152)
!286 = !DILocation(line: 166, column: 5, scope: !152)
!287 = !DILocation(line: 167, column: 5, scope: !152)
!288 = !DILocation(line: 168, column: 5, scope: !152)
!289 = !DILocation(line: 169, column: 5, scope: !152)
!290 = !DILocation(line: 170, column: 5, scope: !152)
!291 = !DILocation(line: 171, column: 5, scope: !152)
!292 = !DILocation(line: 172, column: 5, scope: !152)
!293 = !DILocation(line: 173, column: 5, scope: !152)
!294 = !DILocation(line: 175, column: 2, scope: !152)
!295 = distinct !DISubprogram(name: "unnamed", scope: !11, file: !17, line: 142, type: !296, scopeLine: 142, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !6, templateParams: !24, retainedNodes: !298)
!296 = !DISubroutineType(types: !297)
!297 = !{!46, !46, !46}
!298 = !{!299, !300}
!299 = !DILocalVariable(name: "y", arg: 2, scope: !295, file: !17, line: 142, type: !46)
!300 = !DILocalVariable(arg: 1, scope: !295, file: !17, line: 142, type: !46)
!301 = !{i64 1291262018994763082}
!302 = !DILocation(line: 142, column: 16, scope: !295)
!303 = !DILocation(line: 142, column: 24, scope: !295)
!304 = !DILocation(line: 144, column: 2, scope: !295)
