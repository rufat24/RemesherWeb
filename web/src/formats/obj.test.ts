import { describe, expect, it } from 'vitest';
import { parseObj, writeObj } from './obj';
import { quadMeshFromUnity, sourceToUnity } from './unity-space';
import { triangulate } from './mesh';

const quadObj = `v 0 0 0\nv 1 0 0\nv 1 1 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 1 1\nvt 0 1\nusemtl a\nf 1/1 2/2 3/3 4/4\n`;

describe('obj', () => {
  it('delivers a quad as two consecutive triangles (the core pairs them back into the quad)', () => {
    const m = parseObj(quadObj);
    expect(Array.from(m.triangles)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(m.uvs).toBeDefined(); expect(m.triangleMaterials).toEqual(Int32Array.from([0, 0]));
  });
  it('duplicates a vertex at a UV seam so uvs stay index-parallel', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nv 1 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nvt 0.5 0.5\nvt 1 1\nf 1/1 2/2 3/3\nf 2/2 4/5 3/4\n');
    expect(m.positions.length / 3).toBe(5); expect(m.uvs!.length).toBe(10);
  });
  it('handles negative indices', () => {
    const m = parseObj('v 0 0 0\nv 1 0 0\nv 0 1 0\nf -3 -2 -1\n');
    expect(Array.from(m.triangles)).toEqual([0, 1, 2]);
  });
  it('write keeps quads and n-gons', () => {
    const txt = writeObj({ positions: new Float32Array(15), faceSizes: Int32Array.from([4, 5]), faceIndices: Int32Array.from([0, 1, 2, 3, 0, 1, 2, 3, 4]) });
    expect(txt).toContain('f 1 2 3 4\n'); expect(txt).toContain('f 1 2 3 4 5\n');
  });
  it('writes then reads back the same triangles and positions', () => {
    const q = { positions: Float32Array.from([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]), faceSizes: Int32Array.from([4]), faceIndices: Int32Array.from([0, 1, 2, 3]) };
    const back = parseObj(writeObj(q));
    expect(Array.from(back.positions)).toEqual(Array.from(q.positions)); expect(Array.from(back.triangles)).toEqual(Array.from(triangulate(q).triangles));
  });
});

describe('unity space', () => {
  it('is an exact involution on positions and winding', () => {
    const q = { positions: Float32Array.from([0.1, 2, 3, -4.5, 5, 6, 7, 8, 9.25]), faceSizes: Int32Array.from([3, 4]), faceIndices: Int32Array.from([0, 1, 2, 0, 1, 2, 3]) };
    const twice = quadMeshFromUnity(quadMeshFromUnity(q));
    expect(Array.from(twice.positions)).toEqual(Array.from(q.positions)); expect(Array.from(twice.faceIndices)).toEqual(Array.from(q.faceIndices));
  });
  it('flips X and reverses winding for triangles', () => {
    const s = sourceToUnity({ positions: Float32Array.from([1, 2, 3, 4, 5, 6, 7, 8, 9]), triangles: Int32Array.from([0, 1, 2]) });
    expect(Array.from(s.positions)).toEqual([-1, 2, 3, -4, 5, 6, -7, 8, 9]); expect(Array.from(s.triangles)).toEqual([0, 2, 1]);
  });
});
