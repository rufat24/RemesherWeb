using System;
namespace UnityEngine
{
    [Serializable]
    public struct Matrix4x4 : IEquatable<Matrix4x4>
    {
        public float m00, m10, m20, m30, m01, m11, m21, m31, m02, m12, m22, m32, m03, m13, m23, m33;
        public Matrix4x4(Vector4 column0, Vector4 column1, Vector4 column2, Vector4 column3)
        {
            m00 = column0.x; m01 = column1.x; m02 = column2.x; m03 = column3.x;
            m10 = column0.y; m11 = column1.y; m12 = column2.y; m13 = column3.y;
            m20 = column0.z; m21 = column1.z; m22 = column2.z; m23 = column3.z;
            m30 = column0.w; m31 = column1.w; m32 = column2.w; m33 = column3.w;
        }
        public float this[int row, int column]
        {
            get => this[row + column * 4];
            set => this[row + column * 4] = value;
        }
        public float this[int index]
        {
            get
            {
                switch (index)
                {
                    case 0: return m00; case 1: return m10; case 2: return m20; case 3: return m30;
                    case 4: return m01; case 5: return m11; case 6: return m21; case 7: return m31;
                    case 8: return m02; case 9: return m12; case 10: return m22; case 11: return m32;
                    case 12: return m03; case 13: return m13; case 14: return m23; case 15: return m33;
                    default: throw new IndexOutOfRangeException("Invalid matrix index!");
                }
            }
            set
            {
                switch (index)
                {
                    case 0: m00 = value; break; case 1: m10 = value; break; case 2: m20 = value; break; case 3: m30 = value; break;
                    case 4: m01 = value; break; case 5: m11 = value; break; case 6: m21 = value; break; case 7: m31 = value; break;
                    case 8: m02 = value; break; case 9: m12 = value; break; case 10: m22 = value; break; case 11: m32 = value; break;
                    case 12: m03 = value; break; case 13: m13 = value; break; case 14: m23 = value; break; case 15: m33 = value; break;
                    default: throw new IndexOutOfRangeException("Invalid matrix index!");
                }
            }
        }
        public static Matrix4x4 zero => new Matrix4x4();
        public static Matrix4x4 identity => new Matrix4x4 { m00 = 1F, m11 = 1F, m22 = 1F, m33 = 1F };
        public Vector4 GetColumn(int index) => new Vector4(this[0, index], this[1, index], this[2, index], this[3, index]);
        public Vector4 GetRow(int index) => new Vector4(this[index, 0], this[index, 1], this[index, 2], this[index, 3]);
        public void SetColumn(int index, Vector4 column) { this[0, index] = column.x; this[1, index] = column.y; this[2, index] = column.z; this[3, index] = column.w; }
        public void SetRow(int index, Vector4 row) { this[index, 0] = row.x; this[index, 1] = row.y; this[index, 2] = row.z; this[index, 3] = row.w; }
        public Vector3 MultiplyPoint(Vector3 point)
        {
            Vector3 res;
            res.x = m00 * point.x + m01 * point.y + m02 * point.z + m03;
            res.y = m10 * point.x + m11 * point.y + m12 * point.z + m13;
            res.z = m20 * point.x + m21 * point.y + m22 * point.z + m23;
            float num = m30 * point.x + m31 * point.y + m32 * point.z + m33;
            num = 1F / num;
            res.x *= num; res.y *= num; res.z *= num;
            return res;
        }
        public Vector3 MultiplyPoint3x4(Vector3 point)
            => new Vector3(m00 * point.x + m01 * point.y + m02 * point.z + m03,
                           m10 * point.x + m11 * point.y + m12 * point.z + m13,
                           m20 * point.x + m21 * point.y + m22 * point.z + m23);
        public Vector3 MultiplyVector(Vector3 vector)
            => new Vector3(m00 * vector.x + m01 * vector.y + m02 * vector.z,
                           m10 * vector.x + m11 * vector.y + m12 * vector.z,
                           m20 * vector.x + m21 * vector.y + m22 * vector.z);
        public static Matrix4x4 operator *(Matrix4x4 lhs, Matrix4x4 rhs)
        {
            Matrix4x4 res = new Matrix4x4();
            for (int r = 0; r < 4; r++)
                for (int c = 0; c < 4; c++)
                {
                    float s = 0F;
                    for (int k = 0; k < 4; k++) s += lhs[r, k] * rhs[k, c];
                    res[r, c] = s;
                }
            return res;
        }
        public static Vector4 operator *(Matrix4x4 lhs, Vector4 vector)
            => new Vector4(lhs.m00 * vector.x + lhs.m01 * vector.y + lhs.m02 * vector.z + lhs.m03 * vector.w,
                           lhs.m10 * vector.x + lhs.m11 * vector.y + lhs.m12 * vector.z + lhs.m13 * vector.w,
                           lhs.m20 * vector.x + lhs.m21 * vector.y + lhs.m22 * vector.z + lhs.m23 * vector.w,
                           lhs.m30 * vector.x + lhs.m31 * vector.y + lhs.m32 * vector.z + lhs.m33 * vector.w);
        public static bool operator ==(Matrix4x4 lhs, Matrix4x4 rhs)
            => lhs.GetColumn(0) == rhs.GetColumn(0) && lhs.GetColumn(1) == rhs.GetColumn(1) && lhs.GetColumn(2) == rhs.GetColumn(2) && lhs.GetColumn(3) == rhs.GetColumn(3);
        public static bool operator !=(Matrix4x4 lhs, Matrix4x4 rhs) => !(lhs == rhs);
        public Matrix4x4 transpose { get { var m = new Matrix4x4(); for (int r = 0; r < 4; r++) for (int c = 0; c < 4; c++) m[r, c] = this[c, r]; return m; } }
        public float determinant
        {
            get
            {
                double a = m00, b = m01, c = m02, d = m03, e = m10, f = m11, g = m12, h = m13, i = m20, j = m21, k = m22, l = m23, m = m30, n = m31, o = m32, p = m33;
                double kp_lo = k * p - l * o, jp_ln = j * p - l * n, jo_kn = j * o - k * n, ip_lm = i * p - l * m, io_km = i * o - k * m, in_jm = i * n - j * m;
                return (float)(a * (f * kp_lo - g * jp_ln + h * jo_kn) - b * (e * kp_lo - g * ip_lm + h * io_km)
                             + c * (e * jp_ln - f * ip_lm + h * in_jm) - d * (e * jo_kn - f * io_km + g * in_jm));
            }
        }
        public Matrix4x4 inverse
        {
            get
            {
                var r = new Matrix4x4();
                Invert(this, out r);
                return r;
            }
        }
        public bool isIdentity => this == identity;
        public static Matrix4x4 Inverse(Matrix4x4 m) => m.inverse;
        public static Matrix4x4 Transpose(Matrix4x4 m) => m.transpose;
        public static bool Inverse3DAffine(Matrix4x4 input, ref Matrix4x4 result) { return Invert(input, out result); }
        // Gauss-Jordan in double; returns zero matrix when singular, as Unity does.
        static bool Invert(Matrix4x4 src, out Matrix4x4 dst)
        {
            var a = new double[4, 8];
            for (int r = 0; r < 4; r++) { for (int c = 0; c < 4; c++) a[r, c] = src[r, c]; a[r, 4 + r] = 1.0; }
            for (int col = 0; col < 4; col++)
            {
                int piv = col; double best = Math.Abs(a[col, col]);
                for (int r = col + 1; r < 4; r++) if (Math.Abs(a[r, col]) > best) { best = Math.Abs(a[r, col]); piv = r; }
                if (best == 0.0) { dst = zero; return false; }
                if (piv != col) for (int c = 0; c < 8; c++) { double t = a[col, c]; a[col, c] = a[piv, c]; a[piv, c] = t; }
                double inv = 1.0 / a[col, col];
                for (int c = 0; c < 8; c++) a[col, c] *= inv;
                for (int r = 0; r < 4; r++)
                {
                    if (r == col) continue;
                    double f = a[r, col]; if (f == 0.0) continue;
                    for (int c = 0; c < 8; c++) a[r, c] -= f * a[col, c];
                }
            }
            dst = new Matrix4x4();
            for (int r = 0; r < 4; r++) for (int c = 0; c < 4; c++) dst[r, c] = (float)a[r, 4 + c];
            return true;
        }
        public static Matrix4x4 Translate(Vector3 vector)
        {
            var m = identity; m.m03 = vector.x; m.m13 = vector.y; m.m23 = vector.z; return m;
        }
        public static Matrix4x4 Scale(Vector3 vector)
        {
            var m = identity; m.m00 = vector.x; m.m11 = vector.y; m.m22 = vector.z; return m;
        }
        public static Matrix4x4 Rotate(Quaternion q)
        {
            float x = q.x * 2F, y = q.y * 2F, z = q.z * 2F;
            float xx = q.x * x, yy = q.y * y, zz = q.z * z, xy = q.x * y, xz = q.x * z, yz = q.y * z, wx = q.w * x, wy = q.w * y, wz = q.w * z;
            var m = identity;
            m.m00 = 1F - (yy + zz); m.m10 = xy + wz; m.m20 = xz - wy;
            m.m01 = xy - wz; m.m11 = 1F - (xx + zz); m.m21 = yz + wx;
            m.m02 = xz + wy; m.m12 = yz - wx; m.m22 = 1F - (xx + yy);
            return m;
        }
        public static Matrix4x4 TRS(Vector3 pos, Quaternion q, Vector3 s) => Translate(pos) * Rotate(q) * Scale(s);
        public Vector3 lossyScale => new Vector3(GetColumn(0).magnitude, GetColumn(1).magnitude, GetColumn(2).magnitude);
        public bool Equals(Matrix4x4 other) => GetColumn(0).Equals(other.GetColumn(0)) && GetColumn(1).Equals(other.GetColumn(1)) && GetColumn(2).Equals(other.GetColumn(2)) && GetColumn(3).Equals(other.GetColumn(3));
        public override bool Equals(object other) => other is Matrix4x4 m && Equals(m);
        public override int GetHashCode() => GetColumn(0).GetHashCode() ^ (GetColumn(1).GetHashCode() << 2) ^ (GetColumn(2).GetHashCode() >> 2) ^ (GetColumn(3).GetHashCode() >> 1);
    }

    [Serializable]
    public struct Quaternion : IEquatable<Quaternion>
    {
        public float x, y, z, w;
        public Quaternion(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Quaternion identity => new Quaternion(0F, 0F, 0F, 1F);
        // Unity applies Euler angles in Z, X, Y order (documented): q = Y * X * Z.
        public static Quaternion Euler(float x, float y, float z)
            => AngleAxis(y, new Vector3(0, 1, 0)) * AngleAxis(x, new Vector3(1, 0, 0)) * AngleAxis(z, new Vector3(0, 0, 1));
        public static Quaternion Euler(Vector3 e) => Euler(e.x, e.y, e.z);
        public static Quaternion AngleAxis(float angle, Vector3 axis)
        {
            axis = axis.normalized; float h = angle * Mathf.Deg2Rad * 0.5F; float s = Mathf.Sin(h);
            return new Quaternion(axis.x * s, axis.y * s, axis.z * s, Mathf.Cos(h));
        }
        public static Quaternion operator *(Quaternion lhs, Quaternion rhs)
            => new Quaternion(lhs.w * rhs.x + lhs.x * rhs.w + lhs.y * rhs.z - lhs.z * rhs.y,
                              lhs.w * rhs.y + lhs.y * rhs.w + lhs.z * rhs.x - lhs.x * rhs.z,
                              lhs.w * rhs.z + lhs.z * rhs.w + lhs.x * rhs.y - lhs.y * rhs.x,
                              lhs.w * rhs.w - lhs.x * rhs.x - lhs.y * rhs.y - lhs.z * rhs.z);
        public static Vector3 operator *(Quaternion rotation, Vector3 point)
        {
            float x = rotation.x * 2F, y = rotation.y * 2F, z = rotation.z * 2F;
            float xx = rotation.x * x, yy = rotation.y * y, zz = rotation.z * z, xy = rotation.x * y, xz = rotation.x * z, yz = rotation.y * z;
            float wx = rotation.w * x, wy = rotation.w * y, wz = rotation.w * z;
            return new Vector3((1F - (yy + zz)) * point.x + (xy - wz) * point.y + (xz + wy) * point.z,
                               (xy + wz) * point.x + (1F - (xx + zz)) * point.y + (yz - wx) * point.z,
                               (xz - wy) * point.x + (yz + wx) * point.y + (1F - (xx + yy)) * point.z);
        }
        public bool Equals(Quaternion o) => x == o.x && y == o.y && z == o.z && w == o.w;
        public override bool Equals(object o) => o is Quaternion q && Equals(q);
        public override int GetHashCode() => x.GetHashCode() ^ (y.GetHashCode() << 2) ^ (z.GetHashCode() >> 2) ^ (w.GetHashCode() >> 1);
    }
}
