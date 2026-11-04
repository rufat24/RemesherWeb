// Upstream keeps ~600 mutable statics (knobs, debug lists, counters). A second job in the same process would inherit the first one's
// settings. Capture once at startup, restore before every job. Shallow: reference-type statics that are appended to (debug lists) are not
// reset; the statics census (M2.1) lists them, and the browser starts a fresh worker per job anyway.
using System;
using System.Collections.Generic;
using System.Reflection;

namespace NativeRemesher.Web
{
    public sealed class StaticsSnapshot
    {
        readonly List<(FieldInfo field, object value)> m_Saved = new List<(FieldInfo, object)>();

        public int Count => m_Saved.Count;

        public static StaticsSnapshot Capture(Assembly assembly)
        {
            var s = new StaticsSnapshot();
            foreach (var type in assembly.GetTypes())
            {
                if (type.Namespace == null || !type.Namespace.StartsWith("NativeRemesher", StringComparison.Ordinal)) continue;
                if (type.NamespaceIsWeb()) continue;
                if (type.IsGenericTypeDefinition) continue;
                foreach (var f in type.GetFields(BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic | BindingFlags.DeclaredOnly))
                {
                    if (f.IsLiteral || f.IsInitOnly) continue;
                    if (f.GetCustomAttribute<ThreadStaticAttribute>() != null) continue;
                    if (f.IsDefined(typeof(System.Runtime.CompilerServices.CompilerGeneratedAttribute), false)) { /* backing fields are statics too */ }
                    s.m_Saved.Add((f, f.GetValue(null)));
                }
            }
            return s;
        }

        public void Restore()
        {
            foreach (var (field, value) in m_Saved) field.SetValue(null, value);
        }
    }

    static class TypeExt
    {
        public static bool NamespaceIsWeb(this Type t) => t.Namespace == "NativeRemesher.Web" || t.Namespace == "NativeRemesher.Host" || t.Namespace == "NativeRemesher.Wasm"
                                                           || t.Namespace == "NativeRemesher.Cli" || t.Namespace == "NativeRemesher.Benchmark";
    }
}
