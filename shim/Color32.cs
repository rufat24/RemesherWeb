using System;
namespace UnityEngine
{
    [Serializable]
    public struct Color32 : IEquatable<Color32>
    {
        public byte r, g, b, a;
        public Color32(byte r, byte g, byte b, byte a) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static implicit operator Color32(Color c)
            => new Color32((byte)Mathf.RoundToInt(Mathf.Clamp01(c.r) * 255f), (byte)Mathf.RoundToInt(Mathf.Clamp01(c.g) * 255f),
                           (byte)Mathf.RoundToInt(Mathf.Clamp01(c.b) * 255f), (byte)Mathf.RoundToInt(Mathf.Clamp01(c.a) * 255f));
        public static implicit operator Color(Color32 c) => new Color(c.r / 255f, c.g / 255f, c.b / 255f, c.a / 255f);
        public static Color32 Lerp(Color32 a, Color32 b, float t)
        {
            t = Mathf.Clamp01(t);
            return new Color32((byte)(a.r + (b.r - a.r) * t), (byte)(a.g + (b.g - a.g) * t), (byte)(a.b + (b.b - a.b) * t), (byte)(a.a + (b.a - a.a) * t));
        }
        public bool Equals(Color32 o) => r == o.r && g == o.g && b == o.b && a == o.a;
        public override bool Equals(object o) => o is Color32 c && Equals(c);
        public override int GetHashCode() => (r << 24) | (g << 16) | (b << 8) | a;
        public static bool operator ==(Color32 l, Color32 r) => l.Equals(r);
        public static bool operator !=(Color32 l, Color32 r) => !l.Equals(r);
        public override string ToString() => string.Format("RGBA({0}, {1}, {2}, {3})", r, g, b, a);
    }

    [Serializable]
    public struct Color : IEquatable<Color>
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public Color(float r, float g, float b) { this.r = r; this.g = g; this.b = b; a = 1F; }
        public static Color white => new Color(1F, 1F, 1F, 1F);
        public static Color black => new Color(0F, 0F, 0F, 1F);
        public static Color clear => new Color(0F, 0F, 0F, 0F);
        public static Color red => new Color(1F, 0F, 0F, 1F);
        public static Color green => new Color(0F, 1F, 0F, 1F);
        public static Color blue => new Color(0F, 0F, 1F, 1F);
        public static Color gray => new Color(.5F, .5F, .5F, 1F);
        public static Color Lerp(Color a, Color b, float t) { t = Mathf.Clamp01(t); return new Color(a.r + (b.r - a.r) * t, a.g + (b.g - a.g) * t, a.b + (b.b - a.b) * t, a.a + (b.a - a.a) * t); }
        public bool Equals(Color o) => r == o.r && g == o.g && b == o.b && a == o.a;
        public override bool Equals(object o) => o is Color c && Equals(c);
        public override int GetHashCode() => r.GetHashCode() ^ (g.GetHashCode() << 2) ^ (b.GetHashCode() >> 2) ^ (a.GetHashCode() >> 1);
        public static bool operator ==(Color l, Color r) => l.Equals(r);
        public static bool operator !=(Color l, Color r) => !l.Equals(r);
    }
}
