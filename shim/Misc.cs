using System;
namespace UnityEngine
{
    [AttributeUsage(AttributeTargets.Field, AllowMultiple = false)]
    public class TooltipAttribute : Attribute { public readonly string tooltip; public TooltipAttribute(string tooltip) { this.tooltip = tooltip; } }
    [AttributeUsage(AttributeTargets.Field, AllowMultiple = false)]
    public class HeaderAttribute : Attribute { public readonly string header; public HeaderAttribute(string header) { this.header = header; } }
    [AttributeUsage(AttributeTargets.Field)]
    public class SerializeField : Attribute { }
    [AttributeUsage(AttributeTargets.Field, AllowMultiple = false)]
    public class RangeAttribute : Attribute { public readonly float min, max; public RangeAttribute(float min, float max) { this.min = min; this.max = max; } }

    public static class Debug
    {
        // Pluggable so hosts (CLI, browser worker, tests) decide where logs go.
        public static Action<string> LogSink = s => Console.Error.WriteLine(s);
        public static Action<string> WarningSink = s => Console.Error.WriteLine("WARNING: " + s);
        public static Action<string> ErrorSink = s => Console.Error.WriteLine("ERROR: " + s);
        public static void Log(object message) => LogSink?.Invoke(message == null ? "Null" : message.ToString());
        public static void LogWarning(object message) => WarningSink?.Invoke(message == null ? "Null" : message.ToString());
        public static void LogError(object message) => ErrorSink?.Invoke(message == null ? "Null" : message.ToString());
        public static void LogFormat(string format, params object[] args) => Log(string.Format(format, args));
    }

    namespace Rendering
    {
        public enum IndexFormat { UInt16 = 0, UInt32 = 1 }
    }
}
