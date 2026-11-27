[CmdletBinding()]
param(
    [Parameter(Position = 0)]
    [ValidateSet('push', 'pull', 'status', 'init')]
    [string]$Action = 'status',

    [string]$Repo = $env:AGY_SYNC_REPO,

    [string]$TargetDir = '',

    [switch]$AllowLive,

    [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.IO.Compression.FileSystem

$GeminiDir = Join-Path $env:USERPROFILE '.gemini'
$AgyDir = Join-Path $GeminiDir 'antigravity-cli'
$SnapshotScript = Join-Path $PSScriptRoot 'sqlite-snapshot.mjs'

function Invoke-GhRaw {
    param([string[]]$GhArgs)
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & gh @GhArgs 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    return [PSCustomObject]@{
        ExitCode = $code
        Output   = ($output | Out-String).Trim()
    }
}

function Resolve-SyncRepo {
    param([string]$CurrentRepo)
    if (-not [string]::IsNullOrWhiteSpace($CurrentRepo)) {
        return $CurrentRepo.Trim()
    }
    $res = Invoke-GhRaw -GhArgs @('api', 'user', '--jq', '.login')
    if ($res.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($res.Output)) {
        throw "Failed to resolve GitHub username via 'gh api user'. Run 'gh auth login' or pass -Repo '<owner>/agy-chat-sync'. Details: $($res.Output)"
    }
    return "$($res.Output)/agy-chat-sync"
}

function Assert-GhAuth {
    $res = Invoke-GhRaw -GhArgs @('auth', 'status')
    if ($res.ExitCode -ne 0) {
        throw "GitHub CLI is not authenticated. Run 'gh auth login' first.`n$($res.Output)"
    }
}

function Assert-PrivateRepo {
    param([string]$RepoName)
    Assert-GhAuth
    $res = Invoke-GhRaw -GhArgs @('repo', 'view', $RepoName, '--json', 'isPrivate,visibility')
    if ($res.ExitCode -ne 0) {
        throw "Sync repository '$RepoName' does not exist or cannot be accessed. Run 'agy-sync.ps1 init' first.`n$($res.Output)"
    }
    $info = $res.Output | ConvertFrom-Json
    if ($info.isPrivate -ne $true) {
        throw "SECURITY ABORT: Repository '$RepoName' is NOT private (visibility=$($info.visibility)). Chat sync refuses to use non-private repositories."
    }
}

function Test-ReleaseExists {
    param([string]$RepoName, [string]$Tag = 'latest')
    $res = Invoke-GhRaw -GhArgs @('release', 'view', $Tag, '--repo', $RepoName)
    return ($res.ExitCode -eq 0)
}

function Ensure-PrivateRepoAndRelease {
    param([string]$RepoName)
    Assert-GhAuth
    $viewRes = Invoke-GhRaw -GhArgs @('repo', 'view', $RepoName, '--json', 'isPrivate,visibility')
    if ($viewRes.ExitCode -ne 0) {
        Write-Host "Creating private sync repository '$RepoName'..."
        $createRes = Invoke-GhRaw -GhArgs @('repo', 'create', $RepoName, '--private', '--add-readme', '--description', 'Private Antigravity CLI chat sync storage')
        if ($createRes.ExitCode -ne 0) {
            throw "Failed to create private repository '$RepoName': $($createRes.Output)"
        }
    }

    Assert-PrivateRepo -RepoName $RepoName

    if (-not (Test-ReleaseExists -RepoName $RepoName -Tag 'latest')) {
        Write-Host "Creating 'latest' release tag in '$RepoName'..."
        $relRes = Invoke-GhRaw -GhArgs @('release', 'create', 'latest', '--repo', $RepoName, '--title', 'Latest Antigravity CLI Snapshot', '--notes', 'Automated private chat sync snapshot')
        if ($relRes.ExitCode -ne 0) {
            throw "Failed to create release 'latest' in '$RepoName': $($relRes.Output)"
        }
    }
}

function Get-RunningAgyProcesses {
    $prefix = [System.IO.Path]::GetFullPath($AgyDir).TrimEnd('\') + '\'
    $matches = @()
    foreach ($proc in (Get-Process -ErrorAction SilentlyContinue)) {
        $procPath = $null
        try {
            $procPath = $proc.Path
        } catch {
            $procPath = $null
        }

        $isAgyName = ($proc.ProcessName -eq 'agy')
        $isUnderAgyDir = (-not [string]::IsNullOrWhiteSpace($procPath)) -and $procPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)

        if ($isAgyName -or $isUnderAgyDir) {
            $matches += [PSCustomObject]@{
                Name = $proc.ProcessName
                Id   = $proc.Id
                Path = $procPath
            }
        }
    }
    return $matches
}

function Get-LocalConversationTitles {
    $annDir = Join-Path $AgyDir 'annotations'
    $titles = @()
    if (-not (Test-Path $annDir)) {
        return $titles
    }
    $files = Get-ChildItem -Path $annDir -Filter '*.pbtxt' -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTimeUtc -Descending
    foreach ($file in $files) {
        $raw = Get-Content -Path $file.FullName -Raw -ErrorAction SilentlyContinue
        $title = '(untitled)'
        if ($raw -match 'title:"((?:[^"\\]|\\.)*)"') {
            $title = $Matches[1] -replace '\\"', '"'
        }
        $titles += [ordered]@{
            id    = $file.BaseName
            title = $title
        }
    }
    return $titles
}

function Get-LocalLatestDbTimestampUtc {
    $candidates = @()
    $convDir = Join-Path $AgyDir 'conversations'
    if (Test-Path $convDir) {
        $candidates += Get-ChildItem -Path $convDir -Filter '*.db' -File -ErrorAction SilentlyContinue
    }
    $summaryDb = Join-Path $AgyDir 'conversation_summaries.db'
    if (Test-Path $summaryDb) {
        $candidates += Get-Item -Path $summaryDb -ErrorAction SilentlyContinue
    }
    if ($candidates.Count -eq 0) {
        return $null
    }
    $newest = $candidates | Sort-Object LastWriteTimeUtc -Descending | Select-Object -First 1
    return $newest.LastWriteTimeUtc
}

function Copy-FileSharedRead {
    param([string]$Src, [string]$Dst)
    $dstParent = Split-Path -Path $Dst -Parent
    if (-not (Test-Path $dstParent)) {
        New-Item -ItemType Directory -Path $dstParent -Force | Out-Null
    }
    $inStream = [System.IO.FileStream]::new($Src, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $outStream = [System.IO.FileStream]::new($Dst, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
        try {
            $inStream.CopyTo($outStream)
        } finally {
            $outStream.Dispose()
        }
    } finally {
        $inStream.Dispose()
    }
}

function Copy-TreeSafe {
    param(
        [string]$SourceDir,
        [string]$DestDir,
        [switch]$AllowSkipLockedLogs
    )
    if (-not (Test-Path $SourceDir)) {
        return
    }
    New-Item -ItemType Directory -Path $DestDir -Force | Out-Null
    $baseLen = ([System.IO.Path]::GetFullPath($SourceDir).TrimEnd('\')).Length

    foreach ($dir in (Get-ChildItem -Path $SourceDir -Directory -Recurse -Force -ErrorAction SilentlyContinue)) {
        $rel = $dir.FullName.Substring($baseLen).TrimStart('\')
        if (-not [string]::IsNullOrWhiteSpace($rel)) {
            New-Item -ItemType Directory -Path (Join-Path $DestDir $rel) -Force | Out-Null
        }
    }

    foreach ($file in (Get-ChildItem -Path $SourceDir -File -Recurse -Force -ErrorAction SilentlyContinue)) {
        $rel = $file.FullName.Substring($baseLen).TrimStart('\')
        $dstPath = Join-Path $DestDir $rel
        try {
            Copy-FileSharedRead -Src $file.FullName -Dst $dstPath
        } catch {
            $isTaskLog = ($rel -match '(^|\\)\.system_generated\\tasks\\.*\.log$') -or ($file.Extension -eq '.log')
            if ($AllowSkipLockedLogs -and $isTaskLog) {
                Write-Warning "Skipping active locked log during live snapshot: $rel"
            } else {
                throw
            }
        }
    }
}

function Invoke-SqliteSnapshot {
    param([string]$SrcDb, [string]$DstDb)
    if (-not (Test-Path $SnapshotScript)) {
        throw "Missing helper script: $SnapshotScript"
    }
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        $output = & node --no-warnings $SnapshotScript $SrcDb $DstDb 2>&1
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    if ($code -ne 0) {
        $msg = ($output | Out-String).Trim()
        throw "SQLite snapshot failed for '$SrcDb': $msg"
    }
}

function Invoke-InitAction {
    if (-not [string]::IsNullOrWhiteSpace($TargetDir)) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
        Write-Host "Initialized local/cloud sync directory: $TargetDir"
        return
    }
    $resolvedRepo = Resolve-SyncRepo -CurrentRepo $Repo
    Ensure-PrivateRepoAndRelease -RepoName $resolvedRepo
    Write-Host "Private sync repository '$resolvedRepo' and release 'latest' are ready."
}

function Invoke-PushAction {
    $running = @(Get-RunningAgyProcesses)
    $isLive = $running.Count -gt 0
    if ($isLive -and -not $AllowLive) {
        $procDesc = ($running | ForEach-Object { "$($_.Name) (PID $($_.Id))" }) -join ', '
        throw "Antigravity CLI processes are running ($procDesc). Close agy first or re-run with -AllowLive for a WAL-safe live snapshot."
    }

    if (-not (Test-Path $AgyDir)) {
        throw "Antigravity CLI directory not found at '$AgyDir'."
    }

    $useTargetDir = -not [string]::IsNullOrWhiteSpace($TargetDir)
    $resolvedRepo = ''
    if ($useTargetDir) {
        New-Item -ItemType Directory -Path $TargetDir -Force | Out-Null
    } else {
        $resolvedRepo = Resolve-SyncRepo -CurrentRepo $Repo
        Ensure-PrivateRepoAndRelease -RepoName $resolvedRepo
    }

    $tempRoot = Join-Path $env:TEMP ("agy-sync-work-" + [guid]::NewGuid().ToString('N'))
    $staging = Join-Path $tempRoot 'stage'
    $stageAgy = Join-Path $staging 'antigravity-cli'
    $stageGemini = Join-Path $staging 'gemini'
    $zipPath = Join-Path $tempRoot 'agy-state.zip'
    $metaPath = Join-Path $tempRoot 'sync-meta.json'

    try {
        New-Item -ItemType Directory -Path $stageAgy -Force | Out-Null
        New-Item -ItemType Directory -Path $stageGemini -Force | Out-Null

        # 1. SQLite DB snapshots via VACUUM INTO (excludes -wal / -shm)
        $convSrc = Join-Path $AgyDir 'conversations'
        if (Test-Path $convSrc) {
            $convDst = Join-Path $stageAgy 'conversations'
            New-Item -ItemType Directory -Path $convDst -Force | Out-Null
            foreach ($dbFile in (Get-ChildItem -Path $convSrc -Filter '*.db' -File -ErrorAction SilentlyContinue)) {
                Invoke-SqliteSnapshot -SrcDb $dbFile.FullName -DstDb (Join-Path $convDst $dbFile.Name)
            }
        }

        $summaryDbSrc = Join-Path $AgyDir 'conversation_summaries.db'
        if (Test-Path $summaryDbSrc) {
            Invoke-SqliteSnapshot -SrcDb $summaryDbSrc -DstDb (Join-Path $stageAgy 'conversation_summaries.db')
        }

        # 2. Annotations, brain, proto summaries, history
        $annSrc = Join-Path $AgyDir 'annotations'
        if (Test-Path $annSrc) {
            Copy-TreeSafe -SourceDir $annSrc -DestDir (Join-Path $stageAgy 'annotations') -AllowSkipLockedLogs:$AllowLive
        }

        $brainSrc = Join-Path $AgyDir 'brain'
        if (Test-Path $brainSrc) {
            Copy-TreeSafe -SourceDir $brainSrc -DestDir (Join-Path $stageAgy 'brain') -AllowSkipLockedLogs:$AllowLive
        }

        foreach ($singleFile in @('jetbox_summaries_proto.pb', 'history.jsonl')) {
            $srcPath = Join-Path $AgyDir $singleFile
            if (Test-Path $srcPath) {
                Copy-FileSharedRead -Src $srcPath -Dst (Join-Path $stageAgy $singleFile)
            }
        }

        # 3. Portable global rules/agents (never auth/machine-local files)
        $globalGeminiMd = Join-Path $GeminiDir 'GEMINI.md'
        if (Test-Path $globalGeminiMd) {
            Copy-FileSharedRead -Src $globalGeminiMd -Dst (Join-Path $stageGemini 'GEMINI.md')
        }
        $agentsSrc = Join-Path $GeminiDir 'config\agents'
        if (Test-Path $agentsSrc) {
            Copy-TreeSafe -SourceDir $agentsSrc -DestDir (Join-Path $stageGemini 'config\agents') -AllowSkipLockedLogs:$AllowLive
        }

        # 4. Metadata
        $titles = @(Get-LocalConversationTitles)
        $convDbCount = 0
        if (Test-Path (Join-Path $stageAgy 'conversations')) {
            $convDbCount = @(Get-ChildItem -Path (Join-Path $stageAgy 'conversations') -Filter '*.db' -File).Count
        }
        $pushedAtUtc = [DateTime]::UtcNow.ToString('o')
        $metaObj = [ordered]@{
            pushedAtUtc       = $pushedAtUtc
            machineName       = $env:COMPUTERNAME
            userName          = $env:USERNAME
            liveSnapshot      = [bool]$AllowLive
            agyRunning        = $isLive
            conversationCount = $convDbCount
            titles            = $titles
        }
        $metaJson = $metaObj | ConvertTo-Json -Depth 6
        [System.IO.File]::WriteAllText($metaPath, $metaJson, [System.Text.UTF8Encoding]::new($false))
        [System.IO.File]::WriteAllText((Join-Path $staging 'sync-meta.json'), $metaJson, [System.Text.UTF8Encoding]::new($false))

        # 5. Zip & upload/copy
        [System.IO.Compression.ZipFile]::CreateFromDirectory($staging, $zipPath, [System.IO.Compression.CompressionLevel]::Optimal, $false)
        $zipSizeMb = [Math]::Round(((Get-Item $zipPath).Length / 1MB), 2)

        if ($useTargetDir) {
            Copy-Item -Path $zipPath -Destination (Join-Path $TargetDir 'agy-state.zip') -Force
            Copy-Item -Path $metaPath -Destination (Join-Path $TargetDir 'sync-meta.json') -Force
            $destLabel = $TargetDir
        } else {
            $upRes = Invoke-GhRaw -GhArgs @('release', 'upload', 'latest', $zipPath, $metaPath, '--repo', $resolvedRepo, '--clobber')
            if ($upRes.ExitCode -ne 0) {
                throw "Failed to upload sync assets to '$resolvedRepo': $($upRes.Output)"
            }
            $destLabel = "github.com/$resolvedRepo (release: latest)"
        }

        Write-Host ""
        Write-Host "Push complete:" -ForegroundColor Green
        Write-Host "  Destination : $destLabel"
        Write-Host "  Archive size: $zipSizeMb MB"
        Write-Host "  Pushed UTC  : $pushedAtUtc"
        Write-Host "  Live mode   : $([bool]$AllowLive) (agy running: $isLive)"
        Write-Host "  DB sessions : $convDbCount"
        Write-Host "  Titled chats ($($titles.Count)):"
        foreach ($item in $titles) {
            Write-Host "    - [$($item.id)] $($item.title)"
        }
    } finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Convert-ToUtcDateTime {
    param($Value)
    if ($Value -is [DateTimeOffset]) {
        return $Value.UtcDateTime
    }
    if ($Value -is [DateTime]) {
        if ($Value.Kind -eq [System.DateTimeKind]::Utc) {
            return $Value
        }
        if ($Value.Kind -eq [System.DateTimeKind]::Local) {
            return $Value.ToUniversalTime()
        }
        return [DateTime]::SpecifyKind($Value, [System.DateTimeKind]::Utc)
    }
    return [DateTimeOffset]::Parse(
        [string]$Value,
        [System.Globalization.CultureInfo]::InvariantCulture,
        [System.Globalization.DateTimeStyles]::AssumeUniversal
    ).UtcDateTime
}

function Get-RemoteMeta {
    param([string]$TempDir, [string]$ResolvedRepo)
    $metaDest = Join-Path $TempDir 'sync-meta.json'
    if (-not [string]::IsNullOrWhiteSpace($TargetDir)) {
        $srcMeta = Join-Path $TargetDir 'sync-meta.json'
        if (-not (Test-Path $srcMeta)) {
            throw "No remote sync-meta.json found in '$TargetDir'. Run 'push' first."
        }
        Copy-Item -Path $srcMeta -Destination $metaDest -Force
    } else {
        Assert-PrivateRepo -RepoName $ResolvedRepo
        if (-not (Test-ReleaseExists -RepoName $ResolvedRepo -Tag 'latest')) {
            throw "Release 'latest' does not exist in '$ResolvedRepo'. Run 'push' from your source laptop first."
        }
        $dlRes = Invoke-GhRaw -GhArgs @('release', 'download', 'latest', '--repo', $ResolvedRepo, '--pattern', 'sync-meta.json', '--dir', $TempDir, '--clobber')
        if ($dlRes.ExitCode -ne 0 -or -not (Test-Path $metaDest)) {
            throw "Failed to download sync-meta.json from '$ResolvedRepo': $($dlRes.Output)"
        }
    }
    return (Get-Content -Path $metaDest -Raw | ConvertFrom-Json)
}

function Invoke-PullAction {
    $running = @(Get-RunningAgyProcesses)
    if ($running.Count -gt 0) {
        $procDesc = ($running | ForEach-Object { "$($_.Name) (PID $($_.Id))" }) -join ', '
        throw "ABORTED: Antigravity CLI is currently running ($procDesc). Exit agy completely before running 'pull' to prevent database corruption."
    }

    $useTargetDir = -not [string]::IsNullOrWhiteSpace($TargetDir)
    $resolvedRepo = ''
    if (-not $useTargetDir) {
        $resolvedRepo = Resolve-SyncRepo -CurrentRepo $Repo
    }

    $tempRoot = Join-Path $env:TEMP ("agy-sync-pull-" + [guid]::NewGuid().ToString('N'))
    $extractDir = Join-Path $tempRoot 'extracted'

    try {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        $meta = Get-RemoteMeta -TempDir $tempRoot -ResolvedRepo $resolvedRepo

        $remoteUtc = Convert-ToUtcDateTime $meta.pushedAtUtc
        $localUtc = Get-LocalLatestDbTimestampUtc
        if ($null -ne $localUtc -and $localUtc -gt $remoteUtc -and -not $Force) {
            throw ("ABORTED: Local SQLite DB timestamp ($($localUtc.ToString('o'))) is newer than remote snapshot ($($remoteUtc.ToString('o')) from $($meta.machineName)). " +
                   "Push from this machine instead, or re-run with -Force to overwrite local chats.")
        }

        $zipDest = Join-Path $tempRoot 'agy-state.zip'
        if ($useTargetDir) {
            $srcZip = Join-Path $TargetDir 'agy-state.zip'
            if (-not (Test-Path $srcZip)) {
                throw "No agy-state.zip found in '$TargetDir'."
            }
            Copy-Item -Path $srcZip -Destination $zipDest -Force
        } else {
            $dlZipRes = Invoke-GhRaw -GhArgs @('release', 'download', 'latest', '--repo', $resolvedRepo, '--pattern', 'agy-state.zip', '--dir', $tempRoot, '--clobber')
            if ($dlZipRes.ExitCode -ne 0 -or -not (Test-Path $zipDest)) {
                throw "Failed to download agy-state.zip from '$resolvedRepo': $($dlZipRes.Output)"
            }
        }

        [System.IO.Compression.ZipFile]::ExtractToDirectory($zipDest, $extractDir)

        # Backup current local state before modifying ~/.gemini
        $backupDir = Join-Path $env:TEMP ("agy-sync-backups\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
        New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
        if (Test-Path $AgyDir) {
            $backupAgy = Join-Path $backupDir 'antigravity-cli'
            New-Item -ItemType Directory -Path $backupAgy -Force | Out-Null
            foreach ($sub in @('conversations', 'annotations', 'brain')) {
                $p = Join-Path $AgyDir $sub
                if (Test-Path $p) {
                    Copy-Item -Path $p -Destination (Join-Path $backupAgy $sub) -Recurse -Force
                }
            }
            foreach ($f in @('conversation_summaries.db', 'jetbox_summaries_proto.pb', 'history.jsonl')) {
                $p = Join-Path $AgyDir $f
                if (Test-Path $p) {
                    Copy-Item -Path $p -Destination (Join-Path $backupAgy $f) -Force
                }
            }
        }
        $backupGemini = Join-Path $backupDir 'gemini'
        if (Test-Path (Join-Path $GeminiDir 'GEMINI.md')) {
            New-Item -ItemType Directory -Path $backupGemini -Force | Out-Null
            Copy-Item -Path (Join-Path $GeminiDir 'GEMINI.md') -Destination (Join-Path $backupGemini 'GEMINI.md') -Force
        }
        if (Test-Path (Join-Path $GeminiDir 'config\agents')) {
            New-Item -ItemType Directory -Path (Join-Path $backupGemini 'config') -Force | Out-Null
            Copy-Item -Path (Join-Path $GeminiDir 'config\agents') -Destination (Join-Path $backupGemini 'config\agents') -Recurse -Force
        }

        # Ensure destination directories exist
        New-Item -ItemType Directory -Path $AgyDir -Force | Out-Null
        New-Item -ItemType Directory -Path $GeminiDir -Force | Out-Null

        # Remove stale WAL/SHM files before restoring clean snapshots
        $localConvDir = Join-Path $AgyDir 'conversations'
        if (Test-Path $localConvDir) {
            Get-ChildItem -Path $localConvDir -Include '*.db-wal', '*.db-shm' -Recurse -File -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
        }
        foreach ($staleSummary in @('conversation_summaries.db-wal', 'conversation_summaries.db-shm')) {
            $p = Join-Path $AgyDir $staleSummary
            if (Test-Path $p) {
                Remove-Item -Path $p -Force -ErrorAction SilentlyContinue
            }
        }

        # Restore antigravity-cli state
        $extractedAgy = Join-Path $extractDir 'antigravity-cli'
        foreach ($sub in @('conversations', 'annotations', 'brain')) {
            $srcSub = Join-Path $extractedAgy $sub
            $dstSub = Join-Path $AgyDir $sub
            if (Test-Path $dstSub) {
                Remove-Item -Path $dstSub -Recurse -Force
            }
            if (Test-Path $srcSub) {
                Copy-Item -Path $srcSub -Destination $dstSub -Recurse -Force
            }
        }
        foreach ($f in @('conversation_summaries.db', 'jetbox_summaries_proto.pb', 'history.jsonl')) {
            $srcF = Join-Path $extractedAgy $f
            if (Test-Path $srcF) {
                Copy-Item -Path $srcF -Destination (Join-Path $AgyDir $f) -Force
            }
        }

        # Restore portable global rules/agents (machine-local auth files untouched)
        $extractedGemini = Join-Path $extractDir 'gemini'
        $srcGeminiMd = Join-Path $extractedGemini 'GEMINI.md'
        if (Test-Path $srcGeminiMd) {
            Copy-Item -Path $srcGeminiMd -Destination (Join-Path $GeminiDir 'GEMINI.md') -Force
        }
        $srcAgents = Join-Path $extractedGemini 'config\agents'
        if (Test-Path $srcAgents) {
            $dstAgents = Join-Path $GeminiDir 'config\agents'
            New-Item -ItemType Directory -Path (Split-Path $dstAgents -Parent) -Force | Out-Null
            if (Test-Path $dstAgents) {
                Remove-Item -Path $dstAgents -Recurse -Force
            }
            Copy-Item -Path $srcAgents -Destination $dstAgents -Recurse -Force
        }

        Write-Host ""
        Write-Host "Pull complete:" -ForegroundColor Green
        Write-Host "  Backup saved : $backupDir"
        Write-Host "  Source host  : $($meta.machineName) ($($meta.userName))"
        Write-Host ("  Snapshot UTC : {0}" -f $remoteUtc.ToString('o'))
        Write-Host "  DB sessions  : $($meta.conversationCount)"
        Write-Host "  Restored titled chats ($(@($meta.titles).Count)):"
        foreach ($item in @($meta.titles)) {
            Write-Host "    - [$($item.id)] $($item.title)"
        }
    } finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

function Invoke-StatusAction {
    $localTitles = @(Get-LocalConversationTitles)
    $localUtc = Get-LocalLatestDbTimestampUtc
    $localConvCount = 0
    $convDir = Join-Path $AgyDir 'conversations'
    if (Test-Path $convDir) {
        $localConvCount = @(Get-ChildItem -Path $convDir -Filter '*.db' -File -ErrorAction SilentlyContinue).Count
    }

    Write-Host "=== Local State ($env:COMPUTERNAME) ===" -ForegroundColor Cyan
    Write-Host "  DB sessions : $localConvCount"
    if ($null -ne $localUtc) {
        Write-Host ("  Latest DB   : {0} UTC ({1} local)" -f $localUtc.ToString('o'), $localUtc.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss'))
    } else {
        Write-Host "  Latest DB   : (none)"
    }
    Write-Host "  Titled chats ($($localTitles.Count)):"
    foreach ($item in $localTitles) {
        Write-Host "    - [$($item.id)] $($item.title)"
    }

    $tempRoot = Join-Path $env:TEMP ("agy-sync-status-" + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $tempRoot -Force | Out-Null
        $resolvedRepo = ''
        if ([string]::IsNullOrWhiteSpace($TargetDir)) {
            $resolvedRepo = Resolve-SyncRepo -CurrentRepo $Repo
        }
        Write-Host ""
        if ([string]::IsNullOrWhiteSpace($TargetDir)) {
            Write-Host "=== Remote State (github.com/$resolvedRepo) ===" -ForegroundColor Cyan
        } else {
            Write-Host "=== Remote State ($TargetDir) ===" -ForegroundColor Cyan
        }

        $meta = Get-RemoteMeta -TempDir $tempRoot -ResolvedRepo $resolvedRepo
        $remoteUtc = Convert-ToUtcDateTime $meta.pushedAtUtc
        Write-Host "  Source host : $($meta.machineName) ($($meta.userName))"
        Write-Host ("  Pushed      : {0} UTC ({1} local)" -f $remoteUtc.ToString('o'), $remoteUtc.ToLocalTime().ToString('yyyy-MM-dd HH:mm:ss'))
        Write-Host "  Live snap   : $($meta.liveSnapshot)"
        Write-Host "  DB sessions : $($meta.conversationCount)"
        Write-Host "  Titled chats ($(@($meta.titles).Count)):"
        foreach ($item in @($meta.titles)) {
            Write-Host "    - [$($item.id)] $($item.title)"
        }
    } catch {
        Write-Warning "Remote status unavailable: $($_.Exception.Message)"
    } finally {
        if (Test-Path $tempRoot) {
            Remove-Item -Path $tempRoot -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

switch ($Action) {
    'init'   { Invoke-InitAction }
    'push'   { Invoke-PushAction }
    'pull'   { Invoke-PullAction }
    'status' { Invoke-StatusAction }
}
