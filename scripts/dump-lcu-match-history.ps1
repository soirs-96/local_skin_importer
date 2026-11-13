# Dump raw LCU payloads (ASCII only on purpose: PowerShell 5.1 reads .ps1 as
# ANSI/GBK when there is no BOM, and any non-ASCII byte can corrupt parsing).
#
# Run with the game client open:
#   powershell -ExecutionPolicy Bypass -File scripts\dump-lcu-match-history.ps1

$ErrorActionPreference = 'Stop'

# The client uses a self-signed certificate and PS 5.1 refuses it by default.
# Also bypass any system proxy - 127.0.0.1 must go straight out.
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
[Net.ServicePointManager]::ServerCertificateValidationCallback = { $true }
try { [System.Net.WebRequest]::DefaultWebProxy = $null } catch { }

function Get-Candidates {
    $candidates = @()

    $procs = Get-CimInstance Win32_Process -Filter "Name='LeagueClient.exe' OR Name='LeagueClientUx.exe' OR Name='LeagueClientUxRender.exe'"
    foreach ($p in $procs) {
        if (-not $p.CommandLine) { continue }
        $cmd = $p.CommandLine
        Write-Host ("process {0} : {1}" -f $p.Name, $cmd)
        $ports = @()
        $tokens = @()
        if ($cmd -match '--app-port=([^\s"]+)') { $ports += $Matches[1] }
        if ($cmd -match '--riotclient-app-port=([^\s"]+)') { $ports += $Matches[1] }
        if ($cmd -match '--remoting-auth-token=([^\s"]+)') { $tokens += $Matches[1] }
        if ($cmd -match '--riotclient-auth-token=([^\s"]+)') { $tokens += $Matches[1] }
        foreach ($port in $ports) {
            foreach ($token in $tokens) {
                $candidates += @{ Port = $port; Token = $token; Protocol = 'https'; Source = "$($p.Name) cmdline port $port" }
            }
        }
    }

    $lockfile = Find-Lockfile
    if ($lockfile) {
        Write-Host ("lockfile: {0}" -f $lockfile)
        $fields = (Get-Content $lockfile -Raw).Trim().Split(':')
        if ($fields.Length -ge 5) {
            $protocol = if ($fields[4].Trim().ToLower() -eq 'http') { 'http' } else { 'https' }
            $candidates += @{ Port = $fields[2]; Token = $fields[3]; Protocol = $protocol; Source = "lockfile $lockfile" }
        }
    } else {
        Write-Host 'lockfile: not found'
    }

    return $candidates
}

function Find-Lockfile {
    $candidates = @(
        "${env:ProgramFiles}\Riot Games\League of Legends\lockfile",
        "${env:LOCALAPPDATA}\Riot Games\League of Legends\lockfile",
        "${env:ProgramFiles}\WeGameApps\rail_apps\lol\lockfile",
        "${env:ProgramFiles(x86)}\WeGameApps\rail_apps\lol\lockfile",
        "${env:ProgramFiles}\Tencent\WeGameApps\rail_apps\lol\lockfile",
        "${env:ProgramFiles(x86)}\Tencent\WeGameApps\rail_apps\lol\lockfile"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    foreach ($drive in (Get-PSDrive -PSProvider FileSystem)) {
        foreach ($rel in @('League of Legends', 'wegameapps\LOL', 'WeGameApps\lol')) {
            $dir = Join-Path $drive.Root $rel
            if (-not (Test-Path $dir)) { continue }
            $hit = Get-ChildItem -Path $dir -Filter 'lockfile' -Recurse -Depth 4 -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    return $null
}

function Invoke-Lcu {
    param([string]$Base, [string]$Auth, [string]$Path)
    try {
        $r = Invoke-WebRequest -Uri ($Base + $Path) -Headers @{ Authorization = "Basic $Auth" } -UseBasicParsing -TimeoutSec 15
        return @{ Status = [int]$r.StatusCode; Body = $r.Content; Error = '' }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        $message = $_.Exception.Message
        if ($message.Length -gt 160) { $message = $message.Substring(0, 160) }
        return @{ Status = $status; Body = ''; Error = $message }
    }
}

function Get-FieldNames {
    param($Object)
    if ($null -eq $Object) { return '' }
    return (($Object.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
}

# ===================== find a working endpoint =====================

Write-Host '===================== credentials ====================='

$candidates = Get-Candidates
if ($candidates.Count -eq 0) {
    Write-Host 'No credential candidate found. Is the game client running?'
    exit 1
}

$base = $null
$auth = $null
foreach ($candidate in $candidates) {
    foreach ($protocol in @('https', 'http')) {
        $tryBase = "${protocol}://127.0.0.1:$($candidate.Port)"
        $tryAuth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("riot:$($candidate.Token)"))
        $r = Invoke-Lcu -Base $tryBase -Auth $tryAuth -Path '/lol-summoner/v1/current-summoner'
        Write-Host ("try {0} ({1}) -> {2} {3}" -f $tryBase, $candidate.Source, $r.Status, $r.Error)
        if ($r.Status -eq 200) {
            $base = $tryBase
            $auth = $tryAuth
            break
        }
    }
    if ($base) { break }
}

if (-not $base) {
    Write-Host 'No candidate endpoint answered 200.'
    exit 1
}
Write-Host ("using {0}" -f $base)

# ===================== part 1: recent matches =====================

Write-Host ''
Write-Host '===================== match-history ====================='

$res = Invoke-Lcu -Base $base -Auth $auth -Path '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=3'
if ($res.Status -ne 200) {
    Write-Host ("request failed, status {0} {1}" -f $res.Status, $res.Error)
} else {
    $json = $res.Body | ConvertFrom-Json
    $games = $null
    if ($json.games -is [array]) { $games = $json.games }
    elseif ($json.games.games -is [array]) { $games = $json.games.games }
    elseif ($json.games) { $games = @($json.games.PSObject.Properties | ForEach-Object { $_.Value }) }

    if (-not $games -or $games.Count -eq 0) {
        Write-Host 'no games parsed, raw head:'
        Write-Host $res.Body.Substring(0, [Math]::Min(800, $res.Body.Length))
    } else {
        foreach ($game in $games) {
            Write-Host '--------------------------------------------------'
            Write-Host ('top level fields: ' + (Get-FieldNames $game))
            foreach ($key in @('gameId', 'gameMode', 'gameType', 'queueType', 'queueId', 'mapId', 'map', 'mode', 'tags')) {
                if ($game.PSObject.Properties.Name -contains $key) {
                    Write-Host ("  {0} = {1}" -f $key, ($game.$key | ConvertTo-Json -Compress -Depth 4))
                }
            }
            if ($game.gameMetadata) {
                Write-Host ('  gameMetadata fields: ' + (Get-FieldNames $game.gameMetadata))
            }
            if ($game.participants -and $game.participants.Count -gt 0) {
                $participant = $game.participants[0]
                Write-Host ('participant fields: ' + (Get-FieldNames $participant))
                if ($participant.timeline) {
                    Write-Host ('  timeline fields: ' + (Get-FieldNames $participant.timeline))
                    Write-Host ("  timeline.lane = {0}" -f ($participant.timeline.lane | ConvertTo-Json -Compress))
                    Write-Host ("  timeline.role = {0}" -f ($participant.timeline.role | ConvertTo-Json -Compress))
                }
            }
        }
    }
}

# ===================== part 2: summoner avatar =====================

Write-Host ''
Write-Host '===================== profile / avatar ====================='

$me = Invoke-Lcu -Base $base -Auth $auth -Path '/lol-summoner/v1/current-summoner'
$puuid = ''
if ($me.Status -eq 200 -and $me.Body) {
    $meJson = $me.Body | ConvertFrom-Json
    $puuid = [string]$meJson.puuid
    Write-Host ("current summoner puuid = {0} (summonerId = {1})" -f $puuid, $meJson.summonerId)
    Write-Host ('current-summoner fields: ' + (Get-FieldNames $meJson))
} else {
    Write-Host ("current-summoner unavailable, status {0} {1}" -f $me.Status, $me.Error)
}

if (-not $puuid) {
    Write-Host 'no puuid, skipping profile probes'
    exit 0
}

$iconId = $null
foreach ($path in @(
    "/lol-profile/v1/profiles/$puuid",
    "/lol-summoner/v1/summoners/$puuid",
    "/lol-summoner/v2/summoners/by-puuid/$puuid"
)) {
    $r = Invoke-Lcu -Base $base -Auth $auth -Path $path
    Write-Host ''
    Write-Host ("{0} -> {1} {2}" -f $path, $r.Status, $r.Error)
    if ($r.Status -eq 200 -and $r.Body) {
        $obj = $r.Body | ConvertFrom-Json
        Write-Host ('  fields: ' + (Get-FieldNames $obj))
        foreach ($key in @('profileIconId', 'summonerLevel', 'displayName', 'gameName', 'tagLine', 'backgroundSkinId')) {
            if ($obj.PSObject.Properties.Name -contains $key) {
                Write-Host ("  {0} = {1}" -f $key, ($obj.$key | ConvertTo-Json -Compress))
            }
        }
        if ($null -eq $iconId -and $obj.PSObject.Properties.Name -contains 'profileIconId') {
            $iconId = $obj.profileIconId
        }
    }
}

if (-not $iconId) { $iconId = 1 }

Write-Host ''
Write-Host ("probing avatar image resources (profileIconId = {0}):" -f $iconId)
foreach ($tpl in @(
    '/lol-game-data/assets/v1/profile-icons/{id}.png',
    '/lol-game-data/assets/v1/profile-icons/{id}.jpg',
    '/lol-static-data/v1/profile-icons/{id}.png',
    '/lol-game-data/assets/v1/profile-icon/{id}.png',
    '/lol-game-data/assets/v1/profile/{id}.png',
    '/lol-game-data/assets/v1/profile-icons/{id}.webp'
)) {
    $path = $tpl.Replace('{id}', [string]$iconId)
    $r = Invoke-Lcu -Base $base -Auth $auth -Path $path
    $len = 0
    if ($r.Body) { $len = $r.Body.Length }
    Write-Host ("  {0} -> {1} ({2} bytes) {3}" -f $path, $r.Status, $len, $r.Error)
}
