<#
  Compacts every registered WSL distro's ext4.vhdx that actually exists on
  disk - discovered from the registry rather than a hardcoded path/GUID, so
  this keeps working if a distro is ever reinstalled or a name changes.

  Must run with every WSL distro already shut down (compact-wsl.bat does
  `wsl --shutdown` right before calling this) - diskpart needs the vhdx
  file unlocked to attach it.
#>

$ErrorActionPreference = "Stop"

function Format-GB {
    param([long]$Bytes)
    "{0:N2} GB" -f ($Bytes / 1GB)
}

$lxssKey = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Lxss"
if (-not (Test-Path $lxssKey)) {
    Write-Host "No registered WSL distros found under $lxssKey - nothing to compact."
    exit 0
}

$disks = Get-ChildItem $lxssKey | ForEach-Object {
    $props = Get-ItemProperty $_.PSPath
    if ($props.BasePath) {
        # BasePath is sometimes stored with a \\?\ long-path prefix -
        # Test-Path/Join-Path handle it fine either way, but stripping it
        # keeps the printed path readable.
        $basePath = $props.BasePath -replace '^\\\\\?\\', ''
        $vhdxPath = Join-Path $basePath "ext4.vhdx"
        if (Test-Path $vhdxPath) {
            [PSCustomObject]@{
                Name = $props.DistributionName
                Path = $vhdxPath
            }
        }
    }
}

if (-not $disks) {
    Write-Host "No WSL disk files (ext4.vhdx) found to compact."
    exit 0
}

foreach ($disk in $disks) {
    $before = (Get-Item $disk.Path).Length
    Write-Host "  - $($disk.Name): $($disk.Path)"
    Write-Host "    $(Format-GB $before) before compacting..."

    $diskpartScript = @"
select vdisk file="$($disk.Path)"
attach vdisk readonly
compact vdisk
detach vdisk
"@
    # diskpart reads its script from stdin; errors here (e.g. the vhdx is
    # still locked because something didn't actually shut down) print to
    # its own stdout rather than throwing, so they are surfaced as-is
    # instead of silently swallowed.
    $diskpartScript | diskpart | Write-Host

    $after = (Get-Item $disk.Path).Length
    $freed = $before - $after
    Write-Host "    $(Format-GB $after) after (freed $(Format-GB $freed))"
    Write-Host ""
}
