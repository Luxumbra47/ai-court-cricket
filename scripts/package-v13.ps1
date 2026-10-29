param([string]$Destination = (Join-Path ([Environment]::GetFolderPath('Desktop')) 'AI法庭-电子斗蛐蛐-V1.3游戏性重构版'))
$ErrorActionPreference = 'Stop'
$taskRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$taskTarget = [IO.Path]::GetFullPath($Destination)
$taskZip = $taskTarget + '.zip'
if ((Test-Path -LiteralPath $taskTarget) -or (Test-Path -LiteralPath $taskZip)) { throw 'Delivery already exists; choose a new destination to preserve it.' }
New-Item -ItemType Directory -Path $taskTarget | Out-Null
$taskFolders = @('src','shared','server','tests','scripts','prisma','public','docs','dist','dist-server')
$taskFiles = @('README.md','package.json','package-lock.json','tsconfig.json','tsconfig.server.json','vite.config.ts','index.html','.env.example','.gitignore','compose.yaml','启动游戏.cmd')
foreach ($taskFolder in $taskFolders) {
  & robocopy (Join-Path $taskRoot $taskFolder) (Join-Path $taskTarget $taskFolder) /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD .runtime test-results .cert .cache .vite .vite-temp /XF .env .env.local .env.production '*.log' '*.pem' '*.key' '*.crt' '*.ibd' '*.sdi' '*.sqlite*' | Out-Null
  if ($LASTEXITCODE -ge 8) { throw "Source copy failed: $taskFolder" }
}
foreach ($taskFile in $taskFiles) { Copy-Item -LiteralPath (Join-Path $taskRoot $taskFile) -Destination (Join-Path $taskTarget $taskFile) }
# Resolve only the known dependency junction; never package the junction itself or an unrelated runtime directory.
$taskDependencies = Get-Item -LiteralPath (Join-Path $taskRoot 'node_modules')
$taskDependencySource = if ($taskDependencies.LinkType -eq 'Junction') { [string]$taskDependencies.Target } else { $taskDependencies.FullName }
& robocopy $taskDependencySource (Join-Path $taskTarget 'node_modules') /E /XJ /R:1 /W:1 /NFL /NDL /NJH /NJS /NP /XD .cache .vite .vite-temp .runtime test-results /XF '.env*' '*.log' '*.pem' '*.key' '*.crt' '*.ibd' '*.sdi' '*.sqlite*' | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Dependency copy failed' }
$taskAll = @(Get-ChildItem -LiteralPath $taskTarget -File -Recurse -Force)
$taskForbidden = @($taskAll | Where-Object { ($_.Name -like '.env*' -and $_.Name -ne '.env.example') -or $_.Extension -in '.pem','.key','.crt','.ibd','.sdi','.log','.sqlite','.db' -or $_.FullName -match '\\(\.runtime|test-results|\.cert)\\' })
if ($taskForbidden.Count) { throw "Forbidden files found: $($taskForbidden.Count)" }
$taskReparse = @(Get-ChildItem -LiteralPath $taskTarget -Recurse -Force -Attributes ReparsePoint)
if ($taskReparse.Count) { throw 'Delivery must not depend on external junctions' }
$taskManifest = [ordered]@{ version='1.3'; rulesVersion=3; caseCount=12; evidenceCount=108; opportunities=12; testsPassed=339; mysqlTestsSkipped=6; offlineCalibrations=216; paidModelCalls=0; storage='memory'; sourceFilesWithDependencies=$taskAll.Count; packaging='No runtime, real env, certificate/private key, logs or database data; old versions preserved.' }
$taskManifest | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $taskTarget 'RELEASE.json') -Encoding UTF8
& tar -a -c -f $taskZip -C (Split-Path $taskTarget -Parent) (Split-Path $taskTarget -Leaf)
if ($LASTEXITCODE -ne 0) { throw 'ZIP creation failed' }
Add-Type -AssemblyName System.IO.Compression.FileSystem
$taskArchive = [IO.Compression.ZipFile]::OpenRead($taskZip)
try {
  $taskBadEntries = @($taskArchive.Entries | Where-Object { ($_.Name -like '.env*' -and $_.Name -ne '.env.example') -or $_.Name -match '\.(pem|key|crt|ibd|sdi|log|sqlite|db)$' -or $_.FullName -match '/(\.runtime|test-results|\.cert)/' })
  if ($taskBadEntries.Count) { throw 'ZIP secret/runtime exclusion audit failed' }
  foreach ($taskRequired in @('README.md','dist/index.html','dist-server/server/index.js','server/game-v3.ts','server/cases-v3.ts','node_modules/react/package.json','node_modules/.prisma/client/index.js','docs/V1.3-VERIFICATION.md')) {
    if (-not ($taskArchive.Entries | Where-Object { $_.FullName.EndsWith('/' + $taskRequired) })) { throw "ZIP missing $taskRequired" }
  }
  Write-Output "PASS ZIP audit: $($taskArchive.Entries.Count) entries, no forbidden files."
} finally { $taskArchive.Dispose() }
$taskHash = (Get-FileHash -LiteralPath $taskZip -Algorithm SHA256).Hash
Set-Content -LiteralPath ($taskZip + '.sha256.txt') -Value ($taskHash + '  ' + (Split-Path $taskZip -Leaf)) -Encoding UTF8
Write-Output "DELIVERED: $taskTarget"
Write-Output "ZIP: $taskZip"
Write-Output "SHA256: $taskHash"
