; ModuleID = 'debuginfo.5788dedd18320a49-cgu.0'
source_filename = "debuginfo.5788dedd18320a49-cgu.0"
target datalayout = "e-m:w-p270:32:32-p271:32:32-p272:64:64-i64:64-i128:128-f80:128-n8:16:32:64-S128"
target triple = "x86_64-pc-windows-msvc"

; <i8 as debuginfo::Neg>::neg
; Function Attrs: uwtable
define i8 @_RNvXsc_Cs7vWAa3jVger_9debuginfoaNtB5_3Neg3neg(i8 %self) unnamed_addr #0 !dbg !48 !guid !57 {
start:
  %self.dbg.spill = alloca [1 x i8], align 1
  store i8 %self, ptr %self.dbg.spill, align 1
    #dbg_declare(ptr %self.dbg.spill, !56, !DIExpression(), !58)
  br label %bb1, !dbg !59

bb1:                                              ; preds = %bb1, %start
  br label %bb1, !dbg !59
}

; Function Attrs: uwtable
define i64 @big(ptr align 8 %b) unnamed_addr #0 !dbg !60 !guid !70 {
start:
    #dbg_declare(ptr %b, !69, !DIExpression(), !71)
  %0 = getelementptr inbounds i8, ptr %b, i64 16, !dbg !72
  %_0 = load i64, ptr %0, align 8, !dbg !72
  ret i64 %_0, !dbg !73
}

; Function Attrs: uwtable
define i32 @borrowed(i32 %0) unnamed_addr #0 !dbg !74 !guid !82 {
start:
  %r.dbg.spill = alloca [8 x i8], align 8
  %x = alloca [4 x i8], align 4
  store i32 %0, ptr %x, align 4
    #dbg_declare(ptr %x, !78, !DIExpression(), !83)
  store ptr %x, ptr %r.dbg.spill, align 8, !dbg !84
    #dbg_declare(ptr %r.dbg.spill, !79, !DIExpression(), !85)
  %_0 = load i32, ptr %x, align 4, !dbg !86
  ret i32 %_0, !dbg !87
}

; Function Attrs: uwtable
define void @closure(i32 %x) unnamed_addr #0 !dbg !88 !guid !100 {
start:
  %rc.dbg.spill = alloca [8 x i8], align 8
  %c.dbg.spill = alloca [0 x i8], align 1
  %x.dbg.spill = alloca [4 x i8], align 4
  %_2 = alloca [0 x i8], align 1
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !92, !DIExpression(), !101)
    #dbg_declare(ptr %c.dbg.spill, !93, !DIExpression(), !102)
  store ptr %_2, ptr %rc.dbg.spill, align 8, !dbg !103
    #dbg_declare(ptr %rc.dbg.spill, !97, !DIExpression(), !104)
  ret void, !dbg !105
}

; Function Attrs: uwtable
define i32 @locals(i32 %x) unnamed_addr #0 !dbg !106 !guid !113 {
start:
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !108, !DIExpression(), !114)
    #dbg_declare(ptr %x.dbg.spill, !109, !DIExpression(), !115)
    #dbg_declare(ptr %x.dbg.spill, !111, !DIExpression(), !116)
  ret i32 %x, !dbg !117
}

; Function Attrs: uwtable
define i32 @pair(i32 %p.0, i32 %p.1) unnamed_addr #0 !dbg !118 !guid !127 {
start:
  %p.dbg.spill = alloca [8 x i8], align 4
  store i32 %p.0, ptr %p.dbg.spill, align 4
  %0 = getelementptr inbounds i8, ptr %p.dbg.spill, i64 4
  store i32 %p.1, ptr %0, align 4
    #dbg_declare(ptr %p.dbg.spill, !126, !DIExpression(), !128)
  ret i32 %p.1, !dbg !129
}

; Function Attrs: uwtable
define i32 @pair_by_value(i32 %self.0, i32 %self.1) unnamed_addr #0 !dbg !130 !guid !134 {
start:
  %self.dbg.spill = alloca [8 x i8], align 4
  store i32 %self.0, ptr %self.dbg.spill, align 4
  %0 = getelementptr inbounds i8, ptr %self.dbg.spill, i64 4
  store i32 %self.1, ptr %0, align 4
    #dbg_declare(ptr %self.dbg.spill, !133, !DIExpression(), !135)
  ret i32 %self.1, !dbg !136
}

; Function Attrs: uwtable
define void @pair_closure(ptr align 4 %self) unnamed_addr #0 !dbg !137 !guid !159 {
start:
  %rw.dbg.spill = alloca [8 x i8], align 8
  %w.dbg.spill = alloca [0 x i8], align 1
  %c.dbg.spill = alloca [0 x i8], align 1
  %self.dbg.spill = alloca [8 x i8], align 8
  %_2 = alloca [0 x i8], align 1
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !143, !DIExpression(), !160)
    #dbg_declare(ptr %c.dbg.spill, !144, !DIExpression(), !161)
    #dbg_declare(ptr %w.dbg.spill, !149, !DIExpression(), !162)
  store ptr %_2, ptr %rw.dbg.spill, align 8, !dbg !163
    #dbg_declare(ptr %rw.dbg.spill, !156, !DIExpression(), !164)
  ret void, !dbg !165
}

; Function Attrs: uwtable
define i32 @pair_first(ptr align 4 %self) unnamed_addr #0 !dbg !166 !guid !172 {
start:
  %self.dbg.spill = alloca [8 x i8], align 8
  store ptr %self, ptr %self.dbg.spill, align 8
    #dbg_declare(ptr %self.dbg.spill, !171, !DIExpression(), !173)
  %_0 = load i32, ptr %self, align 4, !dbg !174
  ret i32 %_0, !dbg !175
}

; Function Attrs: uwtable
define i32 @scalar(i32 %x) unnamed_addr #0 !dbg !176 !guid !179 {
start:
  %x.dbg.spill = alloca [4 x i8], align 4
  store i32 %x, ptr %x.dbg.spill, align 4
    #dbg_declare(ptr %x.dbg.spill, !178, !DIExpression(), !180)
  ret i32 %x, !dbg !181
}

; Function Attrs: uwtable
define void @types(i32 %w, ptr %ww, i32 %t.0, i1 zeroext %t.1, ptr align 8 %r, ptr %p, ptr %m, ptr %d.0, ptr align 8 %d.1, ptr %ds.0, ptr align 8 %ds.1, ptr %da.0, ptr align 8 %da.1, i1 zeroext %e, i32 %o.0, i32 %o.1, ptr %f, ptr %fu, i32 %0, ptr align 4 %sl.0, i64 %sl.1, ptr %s.0, i64 %s.1) unnamed_addr #0 !dbg !182 !guid !290 {
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
    #dbg_declare(ptr %w.dbg.spill, !264, !DIExpression(), !291)
  store ptr %ww, ptr %ww.dbg.spill, align 8
    #dbg_declare(ptr %ww.dbg.spill, !265, !DIExpression(), !292)
  store i32 %t.0, ptr %t.dbg.spill, align 4
  %2 = getelementptr inbounds i8, ptr %t.dbg.spill, i64 4
  %3 = zext i1 %t.1 to i8
  store i8 %3, ptr %2, align 4
    #dbg_declare(ptr %t.dbg.spill, !266, !DIExpression(), !293)
    #dbg_declare(ptr %_4.dbg.spill, !285, !DIExpression(), !294)
  store ptr %r, ptr %r.dbg.spill, align 8
    #dbg_declare(ptr %r.dbg.spill, !268, !DIExpression(), !295)
  store ptr %p, ptr %p.dbg.spill, align 8
    #dbg_declare(ptr %p.dbg.spill, !269, !DIExpression(), !296)
  store ptr %m, ptr %m.dbg.spill, align 8
    #dbg_declare(ptr %m.dbg.spill, !270, !DIExpression(), !297)
  store ptr %d.0, ptr %d.dbg.spill, align 8
  %4 = getelementptr inbounds i8, ptr %d.dbg.spill, i64 8
  store ptr %d.1, ptr %4, align 8
    #dbg_declare(ptr %d.dbg.spill, !271, !DIExpression(), !298)
  store ptr %ds.0, ptr %ds.dbg.spill, align 8
  %5 = getelementptr inbounds i8, ptr %ds.dbg.spill, i64 8
  store ptr %ds.1, ptr %5, align 8
    #dbg_declare(ptr %ds.dbg.spill, !272, !DIExpression(), !299)
  store ptr %da.0, ptr %da.dbg.spill, align 8
  %6 = getelementptr inbounds i8, ptr %da.dbg.spill, i64 8
  store ptr %da.1, ptr %6, align 8
    #dbg_declare(ptr %da.dbg.spill, !273, !DIExpression(), !300)
  %7 = zext i1 %e to i8
  store i8 %7, ptr %e.dbg.spill, align 1
    #dbg_declare(ptr %e.dbg.spill, !274, !DIExpression(), !301)
  store i32 %o.0, ptr %o.dbg.spill, align 4
  %8 = getelementptr inbounds i8, ptr %o.dbg.spill, i64 4
  store i32 %o.1, ptr %8, align 4
    #dbg_declare(ptr %o.dbg.spill, !275, !DIExpression(), !302)
    #dbg_declare(ptr %_13.dbg.spill, !286, !DIExpression(), !303)
  store ptr %f, ptr %f.dbg.spill, align 8
    #dbg_declare(ptr %f.dbg.spill, !277, !DIExpression(), !304)
  store ptr %fu, ptr %fu.dbg.spill, align 8
    #dbg_declare(ptr %fu.dbg.spill, !278, !DIExpression(), !305)
    #dbg_declare(ptr %arr, !279, !DIExpression(), !306)
  store ptr %sl.0, ptr %sl.dbg.spill, align 8
  %9 = getelementptr inbounds i8, ptr %sl.dbg.spill, i64 8
  store i64 %sl.1, ptr %9, align 8
    #dbg_declare(ptr %sl.dbg.spill, !280, !DIExpression(), !307)
  store ptr %s.0, ptr %s.dbg.spill, align 8
  %10 = getelementptr inbounds i8, ptr %s.dbg.spill, i64 8
  store i64 %s.1, ptr %10, align 8
    #dbg_declare(ptr %s.dbg.spill, !281, !DIExpression(), !308)
    #dbg_declare(ptr %_19.dbg.spill, !287, !DIExpression(), !309)
    #dbg_declare(ptr %_20.dbg.spill, !288, !DIExpression(), !310)
    #dbg_declare(ptr %_21.dbg.spill, !289, !DIExpression(), !311)
    #dbg_declare(ptr %unit.dbg.spill, !267, !DIExpression(), !294)
    #dbg_declare(ptr %i.dbg.spill, !276, !DIExpression(), !303)
    #dbg_declare(ptr %cu.dbg.spill, !282, !DIExpression(), !309)
    #dbg_declare(ptr %ci.dbg.spill, !283, !DIExpression(), !310)
    #dbg_declare(ptr %cb.dbg.spill, !284, !DIExpression(), !311)
  ret void, !dbg !312
}

; Function Attrs: uwtable
define i32 @unnamed(i32 %_1, i32 %y) unnamed_addr #0 !dbg !313 !guid !319 {
start:
  %y.dbg.spill = alloca [4 x i8], align 4
  %_1.dbg.spill = alloca [4 x i8], align 4
  store i32 %_1, ptr %_1.dbg.spill, align 4
    #dbg_declare(ptr %_1.dbg.spill, !318, !DIExpression(), !320)
  store i32 %y, ptr %y.dbg.spill, align 4
    #dbg_declare(ptr %y.dbg.spill, !317, !DIExpression(), !320)
  ret i32 %y, !dbg !321
}

; Function Attrs: nocallback nofree nosync nounwind willreturn memory(argmem: readwrite)
declare void @llvm.memcpy.p0.p0.i64(ptr noalias writeonly captures(none), ptr noalias readonly captures(none), i64, i1 immarg) #1

attributes #0 = { uwtable "target-cpu"="x86-64" "target-features"="+cx16,+sse,+sse2,+sse3,+sahf" }
attributes #1 = { nocallback nofree nosync nounwind willreturn memory(argmem: readwrite) }

!llvm.module.flags = !{!0, !1, !2, !3}
!llvm.ident = !{!4}
!llvm.dbg.cu = !{!5}

!0 = !{i32 8, !"PIC Level", i32 2}
!1 = !{i32 7, !"uwtable", i32 2}
!2 = !{i32 2, !"CodeView", i32 1}
!3 = !{i32 2, !"Debug Info Version", i32 3}
!4 = !{!"rustc version 1.101.0-nightly (6f5da406b 2026-10-10)"}
!5 = distinct !DICompileUnit(language: DW_LANG_Rust, file: !6, producer: "clang LLVM (rustc version 1.101.0-nightly (6f5da406b 2026-10-10))", isOptimized: false, runtimeVersion: 0, emissionKind: FullDebug, enums: !7, splitDebugInlining: false)
!6 = !DIFile(filename: "debuginfo.rs/@/debuginfo.5788dedd18320a49-cgu.0", directory: ".")
!7 = !{!8, !16}
!8 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "CLike", scope: !10, file: !9, baseType: !11, size: 8, align: 8, flags: DIFlagEnumClass, elements: !13)
!9 = !DIFile(filename: "<unknown>", directory: "")
!10 = !DINamespace(name: "debuginfo", scope: null)
!11 = !DIDerivedType(tag: DW_TAG_typedef, name: "u8", file: !9, baseType: !12)
!12 = !DIBasicType(name: "unsigned __int8", size: 8, encoding: DW_ATE_unsigned)
!13 = !{!14, !15}
!14 = !DIEnumerator(name: "A", value: 0, isUnsigned: true)
!15 = !DIEnumerator(name: "B", value: 1, isUnsigned: true)
!16 = !DICompositeType(tag: DW_TAG_enumeration_type, name: "VariantNames", scope: !17, file: !9, baseType: !27, size: 32, align: 32, flags: DIFlagEnumClass, elements: !45)
!17 = !DICompositeType(tag: DW_TAG_union_type, name: "enum2$<debuginfo::Opt<u32> >", file: !9, size: 64, align: 32, flags: DIFlagPublic, elements: !18, templateParams: !24, identifier: "ed88661fd6391fd93123da87d9a8558")
!18 = !{!19, !35, !44}
!19 = !DIDerivedType(tag: DW_TAG_member, name: "variant0", scope: !17, file: !9, baseType: !20, size: 64, align: 32, flags: DIFlagPublic)
!20 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant0", scope: !17, file: !9, size: 64, align: 32, elements: !21, templateParams: !24, identifier: "3e041f651808286b4f3ffec8aa7f917c")
!21 = !{!22, !29, !31}
!22 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !20, file: !9, baseType: !23, size: 64, align: 32)
!23 = !DICompositeType(tag: DW_TAG_structure_type, name: "None", scope: !17, file: !9, size: 64, align: 32, flags: DIFlagPublic, elements: !24, templateParams: !25, identifier: "dcc0271df181ed276dc73f476cc28325")
!24 = !{}
!25 = !{!26}
!26 = !DITemplateTypeParameter(name: "T", type: !27)
!27 = !DIDerivedType(tag: DW_TAG_typedef, name: "u32", file: !9, baseType: !28)
!28 = !DIBasicType(name: "unsigned __int32", size: 32, encoding: DW_ATE_unsigned)
!29 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !20, file: !9, baseType: !30, align: 32, flags: DIFlagStaticMember, extraData: i64 0)
!30 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !16)
!31 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !20, file: !9, baseType: !32, align: 64, flags: DIFlagStaticMember, extraData: i64 0)
!32 = !DIDerivedType(tag: DW_TAG_const_type, baseType: !33)
!33 = !DIDerivedType(tag: DW_TAG_typedef, name: "u64", file: !9, baseType: !34)
!34 = !DIBasicType(name: "unsigned __int64", size: 64, encoding: DW_ATE_unsigned)
!35 = !DIDerivedType(tag: DW_TAG_member, name: "variant1", scope: !17, file: !9, baseType: !36, size: 64, align: 32, flags: DIFlagPublic)
!36 = !DICompositeType(tag: DW_TAG_structure_type, name: "Variant1", scope: !17, file: !9, size: 64, align: 32, elements: !37, templateParams: !24, identifier: "7653e7f6c0454ba7f610fcd9cf97c54f")
!37 = !{!38, !42, !43}
!38 = !DIDerivedType(tag: DW_TAG_member, name: "value", scope: !36, file: !9, baseType: !39, size: 64, align: 32)
!39 = !DICompositeType(tag: DW_TAG_structure_type, name: "Some", scope: !17, file: !9, size: 64, align: 32, flags: DIFlagPublic, elements: !40, templateParams: !25, identifier: "164fdc60143f3dc897e950da2265e14")
!40 = !{!41}
!41 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !39, file: !9, baseType: !27, size: 32, align: 32, offset: 32, flags: DIFlagPublic)
!42 = !DIDerivedType(tag: DW_TAG_member, name: "NAME", scope: !36, file: !9, baseType: !30, align: 32, flags: DIFlagStaticMember, extraData: i64 1)
!43 = !DIDerivedType(tag: DW_TAG_member, name: "DISCR_EXACT", scope: !36, file: !9, baseType: !32, align: 64, flags: DIFlagStaticMember, extraData: i64 1)
!44 = !DIDerivedType(tag: DW_TAG_member, name: "tag", scope: !17, file: !9, baseType: !27, size: 32, align: 32, flags: DIFlagPublic)
!45 = !{!46, !47}
!46 = !DIEnumerator(name: "None", value: 0, isUnsigned: true)
!47 = !DIEnumerator(name: "Some", value: 1, isUnsigned: true)
!48 = distinct !DISubprogram(name: "neg", linkageName: "_RNvXsc_Cs7vWAa3jVger_9debuginfoaNtB5_3Neg3neg", scope: !50, file: !49, line: 50, type: !51, scopeLine: 50, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !55)
!49 = !DIFile(filename: "debuginfo.rs", directory: ".", checksumkind: CSK_SHA256, checksum: "dd864398bccbfeb8bac5c90d6ea599d75229952505af034bef176996d9e84a51")
!50 = !DINamespace(name: "impl$14", scope: !10)
!51 = !DISubroutineType(types: !52)
!52 = !{!53, !53}
!53 = !DIDerivedType(tag: DW_TAG_typedef, name: "i8", file: !9, baseType: !54)
!54 = !DIBasicType(name: "__int8", size: 8, encoding: DW_ATE_signed)
!55 = !{!56}
!56 = !DILocalVariable(name: "self", arg: 1, scope: !48, file: !49, line: 50, type: !53)
!57 = !{i64 4870345733078936707}
!58 = !DILocation(line: 50, scope: !48)
!59 = !DILocation(line: 51, scope: !48)
!60 = distinct !DISubprogram(name: "big", scope: !10, file: !49, line: 133, type: !61, scopeLine: 133, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !68)
!61 = !DISubroutineType(types: !62)
!62 = !{!33, !63}
!63 = !DICompositeType(tag: DW_TAG_structure_type, name: "Big", scope: !10, file: !9, size: 192, align: 64, flags: DIFlagPublic, elements: !64, templateParams: !24, identifier: "37e2125ca698e5c881fb8802bd277522")
!64 = !{!65, !66, !67}
!65 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !63, file: !9, baseType: !33, size: 64, align: 64, flags: DIFlagPrivate)
!66 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !63, file: !9, baseType: !33, size: 64, align: 64, offset: 64, flags: DIFlagPrivate)
!67 = !DIDerivedType(tag: DW_TAG_member, name: "c", scope: !63, file: !9, baseType: !33, size: 64, align: 64, offset: 128, flags: DIFlagPrivate)
!68 = !{!69}
!69 = !DILocalVariable(name: "b", arg: 1, scope: !60, file: !49, line: 133, type: !63)
!70 = !{i64 5515620527165104600}
!71 = !DILocation(line: 133, scope: !60)
!72 = !DILocation(line: 134, scope: !60)
!73 = !DILocation(line: 135, scope: !60)
!74 = distinct !DISubprogram(name: "borrowed", scope: !10, file: !49, line: 137, type: !75, scopeLine: 137, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !77)
!75 = !DISubroutineType(types: !76)
!76 = !{!27, !27}
!77 = !{!78, !79}
!78 = !DILocalVariable(name: "x", arg: 1, scope: !74, file: !49, line: 137, type: !27)
!79 = !DILocalVariable(name: "r", scope: !80, file: !49, line: 138, type: !81, align: 64)
!80 = distinct !DILexicalBlock(scope: !74, file: !49, line: 138)
!81 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<u32>", baseType: !27, size: 64, align: 64, dwarfAddressSpace: 0)
!82 = !{i64 -8233072348051919563}
!83 = !DILocation(line: 137, scope: !74)
!84 = !DILocation(line: 138, scope: !74)
!85 = !DILocation(line: 138, scope: !80)
!86 = !DILocation(line: 139, scope: !80)
!87 = !DILocation(line: 140, scope: !74)
!88 = distinct !DISubprogram(name: "closure", scope: !10, file: !49, line: 177, type: !89, scopeLine: 177, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !91)
!89 = !DISubroutineType(types: !90)
!90 = !{null, !27}
!91 = !{!92, !93, !97}
!92 = !DILocalVariable(name: "x", arg: 1, scope: !88, file: !49, line: 177, type: !27)
!93 = !DILocalVariable(name: "c", scope: !94, file: !49, line: 178, type: !95, align: 8)
!94 = distinct !DILexicalBlock(scope: !88, file: !49, line: 178)
!95 = !DICompositeType(tag: DW_TAG_structure_type, name: "closure_env$0", scope: !96, file: !9, align: 8, elements: !24, identifier: "21e455953c3f5e0b6a37ba0a6bd366")
!96 = !DINamespace(name: "closure", scope: !10)
!97 = !DILocalVariable(name: "rc", scope: !98, file: !49, line: 179, type: !99, align: 64)
!98 = distinct !DILexicalBlock(scope: !94, file: !49, line: 179)
!99 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<debuginfo::closure::closure_env$0>", baseType: !95, size: 64, align: 64, dwarfAddressSpace: 0)
!100 = !{i64 -8001930764763462056}
!101 = !DILocation(line: 177, scope: !88)
!102 = !DILocation(line: 178, scope: !94)
!103 = !DILocation(line: 179, scope: !94)
!104 = !DILocation(line: 179, scope: !98)
!105 = !DILocation(line: 180, scope: !88)
!106 = distinct !DISubprogram(name: "locals", scope: !10, file: !49, line: 146, type: !75, scopeLine: 146, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !107)
!107 = !{!108, !109, !111}
!108 = !DILocalVariable(name: "x", arg: 1, scope: !106, file: !49, line: 146, type: !27)
!109 = !DILocalVariable(name: "a", scope: !110, file: !49, line: 147, type: !27, align: 32)
!110 = distinct !DILexicalBlock(scope: !106, file: !49, line: 147)
!111 = !DILocalVariable(name: "b", scope: !112, file: !49, line: 148, type: !27, align: 32)
!112 = distinct !DILexicalBlock(scope: !110, file: !49, line: 148)
!113 = !{i64 5053764491818238053}
!114 = !DILocation(line: 146, scope: !106)
!115 = !DILocation(line: 147, scope: !110)
!116 = !DILocation(line: 148, scope: !112)
!117 = !DILocation(line: 150, scope: !106)
!118 = distinct !DISubprogram(name: "pair", scope: !10, file: !49, line: 129, type: !119, scopeLine: 129, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !125)
!119 = !DISubroutineType(types: !120)
!120 = !{!27, !121}
!121 = !DICompositeType(tag: DW_TAG_structure_type, name: "Pair", scope: !10, file: !9, size: 64, align: 32, flags: DIFlagPublic, elements: !122, templateParams: !24, identifier: "619840ec75ba6bc097ef00bb986322ab")
!122 = !{!123, !124}
!123 = !DIDerivedType(tag: DW_TAG_member, name: "a", scope: !121, file: !9, baseType: !27, size: 32, align: 32, flags: DIFlagPrivate)
!124 = !DIDerivedType(tag: DW_TAG_member, name: "b", scope: !121, file: !9, baseType: !27, size: 32, align: 32, offset: 32, flags: DIFlagPrivate)
!125 = !{!126}
!126 = !DILocalVariable(name: "p", scope: !118, file: !49, line: 129, type: !121, align: 32)
!127 = !{i64 4859215404959254835}
!128 = !DILocation(line: 129, scope: !118)
!129 = !DILocation(line: 131, scope: !118)
!130 = distinct !DISubprogram(name: "pair_by_value", scope: !121, file: !49, line: 113, type: !119, scopeLine: 113, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, declaration: !131, retainedNodes: !132)
!131 = !DISubprogram(name: "pair_by_value", scope: !121, file: !49, line: 113, type: !119, scopeLine: 113, flags: DIFlagPrototyped, spFlags: 0, templateParams: !24)
!132 = !{!133}
!133 = !DILocalVariable(name: "self", scope: !130, file: !49, line: 113, type: !121, align: 32)
!134 = !{i64 3613341350573506715}
!135 = !DILocation(line: 113, scope: !130)
!136 = !DILocation(line: 115, scope: !130)
!137 = distinct !DISubprogram(name: "pair_closure", scope: !121, file: !49, line: 117, type: !138, scopeLine: 117, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, declaration: !141, retainedNodes: !142)
!138 = !DISubroutineType(types: !139)
!139 = !{null, !140}
!140 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<debuginfo::Pair>", baseType: !121, size: 64, align: 64, dwarfAddressSpace: 0)
!141 = !DISubprogram(name: "pair_closure", scope: !121, file: !49, line: 117, type: !138, scopeLine: 117, flags: DIFlagPrototyped, spFlags: 0, templateParams: !24)
!142 = !{!143, !144, !149, !156}
!143 = !DILocalVariable(name: "self", arg: 1, scope: !137, file: !49, line: 117, type: !140)
!144 = !DILocalVariable(name: "c", scope: !145, file: !49, line: 118, type: !146, align: 8)
!145 = distinct !DILexicalBlock(scope: !137, file: !49, line: 118)
!146 = !DICompositeType(tag: DW_TAG_structure_type, name: "closure_env$0", scope: !147, file: !9, align: 8, elements: !24, identifier: "9ec8487219eae5abbcbb070c15d30788")
!147 = !DINamespace(name: "pair_closure", scope: !148)
!148 = !DINamespace(name: "impl$15", scope: !10)
!149 = !DILocalVariable(name: "w", scope: !150, file: !49, line: 119, type: !151, align: 8)
!150 = distinct !DILexicalBlock(scope: !145, file: !49, line: 119)
!151 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<debuginfo::impl$15::pair_closure::closure_env$0>", scope: !10, file: !9, align: 8, flags: DIFlagPublic, elements: !152, templateParams: !154, identifier: "35225745ea04af5381cef16a77333aaf")
!152 = !{!153}
!153 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !151, file: !9, baseType: !146, align: 8, flags: DIFlagPrivate)
!154 = !{!155}
!155 = !DITemplateTypeParameter(name: "T", type: !146)
!156 = !DILocalVariable(name: "rw", scope: !157, file: !49, line: 120, type: !158, align: 64)
!157 = distinct !DILexicalBlock(scope: !150, file: !49, line: 120)
!158 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<debuginfo::Wrap<debuginfo::impl$15::pair_closure::closure_env$0> >", baseType: !151, size: 64, align: 64, dwarfAddressSpace: 0)
!159 = !{i64 -4772090666375877613}
!160 = !DILocation(line: 117, scope: !137)
!161 = !DILocation(line: 118, scope: !145)
!162 = !DILocation(line: 119, scope: !150)
!163 = !DILocation(line: 120, scope: !150)
!164 = !DILocation(line: 120, scope: !157)
!165 = !DILocation(line: 121, scope: !137)
!166 = distinct !DISubprogram(name: "pair_first", scope: !121, file: !49, line: 109, type: !167, scopeLine: 109, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, declaration: !169, retainedNodes: !170)
!167 = !DISubroutineType(types: !168)
!168 = !{!27, !140}
!169 = !DISubprogram(name: "pair_first", scope: !121, file: !49, line: 109, type: !167, scopeLine: 109, flags: DIFlagPrototyped, spFlags: 0, templateParams: !24)
!170 = !{!171}
!171 = !DILocalVariable(name: "self", arg: 1, scope: !166, file: !49, line: 109, type: !140)
!172 = !{i64 -4966468779482704476}
!173 = !DILocation(line: 109, scope: !166)
!174 = !DILocation(line: 110, scope: !166)
!175 = !DILocation(line: 111, scope: !166)
!176 = distinct !DISubprogram(name: "scalar", scope: !10, file: !49, line: 125, type: !75, scopeLine: 125, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !177)
!177 = !{!178}
!178 = !DILocalVariable(name: "x", arg: 1, scope: !176, file: !49, line: 125, type: !27)
!179 = !{i64 -4572029188287661406}
!180 = !DILocation(line: 125, scope: !176)
!181 = !DILocation(line: 127, scope: !176)
!182 = distinct !DISubprogram(name: "types", scope: !10, file: !49, line: 152, type: !183, scopeLine: 152, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !263)
!183 = !DISubroutineType(types: !184)
!184 = !{null, !185, !188, !199, !204, !205, !206, !207, !208, !220, !226, !8, !17, !236, !238, !241, !244, !250, !255, !260, !261, !262}
!185 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<u32>", scope: !10, file: !9, size: 32, align: 32, flags: DIFlagPublic, elements: !186, templateParams: !25, identifier: "5cf88beabc502caf9f99c6dcba2e86")
!186 = !{!187}
!187 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !185, file: !9, baseType: !27, size: 32, align: 32, flags: DIFlagPrivate)
!188 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<debuginfo::Wrap<debuginfo::Wrap<u8> > >", baseType: !189, size: 64, align: 64, dwarfAddressSpace: 0)
!189 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<debuginfo::Wrap<u8> >", scope: !10, file: !9, size: 8, align: 8, flags: DIFlagPublic, elements: !190, templateParams: !197, identifier: "2bb44967ac89d72e23c403eb1dcba09d")
!190 = !{!191}
!191 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !189, file: !9, baseType: !192, size: 8, align: 8, flags: DIFlagPrivate)
!192 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<u8>", scope: !10, file: !9, size: 8, align: 8, flags: DIFlagPublic, elements: !193, templateParams: !195, identifier: "bd32df9605987d80afe5683cb7d15052")
!193 = !{!194}
!194 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !192, file: !9, baseType: !11, size: 8, align: 8, flags: DIFlagPrivate)
!195 = !{!196}
!196 = !DITemplateTypeParameter(name: "T", type: !11)
!197 = !{!198}
!198 = !DITemplateTypeParameter(name: "T", type: !192)
!199 = !DICompositeType(tag: DW_TAG_structure_type, name: "tuple$<u32,bool>", file: !9, size: 64, align: 32, elements: !200, templateParams: !24, identifier: "207aae7b51c398d54b045bc76bc3c2be")
!200 = !{!201, !202}
!201 = !DIDerivedType(tag: DW_TAG_member, name: "__0", scope: !199, file: !9, baseType: !27, size: 32, align: 32)
!202 = !DIDerivedType(tag: DW_TAG_member, name: "__1", scope: !199, file: !9, baseType: !203, size: 8, align: 8, offset: 32)
!203 = !DIBasicType(name: "bool", size: 8, encoding: DW_ATE_boolean)
!204 = !DICompositeType(tag: DW_TAG_structure_type, name: "tuple$<>", file: !9, align: 8, elements: !24, identifier: "46dc9fa5938407e177dc75118fa86611")
!205 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref_mut$<u64>", baseType: !33, size: 64, align: 64, dwarfAddressSpace: 0)
!206 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_const$<u8>", baseType: !11, size: 64, align: 64, dwarfAddressSpace: 0)
!207 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ptr_mut$<debuginfo::Wrap<u8> >", baseType: !192, size: 64, align: 64, dwarfAddressSpace: 0)
!208 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<dyn$<debuginfo::Tr> >", file: !9, size: 128, align: 64, elements: !209, templateParams: !24, identifier: "28c395c7e9d843c4604ec067c6789318")
!209 = !{!210, !213}
!210 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !208, file: !9, baseType: !211, size: 64, align: 64)
!211 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !212, size: 64, align: 64, dwarfAddressSpace: 0)
!212 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn$<debuginfo::Tr>", file: !9, align: 8, elements: !24, identifier: "307bb90f8a0c719eaa198edcdee71ff")
!213 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !208, file: !9, baseType: !214, size: 64, align: 64, offset: 64)
!214 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<array$<usize,4> >", baseType: !215, size: 64, align: 64, dwarfAddressSpace: 0)
!215 = !DICompositeType(tag: DW_TAG_array_type, baseType: !216, size: 256, align: 64, elements: !218)
!216 = !DIDerivedType(tag: DW_TAG_typedef, name: "usize", file: !9, baseType: !217)
!217 = !DIBasicType(name: "size_t", size: 64, encoding: DW_ATE_unsigned)
!218 = !{!219}
!219 = !DISubrange(count: 4, lowerBound: 0)
!220 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<dyn$<debuginfo::Tr,debuginfo::Send> >", file: !9, size: 128, align: 64, elements: !221, templateParams: !24, identifier: "9c92c81a87ec464b5048c36d28367bfd")
!221 = !{!222, !225}
!222 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !220, file: !9, baseType: !223, size: 64, align: 64)
!223 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !224, size: 64, align: 64, dwarfAddressSpace: 0)
!224 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn$<debuginfo::Tr,debuginfo::Send>", file: !9, align: 8, elements: !24, identifier: "2ac9d50e679ff94772370e458dffa9da")
!225 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !220, file: !9, baseType: !214, size: 64, align: 64, offset: 64)
!226 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<dyn$<debuginfo::WithAssoc<assoc$<Out,u32> > > >", file: !9, size: 128, align: 64, elements: !227, templateParams: !24, identifier: "456844d327a4de0a15a4b0b7d602bf08")
!227 = !{!228, !231}
!228 = !DIDerivedType(tag: DW_TAG_member, name: "pointer", scope: !226, file: !9, baseType: !229, size: 64, align: 64)
!229 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !230, size: 64, align: 64, dwarfAddressSpace: 0)
!230 = !DICompositeType(tag: DW_TAG_structure_type, name: "dyn$<debuginfo::WithAssoc<assoc$<Out,u32> > >", file: !9, align: 8, elements: !24, identifier: "1397c5d324c07541c171d7a36d504b41")
!231 = !DIDerivedType(tag: DW_TAG_member, name: "vtable", scope: !226, file: !9, baseType: !232, size: 64, align: 64, offset: 64)
!232 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "ref$<array$<usize,3> >", baseType: !233, size: 64, align: 64, dwarfAddressSpace: 0)
!233 = !DICompositeType(tag: DW_TAG_array_type, baseType: !216, size: 192, align: 64, elements: !234)
!234 = !{!235}
!235 = !DISubrange(count: 3, lowerBound: 0)
!236 = !DICompositeType(tag: DW_TAG_structure_type, name: "In", scope: !237, file: !9, align: 8, flags: DIFlagPublic, elements: !24, identifier: "5d31365491354d1ca99ee6142773e93c")
!237 = !DINamespace(name: "inner", scope: !10)
!238 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "bool (*)(u32)", baseType: !239, size: 64, align: 64, dwarfAddressSpace: 0)
!239 = !DISubroutineType(types: !240)
!240 = !{!203, !27}
!241 = !DIDerivedType(tag: DW_TAG_pointer_type, name: "void (*)()", baseType: !242, size: 64, align: 64, dwarfAddressSpace: 0)
!242 = !DISubroutineType(types: !243)
!243 = !{null}
!244 = !DICompositeType(tag: DW_TAG_structure_type, name: "Wrap<array$<u8,4> >", scope: !10, file: !9, size: 32, align: 8, flags: DIFlagPublic, elements: !245, templateParams: !248, identifier: "ddce30512c7cdaf65241cfdccba08b4b")
!245 = !{!246}
!246 = !DIDerivedType(tag: DW_TAG_member, name: "t", scope: !244, file: !9, baseType: !247, size: 32, align: 8, flags: DIFlagPrivate)
!247 = !DICompositeType(tag: DW_TAG_array_type, baseType: !11, size: 32, align: 8, elements: !218)
!248 = !{!249}
!249 = !DITemplateTypeParameter(name: "T", type: !247)
!250 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<slice2$<u32> >", file: !9, size: 128, align: 64, elements: !251, templateParams: !24, identifier: "d88c96c0440e14893a8ceae32ae0ce5")
!251 = !{!252, !254}
!252 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !250, file: !9, baseType: !253, size: 64, align: 64)
!253 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !27, size: 64, align: 64, dwarfAddressSpace: 0)
!254 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !250, file: !9, baseType: !216, size: 64, align: 64, offset: 64)
!255 = !DICompositeType(tag: DW_TAG_structure_type, name: "ref$<str$>", file: !9, size: 128, align: 64, elements: !256, templateParams: !24, identifier: "6fc9dd7daffb1f73292744aea0793200")
!256 = !{!257, !259}
!257 = !DIDerivedType(tag: DW_TAG_member, name: "data_ptr", scope: !255, file: !9, baseType: !258, size: 64, align: 64)
!258 = !DIDerivedType(tag: DW_TAG_pointer_type, baseType: !11, size: 64, align: 64, dwarfAddressSpace: 0)
!259 = !DIDerivedType(tag: DW_TAG_member, name: "length", scope: !255, file: !9, baseType: !216, size: 64, align: 64, offset: 64)
!260 = !DICompositeType(tag: DW_TAG_structure_type, name: "ConstU<4>", scope: !10, file: !9, align: 8, flags: DIFlagPublic, elements: !24, identifier: "360cbb4772f52ea4242076d3b548fa44")
!261 = !DICompositeType(tag: DW_TAG_structure_type, name: "ConstI<-3>", scope: !10, file: !9, align: 8, flags: DIFlagPublic, elements: !24, identifier: "fab23dbd16561e7e18f27ebe184c9658")
!262 = !DICompositeType(tag: DW_TAG_structure_type, name: "ConstB<true>", scope: !10, file: !9, align: 8, flags: DIFlagPublic, elements: !24, identifier: "83251cd4e1c115708795c56acff74d0e")
!263 = !{!264, !265, !266, !267, !268, !269, !270, !271, !272, !273, !274, !275, !276, !277, !278, !279, !280, !281, !282, !283, !284, !285, !286, !287, !288, !289}
!264 = !DILocalVariable(name: "w", arg: 1, scope: !182, file: !49, line: 153, type: !185)
!265 = !DILocalVariable(name: "ww", arg: 2, scope: !182, file: !49, line: 154, type: !188)
!266 = !DILocalVariable(name: "t", scope: !182, file: !49, line: 155, type: !199, align: 32)
!267 = !DILocalVariable(name: "unit", scope: !182, file: !49, line: 156, type: !204, align: 8)
!268 = !DILocalVariable(name: "r", arg: 5, scope: !182, file: !49, line: 157, type: !205)
!269 = !DILocalVariable(name: "p", arg: 6, scope: !182, file: !49, line: 158, type: !206)
!270 = !DILocalVariable(name: "m", arg: 7, scope: !182, file: !49, line: 159, type: !207)
!271 = !DILocalVariable(name: "d", scope: !182, file: !49, line: 160, type: !208, align: 64)
!272 = !DILocalVariable(name: "ds", scope: !182, file: !49, line: 161, type: !220, align: 64)
!273 = !DILocalVariable(name: "da", scope: !182, file: !49, line: 162, type: !226, align: 64)
!274 = !DILocalVariable(name: "e", arg: 11, scope: !182, file: !49, line: 163, type: !8)
!275 = !DILocalVariable(name: "o", scope: !182, file: !49, line: 164, type: !17, align: 32)
!276 = !DILocalVariable(name: "i", scope: !182, file: !49, line: 165, type: !236, align: 8)
!277 = !DILocalVariable(name: "f", arg: 14, scope: !182, file: !49, line: 166, type: !238)
!278 = !DILocalVariable(name: "fu", arg: 15, scope: !182, file: !49, line: 167, type: !241)
!279 = !DILocalVariable(name: "arr", arg: 16, scope: !182, file: !49, line: 168, type: !244)
!280 = !DILocalVariable(name: "sl", scope: !182, file: !49, line: 169, type: !250, align: 64)
!281 = !DILocalVariable(name: "s", scope: !182, file: !49, line: 170, type: !255, align: 64)
!282 = !DILocalVariable(name: "cu", scope: !182, file: !49, line: 171, type: !260, align: 8)
!283 = !DILocalVariable(name: "ci", scope: !182, file: !49, line: 172, type: !261, align: 8)
!284 = !DILocalVariable(name: "cb", scope: !182, file: !49, line: 173, type: !262, align: 8)
!285 = !DILocalVariable(arg: 4, scope: !182, file: !49, line: 156, type: !204)
!286 = !DILocalVariable(arg: 13, scope: !182, file: !49, line: 165, type: !236)
!287 = !DILocalVariable(arg: 19, scope: !182, file: !49, line: 171, type: !260)
!288 = !DILocalVariable(arg: 20, scope: !182, file: !49, line: 172, type: !261)
!289 = !DILocalVariable(arg: 21, scope: !182, file: !49, line: 173, type: !262)
!290 = !{i64 -1154744837904250159}
!291 = !DILocation(line: 153, scope: !182)
!292 = !DILocation(line: 154, scope: !182)
!293 = !DILocation(line: 155, scope: !182)
!294 = !DILocation(line: 156, scope: !182)
!295 = !DILocation(line: 157, scope: !182)
!296 = !DILocation(line: 158, scope: !182)
!297 = !DILocation(line: 159, scope: !182)
!298 = !DILocation(line: 160, scope: !182)
!299 = !DILocation(line: 161, scope: !182)
!300 = !DILocation(line: 162, scope: !182)
!301 = !DILocation(line: 163, scope: !182)
!302 = !DILocation(line: 164, scope: !182)
!303 = !DILocation(line: 165, scope: !182)
!304 = !DILocation(line: 166, scope: !182)
!305 = !DILocation(line: 167, scope: !182)
!306 = !DILocation(line: 168, scope: !182)
!307 = !DILocation(line: 169, scope: !182)
!308 = !DILocation(line: 170, scope: !182)
!309 = !DILocation(line: 171, scope: !182)
!310 = !DILocation(line: 172, scope: !182)
!311 = !DILocation(line: 173, scope: !182)
!312 = !DILocation(line: 175, scope: !182)
!313 = distinct !DISubprogram(name: "unnamed", scope: !10, file: !49, line: 142, type: !314, scopeLine: 142, flags: DIFlagPrototyped, spFlags: DISPFlagDefinition, unit: !5, templateParams: !24, retainedNodes: !316)
!314 = !DISubroutineType(types: !315)
!315 = !{!27, !27, !27}
!316 = !{!317, !318}
!317 = !DILocalVariable(name: "y", arg: 2, scope: !313, file: !49, line: 142, type: !27)
!318 = !DILocalVariable(arg: 1, scope: !313, file: !49, line: 142, type: !27)
!319 = !{i64 1291262018994763082}
!320 = !DILocation(line: 142, scope: !313)
!321 = !DILocation(line: 144, scope: !313)
