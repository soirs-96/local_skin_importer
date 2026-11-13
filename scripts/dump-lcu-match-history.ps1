# Dump raw LCU payloads (ASCII only on purpose: PowerShell 5.1 reads .ps1 as
# ANSI/GBK when there is no BOM, and any non-ASCII byte can corrupt parsing).
#
# Run with the game client open:
#   powershell -ExecutionPolicy Bypass -File scripts\dump-lcu-match-history.ps1

$ErrorActionPreference = 'Stop'

function Get-CredentialFromProcess {
    $procs = Get-CimInstance Win32_Process -Filter "Name='LeagueClient.exe' OR Name='LeagueClientUx.exe'"
    foreach ($p in $procs) {
        if (-not $p.CommandLine) { continue }
        $port = $null
        $token = $null
        if ($p.CommandLine -match '--app-port=(\d+)') { $port = $Matches[1] }
        if ($p.CommandLine -match '--remoting-auth-token=([\w-]+)') { $token = $Matches[1] }
        if (-not $port -and $p.CommandLine -match '--riotclient-app-port=(\d+)') { $port = $Matches[1] }
        if (-not $token -and $p.CommandLine -match '--riotclient-auth-token=([\w-]+)') { $token = $Matches[1] }
        if ($port -and $token) {
            return @{ Port = $port; Token = $token; Protocol = 'https'; Source = "$($p.Name) cmdline" }
        }
    }
    return $null
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

function Get-CredentialFromLockfile {
    $lockfile = Find-Lockfile
    if (-not $lockfile) { return $null }
    $fields = (Get-Content $lockfile -Raw).Trim().Split(':')
    if ($fields.Length -lt 5) { return $null }
    $protocol = if ($fields[4].Trim().ToLower() -eq 'http') { 'http' } else { 'https' }
    return @{ Port = $fields[2]; Token = $fields[3]; Protocol = $protocol; Source = $lockfile }
}

$cred = Get-CredentialFromProcess
if (-not $cred) { $cred = Get-CredentialFromLockfile }
if (-not $cred) {
    Write-Host 'No LCU credential found. Is the game client running?'
    exit 1
}
Write-Host ("credential source: {0} (port {1})" -f $cred.Source, $cred.Port)

$auth = [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("riot:$($cred.Token)"))
$base = "$($cred.Protocol)://127.0.0.1:$($cred.Port)"

function Get-LcuText {
    param([string]$Path)
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $r = Invoke-WebRequest -Uri ($base + $Path) -Headers @{ Authorization = "Basic $auth" } -UseBasicParsing -TimeoutSec 20
        return @{ Status = [int]$r.StatusCode; Body = $r.Content }
    } catch {
        $status = $null
        if ($_.Exception.Response) { $status = [int]$_.Exception.Response.StatusCode }
        return @{ Status = $status; Body = '' }
    }
}

function Get-FieldNames {
    param($Object)
    if ($null -eq $Object) { return '' }
    return (($Object.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
}

# ===================== part 1: recent matches =====================

Write-Host ''
Write-Host '===================== match-history ====================='

$res = Get-LcuText '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=3'
if ($res.Status -ne 200) {
    Write-Host ("request failed, status {0}" -f $res.Status)
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

$me = Get-LcuText '/lol-summoner/v1/current-summoner'
$puuid = ''
if ($me.Status -eq 200 -and $me.Body) {
    $meJson = $me.Body | ConvertFrom-Json
    $puuid = [string]$meJson.puuid
    Write-Host ("current summoner puuid = {0} (summonerId = {1})" -f $puuid, $meJson.summonerId)
    Write-Host ('current-summoner fields: ' + (Get-FieldNames $meJson))
} else {
    Write-Host ("current-summoner unavailable, status {0}" -f $me.Status)
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
    $r = Get-LcuText $path
    Write-Host ''
    Write-Host ("{0} -> {1}" -f $path, $r.Status)
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
    $r = Get-LcuText $path
    $len = 0
    if ($r.Body) { $len = $r.Body.Length }
    Write-Host ("  {0} -> {1} ({2} bytes)" -f $path, $r.Status, $len)
}
