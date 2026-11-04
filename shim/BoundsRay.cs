using System;
namespace UnityEngine
{
    [Serializable]
    public struct Bounds : IEquatable<Bounds>
    {
        Vector3 m_Center, m_Extents;
        public Bounds(Vector3 center, Vector3 size) { m_Center = center; m_Extents = size * 0.5F; }
        public Vector3 center { get => m_Center; set => m_Center = value; }
        public Vector3 size { get => m_Extents * 2F; set => m_Extents = value * 0.5F; }
        public Vector3 extents { get => m_Extents; set => m_Extents = value; }
        public Vector3 min { get => center - extents; set => SetMinMax(value, max); }
        public Vector3 max { get => center + extents; set => SetMinMax(min, value); }
        public void SetMinMax(Vector3 min, Vector3 max) { extents = (max - min) * 0.5F; center = min + extents; }
        public void Encapsulate(Vector3 point) => SetMinMax(Vector3.Min(min, point), Vector3.Max(max, point));
        public void Encapsulate(Bounds bounds) { Encapsulate(bounds.center - bounds.extents); Encapsulate(bounds.center + bounds.extents); }
        public void Expand(float amount) { amount *= .5F; extents += new Vector3(amount, amount, amount); }
        public void Expand(Vector3 amount) { extents += amount * .5F; }
        public bool Contains(Vector3 point)
            => point.x >= min.x && point.x <= max.x && point.y >= min.y && point.y <= max.y && point.z >= min.z && point.z <= max.z;
        public bool Intersects(Bounds bounds)
            => min.x <= bounds.max.x && max.x >= bounds.min.x && min.y <= bounds.max.y && max.y >= bounds.min.y && min.z <= bounds.max.z && max.z >= bounds.min.z;
        public float SqrDistance(Vector3 point)
        {
            Vector3 mn = min, mx = max; float sq = 0F;
            for (int i = 0; i < 3; i++)
            {
                if (point[i] < mn[i]) { float d = point[i] - mn[i]; sq += d * d; }
                else if (point[i] > mx[i]) { float d = point[i] - mx[i]; sq += d * d; }
            }
            return sq;
        }
        public Vector3 ClosestPoint(Vector3 point)
        {
            Vector3 mn = min, mx = max;
            return new Vector3(Mathf.Clamp(point.x, mn.x, mx.x), Mathf.Clamp(point.y, mn.y, mx.y), Mathf.Clamp(point.z, mn.z, mx.z));
        }
        public override int GetHashCode() => center.GetHashCode() ^ (extents.GetHashCode() << 2);
        public override bool Equals(object other) => other is Bounds b && Equals(b);
        public bool Equals(Bounds other) => center.Equals(other.center) && extents.Equals(other.extents);
        public static bool operator ==(Bounds lhs, Bounds rhs) => lhs.center == rhs.center && lhs.extents == rhs.extents;
        public static bool operator !=(Bounds lhs, Bounds rhs) => !(lhs == rhs);
    }

    public struct Ray
    {
        Vector3 m_Origin, m_Direction;
        public Ray(Vector3 origin, Vector3 direction) { m_Origin = origin; m_Direction = direction.normalized; }
        public Vector3 origin { get => m_Origin; set => m_Origin = value; }
        public Vector3 direction { get => m_Direction; set => m_Direction = value.normalized; }
        public Vector3 GetPoint(float distance) => m_Origin + m_Direction * distance;
    }
}
