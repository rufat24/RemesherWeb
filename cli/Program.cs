using System;
namespace NativeRemesher.Cli
{
    // usage: cli case <name> <target> [inline]
    public static class Program
    {
        public static int Main(string[] a)
        {
            if (a.Length >= 3 && a[0] == "case")
            {
                Console.WriteLine(NativeRemesher.Host.CaseRunner.RunCase(a[1], int.Parse(a[2]), a.Length > 3 && a[3] == "inline"));
                return 0;
            }
            Console.Error.WriteLine("usage: cli case <name> <target> [inline]"); return 2;
        }
    }
}
