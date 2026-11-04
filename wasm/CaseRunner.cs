// Shared by the CoreCLR CLI and the browser host, so every browser result has a CoreCLR twin.
using System;
using System.Collections.Generic;
using System.Threading;
using System.Threading.Tasks;
using NativeRemesher.Benchmark;
using UnityEngine;

namespace NativeRemesher.Host
{
    // Executes every task inline on the calling thread. QueueTask runs the task immediately and
    // TryExecuteTaskInline must return TryExecuteTask(task): if it returned false RunSynchronously would fall back to
    // queue-and-wait, which blocks a single-threaded worker. Parallel.For under this scheduler has parallelism 1.
    public sealed class InlineScheduler : TaskScheduler
    {
        public override int MaximumConcurrencyLevel => 1;
        protected override void QueueTask(Task task) => TryExecuteTask(task);
        protected override bool TryExecuteTaskInline(Task task, bool taskWasPreviouslyQueued) => TryExecuteTask(task);
        protected override IEnumerable<Task> GetScheduledTasks() => new Task[0];
    }

    public static class CaseRunner
    {
        public static string RunCase(string name, int target, bool inline)
        {
            Revolution.enabled = false; // mirrors the unit tests and the bench host (docs/findings.md #1)
            var entry = MeshCorpus.Procedural().Find(e => e.name == name);
            if (entry == null) return "{\"error\":\"unknown case " + name + "\"}";
            var mesh = entry.create();
            var settings = RemeshSettings.Default; settings.targetQuadCount = target;
            var profile = RemeshProfile.For(RemeshProfileKind.GameAsset);
            var sw = System.Diagnostics.Stopwatch.StartNew();
            RemeshResult result;
            if (inline)
            {
                var task = new Task<RemeshResult>(() => RemeshPipeline.Run(mesh, settings, profile));
                task.RunSynchronously(new InlineScheduler());
                result = task.GetAwaiter().GetResult();
            }
            else result = RemeshPipeline.Run(mesh, settings, profile);
            sw.Stop();
            var ex = result.extraction;
            ulong h = 1469598103934665603UL;
            Action<uint> mix = v => { h ^= v; h *= 1099511628211UL; };
            foreach (var p in ex.positions) { mix((uint)BitConverter.SingleToInt32Bits(p.x)); mix((uint)BitConverter.SingleToInt32Bits(p.y)); mix((uint)BitConverter.SingleToInt32Bits(p.z)); }
            foreach (var f in ex.faces) { mix((uint)f.Length); foreach (var i in f) mix((uint)i); }
            return "{\"case\":\"" + name + "\",\"target\":" + target + ",\"outFaces\":" + ex.faces.Count + ",\"outVerts\":" + ex.positions.Length +
                   ",\"hash\":\"" + h.ToString("x16") + "\",\"ms\":" + sw.ElapsedMilliseconds + ",\"decimateMs\":" + result.decimateMs + ",\"hierarchyMs\":" + result.hierarchyMs + ",\"attributeMs\":" + result.attributeMs + ",\"topologyMs\":" + result.topologyMs.ToString("F0") + ",\"orientationMs\":" + result.orientationMs.ToString("F0") + ",\"positionMs\":" + result.positionMs.ToString("F0") + ",\"extractionMs\":" + result.extractionMs.ToString("F0") + ",\"totalMs\":" + result.totalMs.ToString("F0") + "}";
        }
    }
}
