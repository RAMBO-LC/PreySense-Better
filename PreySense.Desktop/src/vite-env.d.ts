/// <reference types="vite/client" />

interface Window {
  preySense: {
    send: (method: string, params?: Record<string, unknown>) => Promise<unknown>
    getTelemetry: () => Promise<{
      cpuTemp: number
      gpuTemp: number
      cpuFanRpm: number
      gpuFanRpm: number
      watt: number
      cpuUsage: number
      gpuUsage: number
      onAc: boolean
      batteryPercent: number
    }>
    getDeviceInfo: () => Promise<{
      name: string
      serial: string
    }>
    onEvent: (callback: (payload: { name: string; data: Record<string, unknown> }) => void) => () => void
  }
}
