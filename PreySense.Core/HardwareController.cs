using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;
using LibreHardwareMonitor.Hardware;
using PreySense.Battery;
using PreySense.Gpu;
using PreySense.Helpers;
using PreySense.Mode;

namespace PreySense
{
    [SupportedOSPlatform("windows")]
    public class HardwareController : IHardwareController
    {
        private readonly WmiController _wmi;
        private readonly NvidiaGpuControl? _gpu;
        private readonly Computer _lhm;
        private bool _lhmOpened;
        private float? _lhmCpuPower;
        private PerformanceCounter? _cpuPerfCounter;

        public bool Initialized { get; }

        public string DeviceName { get; }
        public string SerialNumber { get; }

        public HardwareController()
        {
            _wmi = new WmiController();
            _lhm = new Computer
            {
                IsCpuEnabled = true,
                IsGpuEnabled = false,
                IsMemoryEnabled = false,
                IsMotherboardEnabled = false,
                IsControllerEnabled = false,
                IsNetworkEnabled = false,
                IsStorageEnabled = false
            };

            try
            {
                _lhm.Open();
                _lhmOpened = true;
            }
            catch
            {
                _lhmOpened = false;
            }

            try
            {
                _gpu = new NvidiaGpuControl();
            }
            catch
            {
                _gpu = null;
            }

            try
            {
                _cpuPerfCounter = new PerformanceCounter("Processor", "% Processor Time", "_Total");
                _cpuPerfCounter.NextValue(); // warm up — first read always returns 0
            }
            catch
            {
                _cpuPerfCounter = null;
            }

            (DeviceName, SerialNumber) = ReadDeviceInfo();
            Initialized = true;
        }

        public TelemetryData ReadTelemetry()
        {
            _wmi.RefreshAcerService();

            var cpuTemp = _wmi.CpuTemp;
            var gpuTemp = _wmi.GpuTemp;
            var cpuFanRpm = _wmi.CpuFanRpm;
            var gpuFanRpm = _wmi.GpuFanRpm;

            TryGetAcConnected(out var onAc);

            UpdateLhmCpuPower();
            var lhmCpuTemp = ReadLhmCpuTemp();

            var gpuPower = _gpu?.GetGpuPower();

            var cpuUsage = ReadCpuUsage();

            return new TelemetryData
            {
                CpuTemp = cpuTemp > 0 ? cpuTemp : lhmCpuTemp,
                GpuTemp = gpuTemp,
                CpuFanRpm = cpuFanRpm,
                GpuFanRpm = gpuFanRpm,
                Watt = Math.Max(_lhmCpuPower ?? 0, gpuPower ?? 0),
                CpuUsage = cpuUsage,
                GpuUsage = 0,
                OnAc = onAc,
                BatteryPercent = ReadBatteryPercent()
            };
        }

        private float ReadLhmCpuTemp()
        {
            if (!_lhmOpened) return 0;
            foreach (var hardware in _lhm.Hardware)
            {
                hardware.Update();
                foreach (var sensor in hardware.Sensors)
                {
                    if (sensor.SensorType == SensorType.Temperature && sensor.Value.HasValue)
                        return sensor.Value.Value;
                }
            }
            return 0;
        }

        public bool TryGetAcConnected(out bool onAc) => _wmi.TryGetAcConnected(out onAc);

        public bool SetPowerMode(byte mode) => _wmi.SetPowerMode(mode);

        public bool TryGetPowerProfile(out byte mode) => _wmi.TryGetPowerProfile(out mode);

        public bool SetFanControl(int mode, int cpuSpeed = 50, int gpuSpeed = 50)
            => _wmi.SetFanControl(mode, cpuSpeed, gpuSpeed);

        public bool TryGetFanSpeeds(out int cpuRpm, out int gpuRpm)
        {
            cpuRpm = _wmi.CpuFanRpm;
            gpuRpm = _wmi.GpuFanRpm;
            return cpuRpm > 0 || gpuRpm > 0;
        }

        public FanStatus GetFanStatus()
        {
            return new FanStatus
            {
                CpuSpeed = 50,
                GpuSpeed = 50,
                CpuRpm = _wmi.CpuFanRpm,
                GpuRpm = _wmi.GpuFanRpm,
                Mode = 0
            };
        }

        public void SetRgbMode(int mode, byte r, byte g, byte b, byte brightness, byte speed, byte direction)
            => _wmi.SetRgbMode(mode, r, g, b, brightness, speed, direction);

        public void SetRgbZone(int zone, byte r, byte g, byte b)
        {
            var colors = (Color[])_wmi.ZoneColors.Clone();
            var oldColor = colors[zone];
            colors[zone] = Color.FromArgb(r, g, b);
            var diagPath = Path.Combine(Path.GetTempPath(), "preysense-zone.log");
            try { File.AppendAllText(diagPath, $"[{DateTime.Now:HH:mm:ss.fff}] SetRgbZone(zone={zone}, r={r}, g={g}, b={b}) | old=[{oldColor.R},{oldColor.G},{oldColor.B}] | new=[{r},{g},{b}] | final array=[{colors[0].R},{colors[0].G},{colors[0].B}] [{colors[1].R},{colors[1].G},{colors[1].B}] [{colors[2].R},{colors[2].G},{colors[2].B}] [{colors[3].R},{colors[3].G},{colors[3].B}]{Environment.NewLine}"); }
            catch { }
            _wmi.SetZoneColors(colors, _wmi.Brightness);
        }

        public LightingState GetLightingState()
        {
            return new LightingState
            {
                Mode = 0,
                R = _wmi.LastR,
                G = _wmi.LastG,
                B = _wmi.LastB,
                Brightness = _wmi.Brightness,
                Speed = _wmi.Speed,
                Direction = 1,
                ZoneColors = []
            };
        }

        public GpuClocks GetGpuClocks()
        {
            if (_gpu == null || !_gpu.GetClocks(out var core, out var memory))
                return new GpuClocks();
            return new GpuClocks
            {
                CoreOffset = core,
                MemoryOffset = memory,
                CoreCurrent = 0,
                MemoryCurrent = 0,
                CoreMax = NvidiaGpuControl.MaxCoreOffset,
                MemoryMax = NvidiaGpuControl.MaxMemoryOffset
            };
        }

        public int SetGpuClocks(int coreOffset, int memoryOffset)
            => _gpu?.SetClocks(coreOffset, memoryOffset) ?? -1;

        public string DescribeGpuPerformanceStates()
            => _gpu?.DescribePerformanceStates() ?? "No GPU control available";

        public bool TryGetBatteryLimit(out int mode)
        {
            mode = BatteryControl.GetBatteryLimit();
            return true;
        }

        public bool SetBatteryLimit(int mode)
            => BatteryControl.SetBatteryLimit(_wmi, mode);

        public bool ApplyDisplayProfile(int brightness, int contrast, double gamma, int saturation)
        {
            try
            {
                var profile = new DisplayColorProfile
                {
                    BrightnessR = brightness,
                    BrightnessG = brightness,
                    BrightnessB = brightness,
                    ContrastR = contrast,
                    ContrastG = contrast,
                    ContrastB = contrast,
                    GammaR = gamma,
                    GammaG = gamma,
                    GammaB = gamma,
                    Saturation = saturation
                };
                DisplayManager.ApplyProfile(profile);
                return true;
            }
            catch
            {
                return false;
            }
        }

        public void SetCpuPowerLimits(int pl1, int pl2, int tau = 28)
            => PowerLimitController.SetCpuPowerLimits(pl1, pl2, tau > 0);

        public bool SetCpuBoost(int mode)
        {
            PowerLimitController.SetCpuBoost(mode);
            return true;
        }

        public bool ApplyProfile(string modeName)
        {
            try
            {
                ProfileManager.ApplyProfileAsync(modeName, _wmi).ConfigureAwait(false).GetAwaiter().GetResult();
                return true;
            }
            catch
            {
                return false;
            }
        }

        public void Dispose()
        {
            _wmi.Dispose();
            _gpu?.Dispose();
            if (_lhmOpened)
            {
                try { _lhm.Close(); } catch { }
            }
        }

        private void UpdateLhmCpuPower()
        {
            if (!_lhmOpened) return;
            _lhmCpuPower = null;
            foreach (var hardware in _lhm.Hardware)
            {
                hardware.Update();
                foreach (var sensor in hardware.Sensors)
                {
                    if (sensor.SensorType == SensorType.Power && sensor.Value.HasValue)
                    {
                        _lhmCpuPower = sensor.Value;
                        return;
                    }
                }
            }
        }

        private int ReadCpuUsage()
        {
            if (_cpuPerfCounter == null) return 0;
            try { return (int)Math.Round(_cpuPerfCounter.NextValue()); }
            catch { return 0; }
        }

        [DllImport("kernel32.dll")]
        private static extern bool GetSystemPowerStatus(out SYSTEM_POWER_STATUS lpSystemPowerStatus);

        [StructLayout(LayoutKind.Sequential)]
        private struct SYSTEM_POWER_STATUS
        {
            public byte ACLineStatus;
            public byte BatteryFlag;
            public byte BatteryLifePercent;
            public byte Reserved1;
            public int BatteryLifeTime;
            public int BatteryFullLifeTime;
        }

        private static int ReadBatteryPercent()
        {
            if (GetSystemPowerStatus(out var status))
                return status.BatteryLifePercent;
            return 0;
        }

        private static (string name, string serial) ReadDeviceInfo()
        {
            try
            {
                using var key = Microsoft.Win32.Registry.LocalMachine.OpenSubKey(@"HARDWARE\DESCRIPTION\System\BIOS");
                var name = key?.GetValue("SystemFamily")?.ToString() ?? "Predator Helios";
                var serial = key?.GetValue("SystemSerialNumber")?.ToString() ?? "N/A";
                return (name, serial);
            }
            catch
            {
                return ("Predator Helios", "N/A");
            }
        }
    }
}
