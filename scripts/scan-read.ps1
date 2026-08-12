# Serial (COM) barcode scanner reader. Opens the COM port and writes one line to
# stdout per scan. ziggl-print-agent (scanner.ts) spawns this and reads the lines.
# The scanner ends each scan with CR. Keeps retrying if the port is missing/dropped.
# NOTE: keep this file ASCII-only. Windows PowerShell 5.1 mis-parses non-ASCII
# comments in a BOM-less UTF-8 file and exits with an error.
param(
  [string]$Port = 'COM3',
  [int]$Baud = 9600
)

while ($true) {
  $sp = New-Object System.IO.Ports.SerialPort $Port, $Baud, 'None', 8, 'One'
  $sp.NewLine = "`r"          # scan terminator = CR
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
        # no scan yet - keep waiting
      }
    }
  } catch {
    [Console]::Error.WriteLine("[scan-read] $Port error: $($_.Exception.Message) - retrying in 3s")
    Start-Sleep -Seconds 3
  } finally {
    try { if ($sp.IsOpen) { $sp.Close() } } catch { }
    try { $sp.Dispose() } catch { }
  }
}
