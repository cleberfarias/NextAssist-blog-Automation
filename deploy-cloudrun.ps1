param(
  [string]$Project = "rr-infocell",
  [string]$Service = "nextassist-blog-panel",
  [string]$Region = "southamerica-east1"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$gcloudCommand = Get-Command gcloud.cmd -ErrorAction SilentlyContinue
if (-not $gcloudCommand) {
  $gcloudCommand = Get-Command gcloud -ErrorAction Stop
}
$gcloud = $gcloudCommand.Source

if (-not (Test-Path -LiteralPath ".env")) {
  throw ".env não encontrado. Copie .env.example e preencha PANEL_PASSWORD."
}

$passwordLine = Get-Content -LiteralPath ".env" |
  Where-Object { $_ -match "^\s*PANEL_PASSWORD\s*=" } |
  Select-Object -Last 1

if (-not $passwordLine) {
  throw "PANEL_PASSWORD não foi definida no .env."
}

$panelPassword = ($passwordLine -split "=", 2)[1].Trim()
if (
  ($panelPassword.StartsWith('"') -and $panelPassword.EndsWith('"')) -or
  ($panelPassword.StartsWith("'") -and $panelPassword.EndsWith("'"))
) {
  $panelPassword = $panelPassword.Substring(1, $panelPassword.Length - 2)
}
if ([string]::IsNullOrWhiteSpace($panelPassword)) {
  throw "PANEL_PASSWORD está vazia no .env."
}

$secret = "nextassist-panel-password"
$existingSecrets = & $gcloud secrets list --project $Project --format="value(name)"
if ($LASTEXITCODE -ne 0) { throw "Falha ao consultar os segredos do projeto." }
if ($secret -notin @($existingSecrets)) {
  & $gcloud secrets create $secret --project $Project --replication-policy="automatic" --quiet
  if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o segredo $secret." }
}

$tempFile = [System.IO.Path]::GetTempFileName()
try {
  [System.IO.File]::WriteAllText(
    $tempFile,
    $panelPassword,
    [System.Text.UTF8Encoding]::new($false)
  )
  & $gcloud secrets versions add $secret --project $Project --data-file=$tempFile --quiet
  if ($LASTEXITCODE -ne 0) { throw "Falha ao adicionar a versão do segredo $secret." }
}
finally {
  Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
}

$runtimeServiceAccount = & $gcloud run services describe $Service `
  --project $Project `
  --region $Region `
  --format="value(spec.template.spec.serviceAccountName)"
if ($LASTEXITCODE -ne 0) {
  throw "Serviço Cloud Run $Service não encontrado em $Region."
}

if ([string]::IsNullOrWhiteSpace($runtimeServiceAccount)) {
  $projectNumber = & $gcloud projects describe $Project --format="value(projectNumber)"
  if ($LASTEXITCODE -ne 0) { throw "Não foi possível obter o número do projeto." }
  $runtimeServiceAccount = "$projectNumber-compute@developer.gserviceaccount.com"
}

& $gcloud secrets add-iam-policy-binding $secret `
  --project $Project `
  --member="serviceAccount:$runtimeServiceAccount" `
  --role="roles/secretmanager.secretAccessor" `
  --quiet `
  --format="none"
if ($LASTEXITCODE -ne 0) { throw "Falha ao conceder acesso ao segredo." }

& $gcloud run deploy $Service `
  --project $Project `
  --region $Region `
  --source "." `
  --allow-unauthenticated `
  --memory "512Mi" `
  --update-env-vars="DATA_SOURCE=github" `
  --update-secrets="PANEL_PASSWORD=${secret}:latest" `
  --quiet
if ($LASTEXITCODE -ne 0) { throw "Falha no deploy do Cloud Run." }

$url = & $gcloud run services describe $Service `
  --project $Project `
  --region $Region `
  --format="value(status.url)"
if ($LASTEXITCODE -ne 0) { throw "Deploy concluído, mas não foi possível obter a URL." }

Write-Host ""
Write-Host "Deploy concluído: $url"
