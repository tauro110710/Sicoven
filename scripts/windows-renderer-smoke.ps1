param(
  [Parameter(Mandatory=$true)][string]$ExecutablePath,
  [Parameter(Mandatory=$true)][string]$Version,
  [int]$Port = 9222,
  [int]$TimeoutSeconds = 60
)
$ErrorActionPreference = "Stop"

function Get-RendererSnapshot([string]$WebSocketUrl) {
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $socket.Options.AddSubProtocol("") | Out-Null
    $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $payload = @{
      id = 1
      method = "Runtime.evaluate"
      params = @{
        expression = "(() => { const r=document.querySelector('#root'); return JSON.stringify({ready:document.readyState,title:document.title,rootChildren:r?r.children.length:0,bodyText:(document.body?.innerText||'').trim(),width:innerWidth,height:innerHeight}); })()"
        returnByValue = $true
        awaitPromise = $true
      }
    } | ConvertTo-Json -Depth 8 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
    $socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $buffer = [byte[]]::new(65536)
    $builder = [Text.StringBuilder]::new()
    do {
      $part = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($part.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "El renderer cerró el canal CDP." }
      [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $part.Count))
    } while (-not $part.EndOfMessage)
    $response = $builder.ToString() | ConvertFrom-Json
    if ($response.id -ne 1) { throw "Respuesta CDP inesperada." }
    $value = $response.result.result.value
    if (-not $value) { throw "El renderer no devolvió estado DOM." }
    return ($value | ConvertFrom-Json)
  } finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    }
    $socket.Dispose()
  }
}

if (-not (Test-Path $ExecutablePath -PathType Leaf)) { throw "No existe el ejecutable: $ExecutablePath" }
$process = Start-Process -FilePath $ExecutablePath -ArgumentList @("--disable-gpu", "--remote-debugging-port=$Port", "--remote-allow-origins=*") -PassThru
try {
  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  $snapshot = $null
  $lastError = ""
  while ([DateTime]::UtcNow -lt $deadline) {
    $process.Refresh()
    if ($process.HasExited) { throw "SICOVEN $Version se cerró durante el arranque. Código $($process.ExitCode)." }
    try {
      $targets = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/json" -TimeoutSec 3
      $page = $targets | Where-Object { $_.type -eq "page" -and $_.webSocketDebuggerUrl } | Select-Object -First 1
      if ($page) {
        $snapshot = Get-RendererSnapshot $page.webSocketDebuggerUrl
        if ($snapshot.ready -eq "complete" -and $snapshot.rootChildren -gt 0 -and $snapshot.bodyText.Length -ge 10 -and $snapshot.width -ge 800 -and $snapshot.height -ge 600) { break }
      }
    } catch { $lastError = $_.Exception.Message }
    Start-Sleep -Milliseconds 750
  }
  if (-not $snapshot -or $snapshot.ready -ne "complete" -or $snapshot.rootChildren -lt 1 -or $snapshot.bodyText.Length -lt 10 -or $snapshot.width -lt 800 -or $snapshot.height -lt 600) {
    throw "SICOVEN $Version no demostró renderizado visible. Último estado: $($snapshot | ConvertTo-Json -Compress -Depth 5). Error CDP: $lastError"
  }
  Write-Host "RENDERER OK $Version : $($snapshot | ConvertTo-Json -Compress -Depth 5)"
} finally {
  $process.Refresh()
  if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
}
