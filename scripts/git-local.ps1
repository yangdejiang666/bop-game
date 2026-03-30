$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent $PSScriptRoot
$gitDir = Join-Path $repoRoot "gitdata"

if (!(Test-Path -LiteralPath $gitDir)) {
  throw "Missing writable git metadata directory: $gitDir"
}

$gitArgs = @(
  "-c", "http.sslBackend=openssl",
  "--git-dir=$gitDir",
  "--work-tree=$repoRoot"
) + $args

& git @gitArgs
$exitCode = $LASTEXITCODE
exit $exitCode
