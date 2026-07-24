using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace PreySense.Host.Services;

[SupportedOSPlatform("windows")]
internal sealed class LowLevelKeyboardHook : IDisposable
{
    private const int WH_KEYBOARD_LL = 13;
    private const int WM_KEYDOWN = 0x0100;
    private const int WM_SYSKEYDOWN = 0x0104;
    private const int WM_KEYUP = 0x0101;
    private const int WM_SYSKEYUP = 0x0105;
    private const uint SC_PREDATOR = 0x75;

    private readonly Action _onPredatorKey;
    private Thread? _hookThread;
    private IntPtr _hookId = IntPtr.Zero;
    private bool _isDisposed;
    private static readonly string LogPath = Path.Combine(Path.GetTempPath(), "preysense-hotkey.log");
    private static readonly object _logLock = new();

    public LowLevelKeyboardHook(Action onPredatorKey)
    {
        _onPredatorKey = onPredatorKey ?? throw new ArgumentNullException(nameof(onPredatorKey));

        Log("LowLevelKeyboardHook: creating STA thread for WH_KEYBOARD_LL");

        _hookThread = new Thread(HookThreadProc)
        {
            Name = "KeyboardHook",
            IsBackground = true
        };
        _hookThread.SetApartmentState(ApartmentState.STA);
        _hookThread.Start();
    }

    private void HookThreadProc()
    {
        Log("LowLevelKeyboardHook: thread started, installing hook...");

        LowLevelKeyboardProc proc = HookCallback;
        _hookId = SetWindowsHookEx(WH_KEYBOARD_LL, proc,
            Marshal.GetHINSTANCE(typeof(LowLevelKeyboardHook).Module), 0);

        if (_hookId == IntPtr.Zero)
        {
            int error = Marshal.GetLastWin32Error();
            Log($"LowLevelKeyboardHook: SetWindowsHookEx FAILED (error={error})");
            return;
        }

        Log($"LowLevelKeyboardHook: hook installed (hookId=0x{_hookId:X8}), entering message pump");

        while (GetMessageW(out MSG msg, IntPtr.Zero, 0, 0) > 0)
        {
            TranslateMessage(ref msg);
            DispatchMessageW(ref msg);
        }

        Log("LowLevelKeyboardHook: message pump exited, cleaning up hook");

        if (_hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }
    }

    private IntPtr HookCallback(int nCode, IntPtr wParam, IntPtr lParam)
    {
        if (nCode >= 0 && !_isDisposed)
        {
            var hookStruct = (KBDLLHOOKSTRUCT)Marshal.PtrToStructure(lParam, typeof(KBDLLHOOKSTRUCT))!;
            bool isKeyDown = wParam == (IntPtr)WM_KEYDOWN || wParam == (IntPtr)WM_SYSKEYDOWN;
            bool isKeyUp = wParam == (IntPtr)WM_KEYUP || wParam == (IntPtr)WM_SYSKEYUP;

            if (isKeyDown || isKeyUp)
            {
                Log($"SCANCODE: vkCode=0x{hookStruct.vkCode:X4} scanCode=0x{hookStruct.scanCode:X4} " +
                    $"flags=0x{hookStruct.flags:X4} direction={(isKeyDown ? "DOWN" : "UP")}");

                if (hookStruct.scanCode == SC_PREDATOR && isKeyUp)
                {
                    Log("LowLevelKeyboardHook: PREDATOR KEY DETECTED (scanCode=0x75)");
                    _onPredatorKey();
                    return (IntPtr)1;
                }
            }
        }

        return CallNextHookEx(_hookId, nCode, wParam, lParam);
    }

    private static void Log(string msg)
    {
        lock (_logLock)
        {
            try { File.AppendAllText(LogPath, $"[{DateTime.Now:HH:mm:ss.fff}] KBHOOK: {msg}{Environment.NewLine}"); }
            catch { }
        }
    }

    public void Dispose()
    {
        if (_isDisposed) return;
        _isDisposed = true;

        Log("LowLevelKeyboardHook: disposing");

        if (_hookId != IntPtr.Zero)
        {
            UnhookWindowsHookEx(_hookId);
            _hookId = IntPtr.Zero;
        }

        _hookThread = null;
    }

    private delegate IntPtr LowLevelKeyboardProc(int nCode, IntPtr wParam, IntPtr lParam);

    [StructLayout(LayoutKind.Sequential)]
    private struct KBDLLHOOKSTRUCT
    {
        public uint vkCode;
        public uint scanCode;
        public uint flags;
        public uint time;
        public IntPtr dwExtraInfo;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MSG
    {
        public IntPtr hwnd;
        public uint message;
        public IntPtr wParam;
        public IntPtr lParam;
        public uint time;
        public int ptX;
        public int ptY;
    }

    [DllImport("user32.dll", CharSet = CharSet.Auto, SetLastError = true)]
    private static extern IntPtr SetWindowsHookEx(int idHook, LowLevelKeyboardProc lpfn, IntPtr hMod, uint dwThreadId);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool UnhookWindowsHookEx(IntPtr hhk);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CallNextHookEx(IntPtr hhk, int nCode, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern int GetMessageW(out MSG lpMsg, IntPtr hWnd, uint wMsgFilterMin, uint wMsgFilterMax);

    [DllImport("user32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool TranslateMessage(ref MSG lpMsg);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr DispatchMessageW(ref MSG lpMsg);
}
