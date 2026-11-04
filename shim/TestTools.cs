using System.Collections.Generic;
using System.Text.RegularExpressions;
namespace UnityEngine
{
    public enum LogType { Error = 0, Assert = 1, Warning = 2, Log = 3, Exception = 4 }
}
namespace UnityEngine.TestTools
{
    // Minimal LogAssert: records expectations. Unlike Unity it does not fail a test for an unexpected Error log
    // (hosts can inspect Expected / Debug sinks if they want that).
    public static class LogAssert
    {
        public static readonly List<(LogType type, Regex pattern)> Expected = new List<(LogType, Regex)>();
        public static void Expect(LogType type, string message) => Expected.Add((type, new Regex(Regex.Escape(message))));
        public static void Expect(LogType type, Regex message) => Expected.Add((type, message));
        public static bool ignoreFailingMessages { get; set; }
    }
}
