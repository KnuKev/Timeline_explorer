$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url = 'http://127.0.0.1:5173/'

function Show-LauncherError([string]$message) {
  Add-Type -AssemblyName System.Windows.Forms
  [System.Windows.Forms.MessageBox]::Show($message, 'Timeline Kart', 'OK', 'Error') | Out-Null
}

if (-not (Get-Command node.exe -ErrorAction SilentlyContinue)) {
  Show-LauncherError 'Node.js ble ikke funnet. Installer Node.js og prøv igjen.'
  exit 1
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Show-LauncherError "Prosjektpakkene mangler i:`n$root`n`nÅpne en terminal der og kjør npm.cmd install én gang."
  exit 1
}

$serverReady = $false
try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
  $serverReady = $response.StatusCode -eq 200 -and $response.Content.Contains('<div id="root">')
} catch {}

if (-not $serverReady) {
  $listener = Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($listener) {
    Show-LauncherError 'Port 5173 er allerede i bruk av noe annet. Lukk programmet som bruker porten og prøv igjen.'
    exit 1
  }

  $escapedRoot = $root.Replace("'", "''")
  $serverCommand = "Set-Location -LiteralPath '$escapedRoot'; & npm.cmd run dev -- --host 127.0.0.1 --port 5173 --strictPort"
  $encodedCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes($serverCommand))
  $powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  Start-Process -FilePath $powershell -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', $encodedCommand) -WindowStyle Hidden | Out-Null

  for ($attempt = 0; $attempt -lt 40; $attempt++) {
    Start-Sleep -Milliseconds 500
    try {
      $response = Invoke-WebRequest -UseBasicParsing -Uri $url -TimeoutSec 2
      if ($response.StatusCode -eq 200 -and $response.Content.Contains('<div id="root">')) {
        $serverReady = $true
        break
      }
    } catch {}
  }
}

if (-not $serverReady) {
  Show-LauncherError 'Timeline Kart-serveren startet ikke innen 20 sekunder. Prøv igjen, eller sjekk Node.js/npm-installasjonen.'
  exit 1
}

$firefox = Get-Command firefox.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
if (-not $firefox) {
  foreach ($candidate in @('C:\Program Files\Mozilla Firefox\firefox.exe', 'C:\Program Files (x86)\Mozilla Firefox\firefox.exe')) {
    if (Test-Path $candidate) { $firefox = $candidate; break }
  }
}
if ($firefox) {
  Start-Process -FilePath $firefox -ArgumentList @('-new-window', $url)
} else {
  Start-Process $url
}


