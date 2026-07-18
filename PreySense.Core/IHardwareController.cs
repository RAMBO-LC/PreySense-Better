using System.Runtime.Versioning;
using PreySense.Gpu;
using PreySense.Mode;

namespace PreySense
{
    public record TelemetryData
    {
        public float CpuTemp { get; init; }
        public float GpuTemp { get; init; }
        public int CpuFanRpm { get; init; }
        public int GpuFanRpm { get; init; }
        public float Watt { get; init; }
        public int CpuUsage { get; init; }
        public int GpuUsage { get; init; }
        public bool OnAc { get; init; }
        public int BatteryPercent { get; init; }
    }

    public record FanCurvePoint
    {
        public int Temperature { get; init; }
        public int Speed { get; init; }
    }

    public record FanStatus
    {
        public int CpuSpeed { get; init; }
        public int GpuSpeed { get; init; }
        public int CpuRpm { get; init; }
        public int GpuRpm { get; init; }
        public int Mode { get; init; }
    }

    public record LightingState
    {
        public int Mode { get; init; }
        public byte R { get; init; }
        public byte G { get; init; }
        public byte B { get; init; }
        public byte Brightness { get; init; }
        public byte Speed { get; init; }
        public byte Direction { get; init; }
        public (byte R, byte G, byte B)[] ZoneColors { get; init; } = [];
    }

    public record GpuClocks
    {
        public int CoreOffset { get; init; }
        public int MemoryOffset { get; init; }
        public int CoreCurrent { get; init; }
        public int MemoryCurrent { get; init; }
        public int CoreMax { get; init; }
        public int MemoryMax { get; init; }
    }

    [SupportedOSPlatform("windows")]
    public interface IHardwareController : IDisposable
    {
        bool Initialized { get; }

        // Telemetry
        TelemetryData ReadTelemetry();
        bool TryGetAcConnected(out bool onAc);

        // Power mode
        bool SetPowerMode(byte mode);
        bool TryGetPowerProfile(out byte mode);

        // Fans
        bool SetFanControl(int mode, int cpuSpeed = 50, int gpuSpeed = 50);
        bool TryGetFanSpeeds(out int cpuRpm, out int gpuRpm);
        FanStatus GetFanStatus();

        // Lighting / RGB
        void SetRgbMode(int mode, byte r, byte g, byte b, byte brightness, byte speed, byte direction);
        void SetRgbZone(int zone, byte r, byte g, byte b);
        LightingState GetLightingState();

        // GPU
        GpuClocks GetGpuClocks();
        int SetGpuClocks(int coreOffset, int memoryOffset);
        string DescribeGpuPerformanceStates();

        // Battery
        bool TryGetBatteryLimit(out int mode);
        bool SetBatteryLimit(int mode);

        // Display
        bool ApplyDisplayProfile(int brightness, int contrast, double gamma, int saturation);

        // Power limits (CPU)
        void SetCpuPowerLimits(int pl1, int pl2, int tau = 28);
        bool SetCpuBoost(int mode);

        // Profile
        bool ApplyProfile(string modeName);

        // Identity / info
        string DeviceName { get; }
        string SerialNumber { get; }
    }
}
