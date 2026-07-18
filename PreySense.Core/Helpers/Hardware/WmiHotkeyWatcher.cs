using System.Management;
using System.Runtime.Versioning;

namespace PreySense
{
    [SupportedOSPlatform("windows")]
    public class WmiHotkeyWatcher : IDisposable
    {
        private ManagementEventWatcher? _apgeWatcher;
        private ManagementEventWatcher? _genericWatcher;
        private readonly Action<int> _onHotkeyEvent;
        private bool _isDisposed;
        private static readonly string LogPath = Path.Combine(Path.GetTempPath(), "preysense-hotkey.log");

        public WmiHotkeyWatcher(Action<int> onHotkeyEvent)
        {
            _onHotkeyEvent = onHotkeyEvent ?? throw new ArgumentNullException(nameof(onHotkeyEvent));
            Log($"WmiHotkeyWatcher constructed, starting WMI subscriptions...");
            StartWatching();
        }

        private static void Log(string msg)
        {
            try { File.AppendAllText(LogPath, $"[{DateTime.Now:HH:mm:ss.fff}] {msg}{Environment.NewLine}"); }
            catch { }
        }

        private void StartWatching()
        {
            try
            {
                var scope = new ManagementScope(@"\\.\root\wmi");
                scope.Connect();
                Log("Connected to root\\wmi for APGeEvent");
                var query = new EventQuery("SELECT * FROM APGeEvent");
                _apgeWatcher = new ManagementEventWatcher(scope, query);
                _apgeWatcher.EventArrived += WmiEventArrived;
                _apgeWatcher.Start();
                Log("APGeEvent watcher STARTED successfully");
            }
            catch (Exception ex)
            {
                Log($"APGeEvent watcher FAILED: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"Failed to start APGeEvent watcher: {ex.Message}");
            }

            try
            {
                var scope = new ManagementScope(@"\\.\root\wmi");
                scope.Connect();
                Log("Connected to root\\wmi for AcerGenericEvent");
                var query = new EventQuery("SELECT * FROM AcerGenericEvent");
                _genericWatcher = new ManagementEventWatcher(scope, query);
                _genericWatcher.EventArrived += WmiEventArrived;
                _genericWatcher.Start();
                Log("AcerGenericEvent watcher STARTED successfully");
            }
            catch (Exception ex)
            {
                Log($"AcerGenericEvent watcher FAILED: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"Failed to start AcerGenericEvent watcher: {ex.Message}");
            }
        }

        private void WmiEventArrived(object sender, EventArrivedEventArgs e)
        {
            if (_isDisposed) return;

            try
            {
                var eventObj = e.NewEvent;
                if (eventObj == null) return;

                var classProp = eventObj.ClassPath?.ClassName ?? "?";
                var detailProp = eventObj.Properties["EventDetail"];
                if (detailProp != null && detailProp.Value != null)
                {
                    int eventDetail = Convert.ToInt32(detailProp.Value);
                    Log($"WMI EVENT: class={classProp} EventDetail={eventDetail}");
                    _onHotkeyEvent(eventDetail);
                }
                else
                {
                    Log($"WMI EVENT: class={classProp} but EventDetail was null");
                }
            }
            catch (Exception ex)
            {
                Log($"WMI EVENT handler error: {ex.Message}");
                System.Diagnostics.Debug.WriteLine($"Error handling WMI hotkey event: {ex.Message}");
            }
        }

        public void Dispose()
        {
            if (_isDisposed) return;
            _isDisposed = true;

            if (_apgeWatcher != null)
            {
                try { _apgeWatcher.Stop(); _apgeWatcher.Dispose(); } catch { }
            }
            if (_genericWatcher != null)
            {
                try { _genericWatcher.Stop(); _genericWatcher.Dispose(); } catch { }
            }
        }
    }
}
