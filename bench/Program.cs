using System;
using UnityEditor;
namespace NativeRemesher.BenchHost
{
    // Runs upstream's BenchmarkRunner.RunFromCommandLine unchanged. It reads Environment.GetCommandLineArgs() and
    // ends with EditorApplication.Exit(code), which the stub turns into an exception we map back to an exit code.
    public static class Program
    {
        public static int Main(string[] args)
        {
            // Upstream's runner never switches the turned-surface shortcut off, but a turned result has no topology and the
            // runner throws on it (see docs/findings.md). The unit tests switch it off in SetUp; this flag mirrors that.
            if (Environment.GetEnvironmentVariable("BENCH_NO_REVOLUTION") == "1") NativeRemesher.Revolution.enabled = false;
            if (Environment.GetEnvironmentVariable("BENCH_TRACE") == "1")
                AppDomain.CurrentDomain.FirstChanceException += (_, e) =>
                {
                    if (e.Exception is ArgumentNullException) Console.Error.WriteLine("TRACE " + e.Exception + "\n");
                };
            try { NativeRemesher.Benchmark.BenchmarkRunner.RunFromCommandLine(); return 0; }
            catch (ExitRequestedException e) { return e.Code; }
        }
    }
}
