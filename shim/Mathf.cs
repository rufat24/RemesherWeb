// Written from Unity's public Mathf documentation. Functions compute in double and cast to float
// (UNVERIFIED against Unity's runtime; see docs/measurements.md experiment E4).
using System;
namespace UnityEngine
{
    public static class Mathf
    {
        public const float PI = 3.14159274F;
        public const float Infinity = float.PositiveInfinity;
        public const float NegativeInfinity = float.NegativeInfinity;
        public const float Deg2Rad = PI * 2F / 360F;
        public const float Rad2Deg = 1F / Deg2Rad;
        public static readonly float Epsilon = float.Epsilon;

        #if SHIM_FLOAT_MATH
        public static float Sin(float f) { return MathF.Sin(f); }
#else
        public static float Sin(float f) => (float)Math.Sin(f);
#endif
        #if SHIM_FLOAT_MATH
        public static float Cos(float f) { return MathF.Cos(f); }
#else
        public static float Cos(float f) => (float)Math.Cos(f);
#endif
        #if SHIM_FLOAT_MATH
        public static float Tan(float f) { return MathF.Tan(f); }
#else
        public static float Tan(float f) => (float)Math.Tan(f);
#endif
        #if SHIM_FLOAT_MATH
        public static float Asin(float f) { return MathF.Asin(f); }
#else
        public static float Asin(float f) => (float)Math.Asin(f);
#endif
        #if SHIM_FLOAT_MATH
        public static float Acos(float f) { return MathF.Acos(f); }
#else
        public static float Acos(float f) => (float)Math.Acos(f);
#endif
        #if SHIM_FLOAT_MATH
        public static float Atan(float f) { return MathF.Atan(f); }
#else
        public static float Atan(float f) => (float)Math.Atan(f);
#endif
        #if SHIM_FLOAT_MATH
        public static float Atan2(float y, float x) { return MathF.Atan2(y, x); }
#else
        public static float Atan2(float y, float x) => (float)Math.Atan2(y, x);
#endif
        #if SHIM_FLOAT_MATH
        public static float Sqrt(float f) { return MathF.Sqrt(f); }
#else
        public static float Sqrt(float f) => (float)Math.Sqrt(f);
#endif
        public static float Abs(float f) => Math.Abs(f);
        public static int Abs(int v) => Math.Abs(v);
        public static float Min(float a, float b) => a < b ? a : b;
        public static float Min(params float[] values)
        {
            int n = values.Length; if (n == 0) return 0F;
            float m = values[0]; for (int i = 1; i < n; i++) if (values[i] < m) m = values[i]; return m;
        }
        public static int Min(int a, int b) => a < b ? a : b;
        public static int Min(params int[] values)
        {
            int n = values.Length; if (n == 0) return 0;
            int m = values[0]; for (int i = 1; i < n; i++) if (values[i] < m) m = values[i]; return m;
        }
        public static float Max(float a, float b) => a > b ? a : b;
        public static float Max(params float[] values)
        {
            int n = values.Length; if (n == 0) return 0F;
            float m = values[0]; for (int i = 1; i < n; i++) if (values[i] > m) m = values[i]; return m;
        }
        public static int Max(int a, int b) => a > b ? a : b;
        public static int Max(params int[] values)
        {
            int n = values.Length; if (n == 0) return 0;
            int m = values[0]; for (int i = 1; i < n; i++) if (values[i] > m) m = values[i]; return m;
        }
        #if SHIM_FLOAT_MATH
        public static float Pow(float f, float p) { return MathF.Pow(f, p); }
#else
        public static float Pow(float f, float p) => (float)Math.Pow(f, p);
#endif
        public static float Exp(float power) => (float)Math.Exp(power);
        public static float Log(float f, float p) => (float)Math.Log(f, p);
        public static float Log(float f) => (float)Math.Log(f);
        public static float Log10(float f) => (float)Math.Log10(f);
        public static float Ceil(float f) => (float)Math.Ceiling(f);
        public static float Floor(float f) => (float)Math.Floor(f);
        public static float Round(float f) => (float)Math.Round(f);
        public static int CeilToInt(float f) => (int)Math.Ceiling(f);
        public static int FloorToInt(float f) => (int)Math.Floor(f);
        public static int RoundToInt(float f) => (int)Math.Round(f);
        public static float Sign(float f) => f >= 0F ? 1F : -1F;
        public static float Clamp(float value, float min, float max)
        {
            if (value < min) value = min; else if (value > max) value = max; return value;
        }
        public static int Clamp(int value, int min, int max)
        {
            if (value < min) value = min; else if (value > max) value = max; return value;
        }
        public static float Clamp01(float value) => value < 0F ? 0F : value > 1F ? 1F : value;
        public static float Lerp(float a, float b, float t) => a + (b - a) * Clamp01(t);
        public static float LerpUnclamped(float a, float b, float t) => a + (b - a) * t;
        public static float LerpAngle(float a, float b, float t)
        {
            float delta = Repeat(b - a, 360F); if (delta > 180F) delta -= 360F; return a + delta * Clamp01(t);
        }
        public static float MoveTowards(float current, float target, float maxDelta)
        {
            if (Abs(target - current) <= maxDelta) return target;
            return current + Sign(target - current) * maxDelta;
        }
        public static float Repeat(float t, float length) => Clamp(t - Floor(t / length) * length, 0F, length);
        public static float PingPong(float t, float length)
        {
            t = Repeat(t, length * 2F); return length - Abs(t - length);
        }
        public static float InverseLerp(float a, float b, float value)
            => a != b ? Clamp01((value - a) / (b - a)) : 0F;
        public static float DeltaAngle(float current, float target)
        {
            float delta = Repeat(target - current, 360F); if (delta > 180F) delta -= 360F; return delta;
        }
        public static float SmoothStep(float from, float to, float t)
        {
            t = Clamp01(t); t = -2F * t * t * t + 3F * t * t; return to * t + from * (1F - t);
        }
        public static bool Approximately(float a, float b)
            => Abs(b - a) < Max(1E-06f * Max(Abs(a), Abs(b)), Epsilon * 8F);
        public static bool IsPowerOfTwo(int value) => (value & (value - 1)) == 0;
        public static int NextPowerOfTwo(int value)
        {
            if (value <= 0) return 1; value--; value |= value >> 1; value |= value >> 2; value |= value >> 4;
            value |= value >> 8; value |= value >> 16; return value + 1;
        }
    }
}
