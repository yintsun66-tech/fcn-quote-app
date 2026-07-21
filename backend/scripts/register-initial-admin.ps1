param(
  [string]$ApiBase = "https://api.yintsun66.com",
  [string]$ResolveAddress = "",
  [ValidatePattern("^\d{5}$")]
  [string]$EmployeeNumber = "",
  [string]$InitialBranchName = "",
  [string]$InitialDisplayName = "",
  [ValidatePattern("^$|^[a-z0-9._-]{5,50}$")]
  [string]$InitialUsername = ""
)

$ErrorActionPreference = "Stop"
$ApiBase = $ApiBase.TrimEnd("/")

function Read-RequiredValue([string]$Prompt) {
  do {
    $value = (Read-Host $Prompt).Trim()
  } while (-not $value)
  return $value
}

function ConvertTo-PlainText([Security.SecureString]$Value) {
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Value)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($pointer)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($pointer)
  }
}

Write-Host "FCN Quote initial administrator registration" -ForegroundColor Cyan
Write-Host "Sensitive values are sent only to $ApiBase over HTTPS and are not written to disk."

if ($EmployeeNumber) {
  $employeeNumber = $EmployeeNumber
} else {
  do {
    $employeeNumber = (Read-Host "Employee number (exactly 5 digits)").Trim()
  } while ($employeeNumber -notmatch "^\d{5}$")
}

$branchName = if ($InitialBranchName) { $InitialBranchName.Trim() } else { Read-RequiredValue "Branch name" }
$displayName = if ($InitialDisplayName) { $InitialDisplayName.Trim() } else { Read-RequiredValue "Display name" }

if ($InitialUsername) {
  $username = $InitialUsername.Trim().ToLowerInvariant()
} else {
  do {
    $username = (Read-Host "Username (5-50 lowercase letters, digits, dot, underscore, or hyphen)").Trim().ToLowerInvariant()
  } while ($username -notmatch "^[a-z0-9._-]{5,50}$")
}

do {
  $password = ConvertTo-PlainText (Read-Host "Password (12-128 characters)" -AsSecureString)
  $confirmation = ConvertTo-PlainText (Read-Host "Confirm password" -AsSecureString)
  $passwordLengthValid = $password.Length -ge 12 -and $password.Length -le 128
  $passwordsMatch = $password -ceq $confirmation
  if (-not $passwordLengthValid) {
    Write-Warning "Password length must be between 12 and 128 characters. Please try again."
  } elseif (-not $passwordsMatch) {
    Write-Warning "Passwords do not match. Please try again."
  }
} while (-not $passwordLengthValid -or -not $passwordsMatch)

try {
  $body = @{
    employeeNumber = $employeeNumber
    branchName = $branchName
    displayName = $displayName
    username = $username
    password = $password
  } | ConvertTo-Json -Compress

  if ($ResolveAddress) {
    $apiHost = ([Uri]$ApiBase).Host
    $body | curl.exe `
      --silent `
      --show-error `
      --fail `
      --resolve "${apiHost}:443:${ResolveAddress}" `
      --request POST `
      --header "Origin: $ApiBase" `
      --header "Content-Type: application/json; charset=utf-8" `
      --data-binary '@-' `
      "$ApiBase/api/v1/auth/register" | Out-Null
    if ($LASTEXITCODE -ne 0) {
      throw "Registration request failed with curl exit code $LASTEXITCODE."
    }
  } else {
    Invoke-RestMethod `
      -Method Post `
      -Uri "$ApiBase/api/v1/auth/register" `
      -Headers @{ Origin = $ApiBase } `
      -ContentType "application/json; charset=utf-8" `
      -Body $body | Out-Null
  }

  Write-Host "Registration submitted for '$username'. Return to Codex and say that administrator registration is complete." -ForegroundColor Green
} finally {
  $password = $null
  $confirmation = $null
  $body = $null
}
