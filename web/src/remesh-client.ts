import type { QuadMesh, SourceMesh } from './formats/mesh';
import type { toWorkerBake } from './formats/textures';

export interface RemeshSummary { textureSize: number; normalMapSize: number; bakeNote: string; quads: number; tris: number; ngons: number; verts: number; hash: string; totalMs: number; hasUvs: boolean }
export interface RemeshOutcome { mesh: QuadMesh; summary: RemeshSummary; bootMs: number }
export interface RemeshJob { promise: Promise<RemeshOutcome>; cancel(): void }

/** One fresh worker per job: cancelling is worker.terminate(), and a job can never inherit another's statics or heap. */
export function startRemesh(src: SourceMesh, options: Record<string, unknown>, onProgress: (stage: string, fraction: number) => void, name = 'remeshed', dabs?: Float64Array, bake?: { color?: ReturnType<typeof toWorkerBake>; detail?: ReturnType<typeof toWorkerBake> }): RemeshJob {
  const worker = new Worker(new URL('./wasm/remesh-worker.mjs', document.baseURI), { type: 'module' });
  let rejectJob: (e: Error) => void = () => {};
  const promise = new Promise<RemeshOutcome>((resolve, reject) => {
    rejectJob = reject;
    worker.onmessage = (e) => {
      const d = e.data;
      if (d.type === 'progress') onProgress(d.stage, d.fraction);
      else if (d.type === 'error') { worker.terminate(); reject(new Error(d.message)); }
      else if (d.type === 'result') {
        worker.terminate();
        resolve({
          summary: d.summary, bootMs: d.bootMs,
          mesh: { positions: Float32Array.from(d.positions), faceSizes: d.faceSizes, faceIndices: d.faceIndices,
                  uvs: d.uvs ? Float32Array.from(d.uvs) : undefined, faceMaterials: d.faceMaterials ?? undefined, materialNames: src.materialNames, fbx: d.fbx,
                  cornerUvs: d.cornerUvs ? Float32Array.from(d.cornerUvs) : undefined,
                  texture: d.texture ? { size: d.summary.textureSize, rgba: d.texture } : undefined, normalMap: d.normalMap ? { size: d.summary.normalMapSize, rgba: d.normalMap } : undefined },
        });
      }
    };
    worker.onerror = (e) => { worker.terminate(); reject(new Error('worker failed: ' + (e.message || 'unknown'))); };
    worker.postMessage({
      type: 'start', options, name, bake, dabs: dabs && dabs.length ? dabs : undefined,
      positions: Float64Array.from(src.positions), triangles: src.triangles,
      uvs: src.uvs ? Float64Array.from(src.uvs) : undefined, triangleMaterials: src.triangleMaterials,
    }, bake ? [bake.color?.pixels.buffer, bake.detail?.pixels.buffer].filter(Boolean) as ArrayBuffer[] : []);
  });
  return { promise, cancel() { worker.terminate(); rejectJob(new Error('cancelled')); } };
}
