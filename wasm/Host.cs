using System;
using System.Runtime.InteropServices.JavaScript;
using System.Runtime.Versioning;

namespace NativeRemesher.Wasm
{
    [SupportedOSPlatform("browser")]
    public static partial class Host
    {
        public static void Main() { }

        [JSExport]
        public static string RunCase(string name, int target, bool inline) => NativeRemesher.Host.CaseRunner.RunCase(name, target, inline);
    }
}
