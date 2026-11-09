param(
  [Parameter(Mandatory=$true)][string]$ExecutablePath,
  [Parameter(Mandatory=$true)][string]$Version,
  [int]$Port = 9222,
  [int]$TimeoutSeconds = 60,
  [switch]$TestValidationInput
)
$ErrorActionPreference = "Stop"

function Send-CdpCommand($socket, [int]$Id, [string]$Method, [hashtable]$Params) {
  $payload = @{ id = $Id; method = $Method; params = $Params } | ConvertTo-Json -Depth 8 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($payload)
  $socket.SendAsync([ArraySegment[byte]]::new($bytes), [System.Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $buffer = [byte[]]::new(65536)
  $deadline = [DateTime]::UtcNow.AddSeconds(10)
  while ([DateTime]::UtcNow -lt $deadline) {
    $builder = [Text.StringBuilder]::new()
    do {
      $part = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
      if ($part.MessageType -eq [System.Net.WebSockets.WebSocketMessageType]::Close) { throw "El renderer cerró el canal CDP." }
      [void]$builder.Append([Text.Encoding]::UTF8.GetString($buffer, 0, $part.Count))
    } while (-not $part.EndOfMessage)
    $message = $builder.ToString() | ConvertFrom-Json
    if ($message.id -ne $Id) { continue }
    if ($message.error) { throw "CDP $Method falló: $($message.error.message)" }
    return $message.result
  }
  throw "Timeout esperando respuesta CDP para $Method."
}

function Get-RendererSnapshot([string]$WebSocketUrl) {
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $response = Send-CdpCommand $socket 1 "Runtime.evaluate" @{
      expression = "(() => { const r=document.querySelector('#root'); return JSON.stringify({ready:document.readyState,title:document.title,rootChildren:r?r.children.length:0,bodyText:(document.body?.innerText||'').trim(),width:innerWidth,height:innerHeight}); })()"
      returnByValue = $true
      awaitPromise = $true
    }
    $value = $response.result.value
    if (-not $value) { throw "El renderer no devolvió estado DOM." }
    return ($value | ConvertFrom-Json)
  } finally {
    if ($socket.State -eq [System.Net.WebSockets.WebSocketState]::Open) {
      $socket.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, "done", [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    }
    $socket.Dispose()
  }
}

function Test-RendererAlertInput([string]$WebSocketUrl) {
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $socket.ConnectAsync([Uri]$WebSocketUrl, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $null = Send-CdpCommand $socket 1 "Page.bringToFront" @{}
    $setup = Send-CdpCommand $socket 2 "Runtime.evaluate" @{
      expression = "(() => { const input=document.createElement('input'); input.id='sicoven-validation-input-probe'; input.type='text'; input.autocomplete='off'; input.style.cssText='position:fixed;left:12px;top:12px;width:260px;height:42px;z-index:2147483646;background:#fff;color:#111;border:2px solid #111;padding:6px;'; document.body.appendChild(input); window.alert('Prueba de validación: el campo debe seguir aceptando escritura.'); const r=input.getBoundingClientRect(); const close=document.querySelector('#sicoven-alert-layer .sicoven-alert-dismiss'); const cr=close?.getBoundingClientRect(); return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2,closeX:cr?cr.left+cr.width/2:0,closeY:cr?cr.top+cr.height/2:0,noticeCount:document.querySelectorAll('#sicoven-alert-layer [role=alert]').length,layerPointerEvents:getComputedStyle(document.querySelector('#sicoven-alert-layer')).pointerEvents}); })()"
      returnByValue = $true
      awaitPromise = $true
      userGesture = $true
    }
    $probe = $setup.result.value | ConvertFrom-Json
    if ($probe.noticeCount -lt 1) { throw "window.alert no generó el aviso accesible esperado." }
    if ($probe.layerPointerEvents -ne "none") { throw "La capa de avisos está interceptando eventos de puntero." }

    # Primero cerrar el aviso como lo haría el usuario.
    $null = Send-CdpCommand $socket 3 "Input.dispatchMouseEvent" @{ type = "mouseMoved"; x = $probe.closeX; y = $probe.closeY }
    $null = Send-CdpCommand $socket 4 "Input.dispatchMouseEvent" @{ type = "mousePressed"; x = $probe.closeX; y = $probe.closeY; button = "left"; clickCount = 1 }
    $null = Send-CdpCommand $socket 5 "Input.dispatchMouseEvent" @{ type = "mouseReleased"; x = $probe.closeX; y = $probe.closeY; button = "left"; clickCount = 1 }
    $closed = Send-CdpCommand $socket 6 "Runtime.evaluate" @{
      expression = "document.querySelectorAll('#sicoven-alert-layer [role=alert]').length === 0"
      returnByValue = $true
      awaitPromise = $true
    }
    if (-not $closed.result.value) { throw "No se pudo cerrar el aviso antes de probar la escritura." }

    # Después de cerrar el aviso, hacer clic y escribir mediante eventos reales de Chromium.
    $null = Send-CdpCommand $socket 7 "Input.dispatchMouseEvent" @{ type = "mouseMoved"; x = $probe.x; y = $probe.y }
    $null = Send-CdpCommand $socket 8 "Input.dispatchMouseEvent" @{ type = "mousePressed"; x = $probe.x; y = $probe.y; button = "left"; clickCount = 1 }
    $null = Send-CdpCommand $socket 9 "Input.dispatchMouseEvent" @{ type = "mouseReleased"; x = $probe.x; y = $probe.y; button = "left"; clickCount = 1 }
    $null = Send-CdpCommand $socket 10 "Input.insertText" @{ text = "SICOVEN-INPUT-OK" }

    $verification = Send-CdpCommand $socket 11 "Runtime.evaluate" @{
      expression = "(() => { const input=document.querySelector('#sicoven-validation-input-probe'); return Boolean(input && document.activeElement===input && input.value==='SICOVEN-INPUT-OK'); })()"
      returnByValue = $true
      awaitPromise = $true
    }
    if (-not $verification.result.value) { throw "El campo de prueba no recibió clic, foco y escritura después de cerrar el aviso." }

    $null = Send-CdpCommand $socket 12 "Runtime.evaluate" @{
      expression = "document.querySelector('#sicoven-validation-input-probe')?.remove(); true"
      returnByValue = $true
    }
    Write-Host "VALIDATION INPUT OK: aviso cerrado y campo de texto editable sin reiniciar SICOVEN."
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
  $page = $null
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
  if ($TestValidationInput) {
    if (-not $page -or -not $page.webSocketDebuggerUrl) { throw "No se encontró el renderer para probar la escritura después del aviso." }
    Test-RendererAlertInput $page.webSocketDebuggerUrl
  }
  Write-Host "RENDERER OK $Version : $($snapshot | ConvertTo-Json -Compress -Depth 5)"
} finally {
  $process.Refresh()
  if (-not $process.HasExited) { & taskkill.exe /PID $process.Id /T /F | Out-Null }
}
