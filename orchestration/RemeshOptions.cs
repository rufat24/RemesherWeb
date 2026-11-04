// The web remesher's options. Names, defaults and meaning mirror the Unity window's [SerializeField] fields at
// upstream/Editor/NativeRemesherWindow.cs lines 26-83 (commit 8766ead). When upstream changes a default, the UI census (M2.3) must fail.
using System;
using System.Diagnostics.CodeAnalysis;
using System.Text.Json;

namespace NativeRemesher.Web
{
    [DynamicallyAccessedMembers(DynamicallyAccessedMemberTypes.PublicFields)]
    public sealed class RemeshOptions
    {
        // --- Model (window: m_ModelType) ---
        public ModelType modelType = ModelType.Auto;
        // --- Each Model Type's own settings (window lines 28-47) ---
        public bool roundParts = true;              // m_RoundParts -> RemeshPipeline.kinematicGuides
        public bool characterSourceLoops = true;    // m_CharacterSourceLoops -> quadReductionCharacter
        public bool characterStraps = true;         // m_CharacterStraps -> ribbonParts
        public bool characterThinRows = true;       // m_CharacterThinRows -> thicknessSizing
        public bool hardSourceLoops = true;         // m_HardSourceLoops -> quadReductionHardSurface
        public bool hardDenseToNormalMap = true;    // m_HardDenseToNormalMap -> hardSurfaceSparseCreases
        public bool hardThinStrips = true;          // m_HardThinStrips -> stripSizing
        public bool hardRods = true;                // m_HardRods -> hardSurfaceRods
        public bool hardMergeFlat = true;           // m_HardMergeFlat -> hardSurfaceSimplify
        public bool hardEvenRows = false;           // m_HardEvenRows -> hardSurfaceCleanLayout
        public bool hardAcrossRounding = false;     // m_HardAcrossRounding -> hardSurfaceRoundedCreases
        public bool hardFlatPanels = true;          // m_HardFlatPanels -> hardSurfaceFair
        public bool hardEdgesAtCount = true;        // m_HardEdgesAtCount -> hardSurfaceSourceCreases
        public bool hardToCount = false;            // m_HardToCount -> hardSurfaceSimplifyToCount
        public bool hardPlateRows = true;           // m_HardPlateRows -> hardSurfacePlateBlocks
        public bool hardRowsAtMerged = false;       // m_HardRowsAtMerged (&& !hardToCount) -> hardSurfaceRowsAtMergedCount
        public bool hardShapeRegions = true;        // m_HardShapeRegions -> kinematicRegionsHardSurface
        public bool scanShapeRegions = true;        // m_ScanShapeRegions -> kinematicRegionsScan
        // --- Quad settings (window lines 49-54) ---
        public int targetQuadCount = 2000;          // m_TargetQuadCount
        public float curveDetail = 50f;             // m_CurveDetail (percent) -> IntegerGridMap.curveDetail = value / 100
        public bool curvesAddQuads = true;          // m_CurvesAddQuads
        public bool longCreaseLoops = true;         // m_LongCreaseLoops
        public SymmetryAxis symmetry = SymmetryAxis.None; // m_Symmetry
        public bool materialBorders = false;        // m_MaterialBorders

        public static RemeshOptions FromJson(string json)
        {
            var o = new RemeshOptions();
            if (string.IsNullOrWhiteSpace(json)) return o;
            using var doc = JsonDocument.Parse(json);
            foreach (var p in doc.RootElement.EnumerateObject())
            {
                var f = typeof(RemeshOptions).GetField(p.Name);
                if (f == null) throw new ArgumentException("Unknown option '" + p.Name + "'");
                var t = f.FieldType;
                object v;
                if (t == typeof(bool)) v = p.Value.GetBoolean();
                else if (t == typeof(int)) v = p.Value.GetInt32();
                else if (t == typeof(float)) v = (float)p.Value.GetDouble();
                else if (t.IsEnum) v = p.Value.ValueKind == JsonValueKind.String ? Enum.Parse(t, p.Value.GetString(), true) : Enum.ToObject(t, p.Value.GetInt32());
                else throw new ArgumentException("Unsupported option type for '" + p.Name + "'");
                f.SetValue(o, v);
            }
            return o;
        }
    }
}
