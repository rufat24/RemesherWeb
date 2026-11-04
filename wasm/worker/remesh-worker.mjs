// Product worker protocol (one fresh worker per job; cancel = worker.terminate()):
//   in : { type:'start', name?:string, positions:Float64Array, triangles:Int32Array, uvs?:Float64Array, triangleMaterials?:Int32Array, options:object, bake?:{color?:{dims,pixels,triangleImage?},detail?:{dims,pixels,triangleImage?}}, dabs?:Float64Array (x,y,z,radius,strength per dab; the source's own space), parts?:{ranges:Int32Array (firstTriangle,count per part),names:string[],seeThrough:boolean[]} }
//   out: { type:'progress', stage, fraction } (throttled to ~10 Hz) | { type:'result', summary, positions, faceSizes, faceIndices, uvs, faceMaterials, fbx, texture, normalMap, cornerUvs, bootMs }
//        | { type:'error', message }
import { dotnet } from './_framework/dotnet.js';
let last = 0;
globalThis.__remeshProgress = (stage, fraction) => {
  const now = performance.now();
  if (now - last < 100 && fraction < 1) return;
  last = now; self.postMessage({ type: 'progress', stage, fraction });
};
self.onmessage = async (e) => {
  if (e.data.type !== 'start') return;
  try {
    const t0 = performance.now();
    const rt = await dotnet.withDiagnosticTracing(false).create();
    const ex = (await rt.getAssemblyExports(rt.getConfig().mainAssemblyName)).NativeRemesher.Wasm.Host;
    const bootMs = Math.round(performance.now() - t0);
    const d = e.data;
    // The source's textures for the bakes: { color?: {dims, pixels, triangleImage?}, detail?: {...} } (pixels are RGBA, top row first)
    for (const kind of ['color', 'detail']) { const b = d.bake?.[kind]; if (b) ex.SetBakeImages(kind, b.dims, b.pixels, b.triangleImage ?? null); }
    const summary = JSON.parse(ex.Remesh(d.positions, d.triangles, d.uvs ?? null, d.triangleMaterials ?? null, JSON.stringify(d.options ?? {}), d.dabs ?? null, d.parts?.ranges ?? null, d.parts ? JSON.stringify({ names: d.parts.names, seeThrough: d.parts.seeThrough }) : null));
    const out = { type: 'result', summary, bootMs,
      positions: Float64Array.from(ex.ResultPositions()), faceSizes: Int32Array.from(ex.ResultFaceSizes()), faceIndices: Int32Array.from(ex.ResultFaceIndices()),
      uvs: summary.hasUvs ? Float64Array.from(ex.ResultUvs()) : null, faceMaterials: ex.ResultFaceMaterials() ? Int32Array.from(ex.ResultFaceMaterials()) : null,
      fbx: Uint8Array.from(ex.ResultFbx(d.name ?? 'remeshed')),
      texture: summary.textureSize ? Uint8Array.from(ex.ResultTexture()) : null, normalMap: summary.normalMapSize ? Uint8Array.from(ex.ResultNormalMap()) : null,
      cornerUvs: summary.hasCornerUvs ? Float64Array.from(ex.ResultCornerUvs()) : null };
    self.postMessage(out);
  } catch (err) { self.postMessage({ type: 'error', message: String(err && err.message || err) }); }
};
