// Module Web Worker: boots the .NET WASM runtime and runs one corpus case on a single thread.
import { dotnet } from './_framework/dotnet.js';
let exportsPromise;
async function boot() {
  const { getAssemblyExports, getConfig } = await dotnet.withDiagnosticTracing(false).create();
  return getAssemblyExports(getConfig().mainAssemblyName);
}
self.onmessage = async (e) => {
  const { name, target } = e.data;
  const t0 = performance.now();
  exportsPromise ??= boot();
  const ex = await exportsPromise;
  const bootMs = Math.round(performance.now() - t0);
  const t1 = performance.now();
  const out = ex.NativeRemesher.Wasm.Host.RunCase(name, target, true);
  self.postMessage({ result: JSON.parse(out), bootMs, wallMs: Math.round(performance.now() - t1) });
};
