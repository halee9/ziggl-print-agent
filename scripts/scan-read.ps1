# 시리얼(COM) 바코드 스캐너 리더 — COM 포트를 열어 스캔 1건마다 stdout에 한 줄 출력.
# ziggl-print-agent(scanner.ts)가 이 프로세스를 띄우고 stdout 라인을 읽어 처리한다.
# 스캐너는 스캔 끝에 CR(\r)을 보냄(실측). 포트가 없거나 끊기면 계속 재시도.
param(
  [string]$Port = 'COM3',
  [int]$Baud = 9600
)
$OutputEncoding = [System.Text.Encoding]::ASCII

while ($true) {
  $sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, 'None', 8, 'One'
  $sp.NewLine = "`r"          # 스캔 종료 문자 = CR
  $sp.ReadTimeout = 500
  try {
    $sp.Open()
    [Console]::Error.WriteLine("[scan-read] opened $Port @ $Baud")
    while ($true) {
      try {
        $line = $sp.ReadLine()
        if ($line) {
          $line = $line.Trim()
          if ($line.Length -gt 0) { [Console]::Out.WriteLine($line); [Console]::Out.Flush() }
        }
      } catch [TimeoutException] {
        # 스캔 없음 — 계속 대기
      }
    }
  } catch {
    [Console]::Error.WriteLine("[scan-read] $Port error: $($_.Exception.Message) — retrying in 3s")
    Start-Sleep -Seconds 3
  } finally {
    try { if ($sp.IsOpen) { $sp.Close() } } catch { }
    try { $sp.Dispose() } catch { }
  }
}
