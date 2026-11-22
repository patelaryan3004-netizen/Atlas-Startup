# Saves the founding-member list from the live site to a private file on this computer, so it can be imported into the database (docs/database.md, step 3) or kept as a backup copy.
#
# It asks for the admin key (the ADMIN_KEY set on the Render service) in a hidden prompt: the key is never put in a command line, a file or the project.
# The file holds email addresses, so it is written to your user folder, outside the project, and this script prints only how many people are in it.
param(
  [string]$Api = 'https://atlas-startup.onrender.com',
  [string]$Out = (Join-Path $env:USERPROFILE 'founding-export.json')
)
$ErrorActionPreference = 'Stop'

Write-Host ''
Write-Host 'This saves the founding-member list from the live site to a private file on this computer.'
Write-Host "The file will be: $Out"
Write-Host ''
$secure = Read-Host 'Paste your admin key here (nothing shows as you paste), then press Enter' -AsSecureString
$key = (New-Object System.Net.NetworkCredential('', $secure)).Password
if ([string]::IsNullOrWhiteSpace($key)) {
  Write-Host 'No key was entered, so nothing was done.' -ForegroundColor Yellow
  exit 1
}

Write-Host ''
Write-Host 'Asking the live site... (the free server can take about 15 seconds to wake up)'
try {
  $response = Invoke-WebRequest -Uri "$Api/api/admin/network/founding" -Headers @{ 'x-admin-key' = $key } -UseBasicParsing -TimeoutSec 120
} catch {
  $status = 0
  $said = ''
  if ($_.Exception.Response) {
    $status = [int]$_.Exception.Response.StatusCode
    try { $said = (New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())).ReadToEnd() | ConvertFrom-Json | Select-Object -ExpandProperty error } catch { }
  }
  Write-Host ''
  Write-Host 'The live site did not give the list.' -ForegroundColor Yellow
  if ($status -eq 500) {
    # the live site as it is today answers a missing or wrong key with a plain 500 (the fix is in the pull request that adds the database)
    Write-Host 'It answered 500 (server error). On the live site as it is today, that is how a wrong key shows up, or no admin key being set on the server at all.'
  } elseif ($status -eq 429) {
    Write-Host 'It answered 429: too many wrong keys were tried. Wait ten minutes before trying again.'
  } elseif ($status) {
    Write-Host "It answered $status. $said"
  } else {
    Write-Host 'It did not answer (no internet, or the server is still waking up). Wait a minute and run this again.'
  }
  exit 1
} finally {
  $key = $null
}

$list = $response.Content | ConvertFrom-Json
[System.IO.File]::WriteAllText($Out, $response.Content, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ''
Write-Host "Done. People on the list: $($list.count)" -ForegroundColor Green
Write-Host "Saved to: $Out"
Write-Host 'The file holds email addresses: keep it private, and delete it after it has been imported.'
if ($list.count -eq 0) { Write-Host 'The list is empty, so there is nothing to import.' }
