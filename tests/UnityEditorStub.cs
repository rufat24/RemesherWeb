// Bench-only stand-in for the few UnityEditor APIs that upstream/Benchmark touches, built from compiler errors.
// Asset loading returns nothing (no Unity assets exist here); the runner skips tiers that need them.
using System;
using UnityEngine;
namespace UnityEditor
{
    [AttributeUsage(AttributeTargets.Method, AllowMultiple = true)]
    public sealed class MenuItemAttribute : Attribute
    {
        public MenuItemAttribute(string itemName) { }
        public MenuItemAttribute(string itemName, bool isValidateFunction) { }
        public MenuItemAttribute(string itemName, bool isValidateFunction, int priority) { }
    }
    public enum ImportAssetOptions { Default = 0, ForceUpdate = 1, ForceSynchronousImport = 8 }
    public static class AssetDatabase
    {
        public static T LoadAssetAtPath<T>(string path) where T : class => null;
        public static UnityEngine.Object[] LoadAllAssetsAtPath(string path) => new UnityEngine.Object[0];
        public static void ImportAsset(string path, ImportAssetOptions options = ImportAssetOptions.Default) { }
        public static bool DeleteAsset(string path) => false;
        public static void Refresh() { }
    }
    public sealed class ExitRequestedException : Exception { public readonly int Code; public ExitRequestedException(int code) { Code = code; } }
    public static class EditorApplication
    {
        public static void Exit(int exitCode) { throw new ExitRequestedException(exitCode); }
    }
    public static class EditorUtility
    {
        public static bool DisplayCancelableProgressBar(string title, string info, float progress) => false;
        public static void DisplayProgressBar(string title, string info, float progress) { }
        public static void ClearProgressBar() { }
    }
}
