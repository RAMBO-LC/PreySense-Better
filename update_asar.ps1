Get-Process | Where-Object { $_.ProcessName -match 'PreySense|electron|node' } | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 3
Copy-Item -Path 'PreySense.Desktop/release/win-unpacked/resources/app.asar' -Destination 'build_output/win-unpacked/resources/app.asar' -Force
Write-Host "Copied: $((Get-Item 'build_output/win-unpacked/resources/app.asar').Length) bytes"
Remove-Item 'make_ico.ps1' -ErrorAction SilentlyContinue
