# runcastle installer for Windows:
#   irm https://runcastle.dev/install.ps1 | iex
#
# It puts Bun and runcastle in your home folder, then hands over to
# `runcastle setup`, which shows what else is missing and asks one yes.
# Arguments are passed on to setup when the script is run as a file
# (--yes, --agent claude|codex|both); through `iex`, set $env:RUNCASTLE_SETUP_ARGS.
#
# This runs through iex, so it never calls `exit`: that would close your window.
# It returns, and sets $global:LASTEXITCODE for callers that look.

$MinBunVersion = [version]'1.3.14'

function Install-Runcastle {
  param([string[]]$SetupArgs)

  $assumeYes = ($SetupArgs -contains '--yes') -or ($SetupArgs -contains '-y')
  $bunBin = Join-Path $HOME '.bun\bin'

  function Update-BunPath {
    if (($env:Path -split ';') -notcontains $bunBin) { $env:Path = "$bunBin;$env:Path" }
  }

  function Confirm-Step([string]$Question, [string]$Manual) {
    if ($assumeYes) { return $true }
    if (-not [Environment]::UserInteractive -or [Console]::IsInputRedirected) {
      Write-Host "No terminal to ask on. Run this yourself, or re-run the installer with --yes:"
      Write-Host "  $Manual"
      return $false
    }
    $reply = Read-Host "$Question [y/N]"
    if ($reply -match '^(y|yes)$') { return $true }
    Write-Host "Not done. To do it yourself: $Manual"
    return $false
  }

  Update-BunPath

  if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    Write-Host 'Installing Bun...'
    Invoke-RestMethod bun.sh/install.ps1 | Invoke-Expression
    Update-BunPath
    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
      throw 'Bun installed, but is not on PATH.'
    }
  } else {
    $current = [version](((& bun --version) -split '[-+]')[0])
    if ($current -lt $MinBunVersion) {
      Write-Host "Bun $current is older than $MinBunVersion, which runcastle needs."
      if (-not (Confirm-Step 'Upgrade Bun?' 'bun upgrade')) { throw 'Bun is too old.' }
      & bun upgrade
      if ($LASTEXITCODE -ne 0) { throw 'bun upgrade failed.' }
    }
  }

  $help = ''
  if (Get-Command runcastle -ErrorAction SilentlyContinue) { $help = (& runcastle --help 2>&1) -join "`n" }
  if ($help -notmatch 'setup') {
    Write-Host 'Installing runcastle...'
    $spec = if ($env:RUNCASTLE_INSTALL_SPEC) { $env:RUNCASTLE_INSTALL_SPEC } else { 'runcastle@latest' }
    & bun add -g $spec
    if ($LASTEXITCODE -ne 0) { throw 'bun add -g failed.' }
    if (-not (Get-Command runcastle -ErrorAction SilentlyContinue)) {
      throw 'runcastle installed, but is not on PATH.'
    }
  }

  & runcastle setup @SetupArgs
  $global:LASTEXITCODE = $LASTEXITCODE
}

$setupArgs = @($args)
if ($env:RUNCASTLE_SETUP_ARGS) { $setupArgs += @($env:RUNCASTLE_SETUP_ARGS -split '\s+' | Where-Object { $_ }) }
try {
  Install-Runcastle -SetupArgs $setupArgs
} catch {
  Write-Host $_.Exception.Message -ForegroundColor Red
  $global:LASTEXITCODE = 1
}
