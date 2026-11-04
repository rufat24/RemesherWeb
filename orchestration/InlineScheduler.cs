using System.Collections.Generic;
using System.Threading.Tasks;

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
}
