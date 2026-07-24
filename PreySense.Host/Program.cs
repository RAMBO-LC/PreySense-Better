using System.IO.Pipes;
using System.Runtime.Versioning;
using System.Text;
using System.Text.Json;
using PreySense;
using PreySense.Host.Services;

namespace PreySense.Host
{
    [SupportedOSPlatform("windows")]
    internal class Program
    {
        private static readonly string PipeName = "PreySense";
        private static IHardwareController? _hw;
        private static WmiHotkeyWatcher? _hotkeyWatcher;
        private static LowLevelKeyboardHook? _keyboardHook;
        private static readonly object _stdoutLock = new();
        private static StreamWriter? _stdoutWriter;
        private static byte _lastKnownMode = 0x01;
        private static DateTime _lastModeChangeTime = DateTime.MinValue;
        private static bool _isStdio;

        static async Task Main(string[] args)
        {
            Console.WriteLine("PreySense.Host starting...");

            // ── Install / uninstall auto-start for the Electron app ──
            if (args.Length > 0 && args[0] == "--install")
            {
                string? exePath = args.Length > 1 ? args[1] : null;
                if (exePath != null)
                    SetElectronAutoStart(exePath);
                return;
            }
            if (args.Length > 0 && args[0] == "--uninstall")
            {
                RemoveElectronAutoStart();
                return;
            }

            try
            {
                _hw = new HardwareController();
                Console.WriteLine($"Hardware initialized. Device: {_hw.DeviceName}");
                if (_hw.TryGetPowerProfile(out var mode))
                    _lastKnownMode = mode;
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Failed to initialize hardware: {ex.Message}");
                return;
            }

            var cts = new CancellationTokenSource();
            Console.CancelKeyPress += (_, e) =>
            {
                e.Cancel = true;
                cts.Cancel();
            };

            // ── Startup: kill conflicting OEM processes ──
            CloseOemPredatorProcesses();

            // ── WMI hotkey watcher (mode key, etc.) ──
            _hotkeyWatcher = new WmiHotkeyWatcher(OnHotkeyEvent);

            // ── Low-level keyboard hook for Predator key (scan code 0x75) ──
            // This runs on a background STA thread with its own message pump.
            // It logs every scan code to %TEMP%\preysense-hotkey.log for diagnostics.
            _keyboardHook = new LowLevelKeyboardHook(HandlePredatorKey);

            _isStdio = args.Length > 0 && args[0] == "--stdio";
            if (_isStdio)
            {
                await RunStdioAsync(cts.Token);
            }
            else
            {
                await RunPipeAsync(cts.Token);
            }

            _keyboardHook.Dispose();
            _hotkeyWatcher.Dispose();
            _hw.Dispose();
        }

        private static void CloseOemPredatorProcesses()
        {
            string[] oemNames = ["PredatorSense", "SenseOverlay", "PredatorSenseLauncher"];
            int currentPid = Environment.ProcessId;
            foreach (string name in oemNames)
            {
                try
                {
                    foreach (var proc in System.Diagnostics.Process.GetProcessesByName(name))
                    {
                        using (proc)
                        {
                            if (proc.Id == currentPid) continue;
                            DiagLog($"Startup: closing OEM process '{name}' (PID {proc.Id})");
                            if (!proc.CloseMainWindow() || !proc.WaitForExit(1500))
                            {
                                proc.Kill(entireProcessTree: true);
                                DiagLog($"Startup: killed '{name}' (PID {proc.Id})");
                            }
                        }
                    }
                }
                catch (Exception ex)
                {
                    DiagLog($"Startup: failed to close '{name}': {ex.Message}");
                }
            }
        }

        private static void SetElectronAutoStart(string exePath)
        {
            try
            {
                using var key = Microsoft.Win32.Registry.CurrentUser.CreateSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run");
                key.SetValue("PreySense", $"\"{exePath}\" --minimized");
                DiagLog($"Auto-start registry key set for: {exePath}");
            }
            catch (Exception ex)
            {
                DiagLog($"Failed to set auto-start: {ex.Message}");
            }
        }

        private static void RemoveElectronAutoStart()
        {
            try
            {
                using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(
                    @"SOFTWARE\Microsoft\Windows\CurrentVersion\Run", writable: true);
                key?.DeleteValue("PreySense", throwOnMissingValue: false);
                DiagLog("Auto-start registry key removed");
            }
            catch (Exception ex)
            {
                DiagLog($"Failed to remove auto-start: {ex.Message}");
            }
        }

        private static void OnHotkeyEvent(int detail)
        {
            DiagLog($"OnHotkeyEvent called with detail={detail}");
            switch (detail)
            {
                case 5:
                    HandleModeKey();
                    break;
                // ─── Predator-logo key ──────────────────────────────
                // TODO: The WMI EventDetail value for the Predator-logo key
                // has NOT been documented yet. To identify it:
                //   1. Press the physical Predator-logo key while PreySense is running
                //   2. Check the log at %TEMP%\preysense-hotkey.log for:
                //      "UNRECOGNIZED EventDetail=<N> — this may be the Predator-logo key"
                //   3. Once identified, add `case <N>: HandlePredatorKey(); break;` above
                default:
                    DiagLog($"UNRECOGNIZED EventDetail={detail} — this may be the Predator-logo key; " +
                             "add a case in OnHotkeyEvent once identified");
                    break;
            }
        }

        private static void HandleModeKey()
        {
            if ((DateTime.UtcNow - _lastModeChangeTime).TotalSeconds < 2)
            {
                DiagLog($"HandleModeKey: debounce active, skipping");
                return;
            }

            _lastModeChangeTime = DateTime.UtcNow;

            byte nextMode;
            bool onBattery = IsOnBattery();
            DiagLog($"HandleModeKey: onBattery={onBattery} _lastKnownMode=0x{_lastKnownMode:X2}");

            if (onBattery)
            {
                nextMode = _lastKnownMode switch
                {
                    0x06 => 0x01, // Eco -> Balanced
                    0x01 => 0x06, // Balanced -> Eco
                    _ => 0x06
                };
            }
            else
            {
                nextMode = _lastKnownMode switch
                {
                    0x00 => 0x01, // Silent -> Balanced
                    0x01 => 0x04, // Balanced -> Performance
                    0x04 => 0x05, // Performance -> Turbo
                    0x05 => 0x00, // Turbo -> Silent
                    0x06 => 0x01, // Eco -> Balanced
                    _ => 0x01
                };
            }

            string modeName = nextMode switch
            {
                0x00 => "Silent",
                0x04 => "Performance",
                0x05 => "Turbo",
                0x06 => "Eco",
                _ => "Balanced"
            };

            DiagLog($"HandleModeKey: nextMode=0x{nextMode:X2} ({modeName}), calling SetPowerMode...");

            bool applied = _hw!.SetPowerMode(nextMode);
            DiagLog($"SetPowerMode returned {applied}");
            if (applied)
            {
                _lastKnownMode = nextMode;
                DiagLog($"HandleModeKey: PushEvent(modeChanged, mode={nextMode}, modeName={modeName})");
                PushEvent("modeChanged", new { mode = nextMode, modeName });
                DiagLog("PushEvent completed");
            }
        }

        private static void HandlePredatorKey()
        {
            DiagLog("HandlePredatorKey: pushing showApp event to Electron");
            PushEvent("showApp", new { });
            DiagLog("HandlePredatorKey: showApp push completed");
        }

        private static bool IsOnBattery()
        {
            try
            {
                return !_hw!.TryGetAcConnected(out var onAc) || !onAc;
            }
            catch
            {
                return false;
            }
        }

        private static void PushEvent(string name, object data)
        {
            var eventObj = new Dictionary<string, object?>
            {
                ["type"] = "event",
                ["name"] = name,
                ["data"] = data
            };
            string json = JsonSerializer.Serialize(eventObj, JsonHelper.Options);
            DiagLog($"PushEvent: serialized JSON ({json.Length} chars): {json.Substring(0, Math.Min(json.Length, 200))}");

            lock (_stdoutLock)
            {
                if (_stdoutWriter != null)
                {
                    DiagLog("PushEvent: writing to _stdoutWriter");
                    _stdoutWriter.WriteLine(json);
                    _stdoutWriter.Flush();
                    DiagLog("PushEvent: write+flush completed");
                }
                else
                {
                    DiagLog("PushEvent: _stdoutWriter is null, falling back to Console.WriteLine");
                    Console.WriteLine(json);
                    DiagLog("PushEvent: Console.WriteLine completed");
                }
            }
        }

        private static async Task RunPipeAsync(CancellationToken ct)
        {
            while (!ct.IsCancellationRequested)
            {
                try
                {
                    using var server = new NamedPipeServerStream(PipeName, PipeDirection.InOut, 1,
                        PipeTransmissionMode.Message, PipeOptions.Asynchronous);

                    Console.WriteLine("Waiting for pipe connection...");
                    await server.WaitForConnectionAsync(ct);
                    Console.WriteLine("Client connected.");

                    await HandleClientAsync(server, ct);
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Pipe error: {ex.Message}");
                    await Task.Delay(1000, ct);
                }
            }
        }

        private static async Task RunStdioAsync(CancellationToken ct)
        {
            var stdin = Console.OpenStandardInput();
            var stdout = Console.OpenStandardOutput();
            _stdoutWriter = new StreamWriter(stdout, Encoding.UTF8) { AutoFlush = false };

            var buffer = new byte[65536];

            while (!ct.IsCancellationRequested)
            {
                try
                {
                    var read = await stdin.ReadAsync(buffer, 0, buffer.Length, ct);
                    if (read == 0) break;

                    var json = Encoding.UTF8.GetString(buffer, 0, read);
                    var response = await ProcessRequest(json);

                    lock (_stdoutLock)
                    {
                        _stdoutWriter.WriteLine(response);
                        _stdoutWriter.Flush();
                    }
                }
                catch (OperationCanceledException) { break; }
                catch (Exception ex)
                {
                    Console.Error.WriteLine($"Stdio error: {ex.Message}");
                }
            }
        }

        private static async Task HandleClientAsync(NamedPipeServerStream pipe, CancellationToken ct)
        {
            var buffer = new byte[65536];

            try
            {
                while (!ct.IsCancellationRequested && pipe.IsConnected)
                {
                    var read = await pipe.ReadAsync(buffer, 0, buffer.Length, ct);
                    if (read == 0) break;

                    var json = Encoding.UTF8.GetString(buffer, 0, read);
                    var response = await ProcessRequest(json);

                    var responseBytes = Encoding.UTF8.GetBytes(response);
                    await pipe.WriteAsync(responseBytes, 0, responseBytes.Length, ct);
                    await pipe.FlushAsync(ct);
                }
            }
            catch (IOException) { }
            catch (OperationCanceledException) { }
        }

        private static async Task<string> ProcessRequest(string json)
        {
            try
            {
                using var doc = JsonDocument.Parse(json);
                var root = doc.RootElement;

                if (!root.TryGetProperty("method", out var methodEl))
                    return ErrorResponse(-1, "Missing method");

                var method = methodEl.GetString() ?? "";
                var id = root.TryGetProperty("id", out var idEl) ? idEl.GetRawText() : null;

                JsonElement? paramsEl = null;
                if (root.TryGetProperty("params", out var p))
                    paramsEl = p;

                object? result = method switch
                {
                    "ReadTelemetry" => _hw!.ReadTelemetry(),
                    "TryGetAcConnected" => _hw!.TryGetAcConnected(out var ac) ? new { onAc = ac } : null,
                    "SetPowerMode" => HandleSetPowerMode(paramsEl),
                    "GetPowerProfile" => _hw!.TryGetPowerProfile(out var mode) ? new { mode } : null,
                    "SetFanControl" => HandleSetFanControl(paramsEl),
                    "GetFanStatus" => _hw!.GetFanStatus(),
                    "SetRgbMode" => HandleSetRgbMode(paramsEl),
                    "SetRgbZone" => HandleSetRgbZone(paramsEl),
                    "GetLightingState" => _hw!.GetLightingState(),
                    "GetGpuClocks" => _hw!.GetGpuClocks(),
                    "SetGpuClocks" => HandleSetGpuClocks(paramsEl),
                    "GetGpuPerformanceStates" => _hw!.DescribeGpuPerformanceStates(),
                    "GetBatteryLimit" => _hw!.TryGetBatteryLimit(out var bl) ? new { mode = bl } : null,
                    "SetBatteryLimit" => HandleSetBatteryLimit(paramsEl),
                    "ApplyDisplayProfile" => HandleApplyDisplayProfile(paramsEl),
                    "SetCpuPowerLimits" => HandleSetCpuPowerLimits(paramsEl),
                    "SetCpuBoost" => HandleSetCpuBoost(paramsEl),
                    "ApplyProfile" => HandleApplyProfile(paramsEl),
                    "GetDeviceInfo" => new { name = _hw!.DeviceName, serial = _hw!.SerialNumber },
                    "Ping" => "pong",
                    _ => null
                };

                if (result == null && method != "Ping")
                    return ErrorResponse(id, $"Unknown method: {method}");

                var responseObj = new Dictionary<string, object?>
                {
                    ["result"] = result,
                    ["id"] = id
                };
                return JsonSerializer.Serialize(responseObj, JsonHelper.Options);
            }
            catch (Exception ex)
            {
                return ErrorResponse(null, ex.Message);
            }
        }

        private static object? HandleSetPowerMode(JsonElement? p)
        {
            if (p is null) return null;
            var mode = p.Value.GetProperty("mode").GetByte();
            var ok = _hw!.SetPowerMode(mode);
            if (ok) _lastKnownMode = mode;
            return ok;
        }

        private static object? HandleSetFanControl(JsonElement? p)
        {
            if (p is null) return null;
            var mode = p.Value.GetProperty("mode").GetInt32();
            var cpu = p.Value.TryGetProperty("cpuSpeed", out var c) ? c.GetInt32() : 50;
            var gpu = p.Value.TryGetProperty("gpuSpeed", out var g) ? g.GetInt32() : 50;
            return _hw!.SetFanControl(mode, cpu, gpu);
        }

        private static object? HandleSetRgbMode(JsonElement? p)
        {
            if (p is null) return null;
            var mode = p.Value.GetProperty("mode").GetInt32();
            var r = p.Value.GetProperty("r").GetByte();
            var g = p.Value.GetProperty("g").GetByte();
            var b = p.Value.GetProperty("b").GetByte();
            var brightness = p.Value.GetProperty("brightness").GetByte();
            var speed = p.Value.GetProperty("speed").GetByte();
            var direction = p.Value.GetProperty("direction").GetByte();
            _hw!.SetRgbMode(mode, r, g, b, brightness, speed, direction);
            return true;
        }

        private static object? HandleSetRgbZone(JsonElement? p)
        {
            if (p is null) return null;
            var zone = p.Value.GetProperty("zone").GetInt32();
            var r = p.Value.GetProperty("r").GetByte();
            var g = p.Value.GetProperty("g").GetByte();
            var b = p.Value.GetProperty("b").GetByte();
            _hw!.SetRgbZone(zone, r, g, b);
            return true;
        }

        private static object? HandleSetGpuClocks(JsonElement? p)
        {
            if (p is null) return null;
            var core = p.Value.GetProperty("coreOffset").GetInt32();
            var mem = p.Value.GetProperty("memoryOffset").GetInt32();
            return _hw!.SetGpuClocks(core, mem);
        }

        private static object? HandleSetBatteryLimit(JsonElement? p)
        {
            if (p is null) return null;
            var mode = p.Value.GetProperty("mode").GetInt32();
            return _hw!.SetBatteryLimit(mode);
        }

        private static object? HandleApplyDisplayProfile(JsonElement? p)
        {
            if (p is null) return null;
            var brightness = p.Value.GetProperty("brightness").GetInt32();
            var contrast = p.Value.GetProperty("contrast").GetInt32();
            var gamma = p.Value.GetProperty("gamma").GetDouble();
            var saturation = p.Value.GetProperty("saturation").GetInt32();
            return _hw!.ApplyDisplayProfile(brightness, contrast, gamma, saturation);
        }

        private static object? HandleSetCpuPowerLimits(JsonElement? p)
        {
            if (p is null) return null;
            var pl1 = p.Value.GetProperty("pl1").GetInt32();
            var pl2 = p.Value.GetProperty("pl2").GetInt32();
            var tau = p.Value.TryGetProperty("tau", out var t) ? t.GetInt32() : 28;
            _hw!.SetCpuPowerLimits(pl1, pl2, tau);
            return true;
        }

        private static object? HandleSetCpuBoost(JsonElement? p)
        {
            if (p is null) return null;
            var mode = p.Value.GetProperty("mode").GetInt32();
            return _hw!.SetCpuBoost(mode);
        }

        private static object? HandleApplyProfile(JsonElement? p)
        {
            if (p is null) return null;
            var name = p.Value.GetProperty("name").GetString() ?? "";
            return _hw!.ApplyProfile(name);
        }

        private static readonly string DiagLogPath = Path.Combine(Path.GetTempPath(), "preysense-hotkey.log");
        private static void DiagLog(string msg)
        {
            try { File.AppendAllText(DiagLogPath, $"[{DateTime.Now:HH:mm:ss.fff}] HOST: {msg}{Environment.NewLine}"); }
            catch { }
        }

        private static string ErrorResponse(object? id, string message)
        {
            var response = new Dictionary<string, object?>
            {
                ["error"] = message,
                ["id"] = id
            };
            return JsonSerializer.Serialize(response, JsonHelper.Options);
        }
    }

    internal static class JsonHelper
    {
        private static JsonSerializerOptions? _options;
        public static JsonSerializerOptions Options => _options ??= new JsonSerializerOptions
        {
            PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
            WriteIndented = false
        };
    }
}
