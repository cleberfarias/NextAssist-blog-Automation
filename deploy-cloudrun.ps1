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

function Read-DotenvValue([string]$Name) {
  $line = Get-Content -LiteralPath ".env" |
    Where-Object { $_ -match "^\s*$Name\s*=" } |
    Select-Object -Last 1
  if (-not $line) { return $null }
  $value = ($line -split "=", 2)[1].Trim()
  if (
    ($value.StartsWith('"') -and $value.EndsWith('"')) -or
    ($value.StartsWith("'") -and $value.EndsWith("'"))
  ) {
    $value = $value.Substring(1, $value.Length - 2)
  }
  if ([string]::IsNullOrWhiteSpace($value)) { return $null }
  return $value
}

# Opcional: token só com permissão de disparar Actions (actions:write), usado
# pelo botão "Rodar pipeline agora" do painel hospedado. Sem ele, o botão
# fica escondido no ar (o painel continua funcionando normalmente).
$dispatchToken = Read-DotenvValue "GITHUB_DISPATCH_TOKEN"

# Opcional: segredo compartilhado com a GitHub Action pra ela conseguir
# empurrar eventos ao vivo pro escritório do painel hospedado. Sem ele, o
# endpoint de ingestão fica sem token configurado (nega qualquer envio).
$ingestToken = Read-DotenvValue "PANEL_INGEST_TOKEN"

function Set-CloudRunSecret([string]$SecretName, [string]$Value) {
  $existingSecrets = & $gcloud secrets list --project $Project --format="value(name)"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao consultar os segredos do projeto." }
  if ($SecretName -notin @($existingSecrets)) {
    & $gcloud secrets create $SecretName --project $Project --replication-policy="automatic" --quiet
    if ($LASTEXITCODE -ne 0) { throw "Falha ao criar o segredo $SecretName." }
  }

  $tempFile = [System.IO.Path]::GetTempFileName()
  try {
    [System.IO.File]::WriteAllText($tempFile, $Value, [System.Text.UTF8Encoding]::new($false))
    & $gcloud secrets versions add $SecretName --project $Project --data-file=$tempFile --quiet
    if ($LASTEXITCODE -ne 0) { throw "Falha ao adicionar a versão do segredo $SecretName." }
  }
  finally {
    Remove-Item -LiteralPath $tempFile -Force -ErrorAction SilentlyContinue
  }
}

$secret = "nextassist-panel-password"
Set-CloudRunSecret -SecretName $secret -Value $panelPassword

$dispatchSecret = "nextassist-github-dispatch-token"
if ($dispatchToken) {
  Set-CloudRunSecret -SecretName $dispatchSecret -Value $dispatchToken
}

$ingestSecret = "nextassist-panel-ingest-token"
if ($ingestToken) {
  Set-CloudRunSecret -SecretName $ingestSecret -Value $ingestToken
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

function Grant-SecretAccess([string]$SecretName) {
  & $gcloud secrets add-iam-policy-binding $SecretName `
    --project $Project `
    --member="serviceAccount:$runtimeServiceAccount" `
    --role="roles/secretmanager.secretAccessor" `
    --quiet `
    --format="none"
  if ($LASTEXITCODE -ne 0) { throw "Falha ao conceder acesso ao segredo $SecretName." }
}

Grant-SecretAccess -SecretName $secret
$updateSecrets = "PANEL_PASSWORD=${secret}:latest"
if ($dispatchToken) {
  Grant-SecretAccess -SecretName $dispatchSecret
  $updateSecrets += ",GITHUB_DISPATCH_TOKEN=${dispatchSecret}:latest"
}
if ($ingestToken) {
  Grant-SecretAccess -SecretName $ingestSecret
  $updateSecrets += ",PANEL_INGEST_TOKEN=${ingestSecret}:latest"
}

& $gcloud run deploy $Service `
  --project $Project `
  --region $Region `
  --source "." `
  --allow-unauthenticated `
  --memory "512Mi" `
  --update-env-vars="DATA_SOURCE=github" `
  --update-secrets=$updateSecrets `
  --quiet
if ($LASTEXITCODE -ne 0) { throw "Falha no deploy do Cloud Run." }

$url = & $gcloud run services describe $Service `
  --project $Project `
  --region $Region `
  --format="value(status.url)"
if ($LASTEXITCODE -ne 0) { throw "Deploy concluído, mas não foi possível obter a URL." }

Write-Host ""
Write-Host "Deploy concluído: $url"
