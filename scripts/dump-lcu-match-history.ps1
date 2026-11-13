# Thin wrapper: the real probe is a Node script.
#
# PowerShell 5.1's .NET TLS stack cannot complete the handshake with the CN
# client's self-signed LCU server, so the requests are made from Node instead.
#
# Run with the game client open:
#   powershell -ExecutionPolicy Bypass -File scripts\dump-lcu-match-history.ps1

& node "$PSScriptRoot\dump-lcu-match-history.mjs"
exit $LASTEXITCODE
