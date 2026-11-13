# 打印国服 LCU 最近对局接口的原始字段 —— 只用来确认「模式/地图」字段叫什么。
#
# 用法(游戏客户端开着的时候跑):
#   powershell -ExecutionPolicy Bypass -File scripts\dump-lcu-match-history.ps1
#
# 顺带探测「召唤师头像」相关的数据源(见脚本末尾的 profile 部分)。

$ErrorActionPreference = 'Stop'

function Get-CredentialFromProcess {
    $procs = Get-CimInstance Win32_Process -Filter "Name='LeagueClient.exe' OR Name='LeagueClientUx.exe'"
    foreach ($p in $procs) {
        if (-not $p.CommandLine) { continue }
        $port = $null
        $token = $null
        # 国服:游戏 LCU 端点用 app-port + remoting-auth-token
        if ($p.CommandLine -match '--app-port=(\d+)') { $port = $Matches[1] }
        if ($p.CommandLine -match '--remoting-auth-token=([\w-]+)') { $token = $Matches[1] }
        # 国际服:riotclient-app-port + riotclient-auth-token
        if (-not $port -and $p.CommandLine -match '--riotclient-app-port=(\d+)') { $port = $Matches[1] }
        if (-not $token -and $p.CommandLine -match '--riotclient-auth-token=([\w-]+)') { $token = $Matches[1] }
        if ($port -and $token) {
            return @{ Port = $port; Token = $token; Protocol = 'https'; Source = "$($p.Name) 命令行" }
        }
    }
    return $null
}

function Find-Lockfile {
    $candidates = @(
        "$env:ProgramFiles\Riot Games\League of Legends\lockfile",
        "$env:LOCALAPPDATA\Riot Games\League of Legends\lockfile",
        "$env:ProgramFiles\WeGameApps\rail_apps\lol\lockfile",
        "${env:ProgramFiles(x86)}\WeGameApps\rail_apps\lol\lockfile",
        "$env:ProgramFiles\Tencent\WeGameApps\rail_apps\lol\lockfile",
        "${env:ProgramFiles(x86)}\Tencent\WeGameApps\rail_apps\lol\lockfile"
    )
    foreach ($path in $candidates) {
        if (Test-Path $path) { return $path }
    }
    foreach ($drive in (Get-PSDrive -PSProvider FileSystem)) {
        foreach ($rel in @('英雄联盟', 'wegameapps\英雄联盟', 'WeGameApps\英雄联盟', 'Riot Games\League of Legends')) {
            $dir = Join-Path $drive.Root $rel
            if (-not (Test-Path $dir)) { continue }
            $hit = Get-ChildItem -Path $dir -Filter 'lockfile' -Recurse -Depth 3 -ErrorAction SilentlyContinue |
                Select-Object -First 1
            if ($hit) { return $hit.FullName }
        }
    }
    return $null
}

function Get-CredentialFromLockfile {
    $lockfile = Find-Lockfile
    if (-not $lockfile) { return $null }
    # 格式:LeagueClientUx:<pid>:<port>:<password>:<protocol>
    $fields = (Get-Content $lockfile -Raw).Trim().Split(':')
    if ($fields.Length -lt 5) { return $null }
    $protocol = if ($fields[4].Trim().ToLower() -eq 'http') { 'http' } else { 'https' }
    return @{ Port = $fields[2]; Token = $fields[3]; Protocol = $protocol; Source = $lockfile }
}

$cred = Get-CredentialFromProcess
if (-not $cred) { $cred = Get-CredentialFromLockfile }
if (-not $cred) {
    Write-Host '没找到 LCU 凭据 —— 游戏客户端没开?' -ForegroundColor Red
    exit 1
}
Write-Host ("凭据来源: {0}(端口 {1})" -f $cred.Source, $cred.Port)

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

# ============================ 最近对局 ============================

Write-Host ''
Write-Host '===================== 最近对局(match-history) ====================='

$res = Get-LcuText '/lol-match-history/v1/products/lol/current-summoner/matches?begIndex=0&endIndex=3'
if ($res.Status -ne 200) {
    Write-Host ("请求失败,状态码 {0}" -f $res.Status) -ForegroundColor Red
} else {
    $json = $res.Body | ConvertFrom-Json
    $games = $null
    if ($json.games -is [array]) { $games = $json.games }
    elseif ($json.games.games -is [array]) { $games = $json.games.games }
    elseif ($json.games) { $games = @($json.games.PSObject.Properties | ForEach-Object { $_.Value }) }

    if (-not $games -or $games.Count -eq 0) {
        Write-Host '没解析出对局 —— 原始内容前 800 字:'
        Write-Host $res.Body.Substring(0, [Math]::Min(800, $res.Body.Length))
    } else {
        foreach ($game in $games) {
            Write-Host '--------------------------------------------------'
            Write-Host '顶层字段:'
            Write-Host (($game.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
            foreach ($key in @('gameId', 'gameMode', 'gameType', 'queueType', 'queueId', 'mapId', 'map', 'mode', 'tags')) {
                if ($game.PSObject.Properties.Name -contains $key) {
                    Write-Host ("  {0} = {1}" -f $key, ($game.$key | ConvertTo-Json -Compress -Depth 4))
                }
            }
            if ($game.gameMetadata) {
                Write-Host '  gameMetadata 字段:'
                Write-Host (($game.gameMetadata.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
            }
            if ($game.participants -and $game.participants.Count -gt 0) {
                $participant = $game.participants[0]
                Write-Host 'participant 字段:'
                Write-Host (($participant.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
                if ($participant.timeline) {
                    Write-Host '  timeline 字段:'
                    Write-Host (($participant.timeline.PSObject.Properties | ForEach-Object { $_.Name }) -join ', ')
                    Write-Host ("  timeline.lane = {0}" -f ($participant.timeline.lane | ConvertTo-Json -Compress))
                    Write-Host ("  timeline.role = {0}" -f ($participant.timeline.role | ConvertTo-Json -Compress))
                }
            }
        }
    }
}

# ============================ 召唤师头像 ============================

Write-Host ''
Write-Host '===================== 召唤师头像(profile) ====================='

$me = Get-LcuText '/lol-summoner/v1/current-summoner'
$puuid = ''
if ($me.Status -eq 200 -and $me.Body) {
    $meJson = $me.Body | ConvertFrom-Json
    $puuid = [string]$meJson.puuid
    Write-Host ("当前召唤师 puuid = {0}(summonerId = {1})" -f $puuid, $meJson.summonerId)
    Write-Host ("current-summoner 字段: {0}" -f (($meJson.PSObject.Properties | ForEach-Object { $_.Name }) -join ', '))
} else {
    Write-Host ("current-summoner 取不到,状态码 {0}" -f $me.Status) -ForegroundColor Yellow
}

if (-not $puuid) {
    Write-Host '没有 puuid,后面的 profile 探测跳过'
    exit 0
}

foreach ($path in @(
    "/lol-profile/v1/profiles/$puuid",
    "/lol-summoner/v1/summoners/$puuid",
    "/lol-summoner/v2/summoners/by-puuid/$puuid"
)) {
    $r = Get-LcuText $path
    Write-Host ''
    Write-Host ("{0}  →  {1}" -f $path, $r.Status)
    if ($r.Status -eq 200 -and $r.Body) {
        $obj = $r.Body | ConvertFrom-Json
        Write-Host ("  字段: {0}" -f (($obj.PSObject.Properties | ForEach-Object { $_.Name }) -join ', '))
        foreach ($key in @('profileIconId', 'summonerLevel', 'displayName', 'gameName', 'tagLine', 'backgroundSkinId')) {
            if ($obj.PSObject.Properties.Name -contains $key) {
                Write-Host ("  {0} = {1}" -f $key, ($obj.$key | ConvertTo-Json -Compress))
            }
        }
    }
}

# 头像图片本体:客户端静态资源里有没有 profile-icons
$iconId = $null
$prof = Get-LcuText "/lol-profile/v1/profiles/$puuid"
if ($prof.Status -eq 200 -and $prof.Body) {
    $iconId = ($prof.Body | ConvertFrom-Json).profileIconId
}
if (-not $iconId) { $iconId = 1 }

Write-Host ''
Write-Host ("探测头像图片资源(profileIconId = {0}):" -f $iconId)
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
    $len = if ($r.Body) { $r.Body.Length } else { 0 }
    Write-Host ("  {0} → {1}({2} 字节)" -f $path, $r.Status, $len)
}
