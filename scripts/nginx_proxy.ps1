[CmdletBinding()]
param(
    [ValidateSet("Render", "Configure", "Start", "Reload", "Stop", "Status")]
    [string]$Action = "Status",
    [string]$Domain = "",
    [string]$NginxRoot = "C:\nginx",
    [string]$CertificatePath = "",
    [string]$CertificateKeyPath = "",
    [int]$UpstreamPort = 8000,
    [switch]$HttpOnly
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$TemplatePath = Join-Path $ProjectRoot "config\nginx\team-loop.conf.template"
$NginxExe = Join-Path $NginxRoot "nginx.exe"
$ConfigDirectory = Join-Path $NginxRoot "conf"
$ConfigPath = Join-Path $ConfigDirectory "team-loop.conf"

function Convert-ToNginxPath([string]$Path) {
    return ([IO.Path]::GetFullPath($Path) -replace "\\", "/")
}

function Assert-NginxInstallation {
    if (-not (Test-Path -LiteralPath $NginxExe -PathType Leaf)) {
        throw "nginx.exe was not found at $NginxExe. Extract the Windows Nginx package and pass -NginxRoot."
    }
    if (-not (Test-Path -LiteralPath (Join-Path $ConfigDirectory "mime.types") -PathType Leaf)) {
        throw "mime.types was not found under $ConfigDirectory. Use a complete Nginx Windows package."
    }
}

function Assert-Domain([string]$Value) {
    if (-not $Value -or $Value.Length -gt 253 -or $Value -notmatch "^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z]{2,63}$") {
        throw "Pass a valid public domain with -Domain, for example meeting.example.com."
    }
}

function Get-NginxPrefix {
    return (Convert-ToNginxPath $NginxRoot).TrimEnd("/") + "/"
}

function Test-NginxConfig {
    Assert-NginxInstallation
    if (-not (Test-Path -LiteralPath $ConfigPath -PathType Leaf)) {
        throw "Configuration does not exist: $ConfigPath. Run -Action Configure first."
    }
    & $NginxExe -p (Get-NginxPrefix) -c "conf/team-loop.conf" -t
    if ($LASTEXITCODE -ne 0) {
        throw "Nginx configuration validation failed. Review logs/team-loop-error.log."
    }
}

function Write-NginxConfig([switch]$SkipValidation) {
    Assert-Domain $Domain
    if ($UpstreamPort -lt 1 -or $UpstreamPort -gt 65535) {
        throw "UpstreamPort must be between 1 and 65535."
    }
    if (-not $SkipValidation) {
        Assert-NginxInstallation
    }
    if (-not (Test-Path -LiteralPath $TemplatePath -PathType Leaf)) {
        throw "Nginx template does not exist: $TemplatePath"
    }

    $httpServer = if ($HttpOnly) {
@'
    server {
        listen 80;
        listen [::]:80;
        server_name {{DOMAIN}};

        location / {
            proxy_pass http://team_loop_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port $server_port;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_connect_timeout 10s;
            proxy_read_timeout 120s;
            proxy_send_timeout 120s;
            proxy_redirect off;
        }
    }
'@
    } else {
@'
    server {
        listen 80;
        listen [::]:80;
        server_name {{DOMAIN}};

        location /.well-known/acme-challenge/ {
            root html;
        }

        location / {
            return 301 https://$host$request_uri;
        }
    }
'@
    }

    $httpsServer = if ($HttpOnly) { "" } else {
@'
    server {
        listen 443 ssl;
        listen [::]:443 ssl;
        server_name {{DOMAIN}};

        ssl_certificate     "{{CERTIFICATE_PATH}}";
        ssl_certificate_key "{{CERTIFICATE_KEY_PATH}}";
        ssl_protocols TLSv1.2 TLSv1.3;
        ssl_session_cache shared:TeamLoopSSL:10m;
        ssl_session_timeout 1d;
        ssl_session_tickets off;

        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
        add_header X-Content-Type-Options "nosniff" always;
        add_header Referrer-Policy "strict-origin-when-cross-origin" always;

        location / {
            proxy_pass http://team_loop_backend;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $remote_addr;
            proxy_set_header X-Forwarded-Proto https;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port 443;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection $connection_upgrade;
            proxy_connect_timeout 10s;
            proxy_read_timeout 120s;
            proxy_send_timeout 120s;
            proxy_redirect off;
        }
    }
'@
    }

    if (-not $HttpOnly -and -not $SkipValidation) {
        if (-not (Test-Path -LiteralPath $CertificatePath -PathType Leaf)) {
            throw "TLS certificate was not found: $CertificatePath"
        }
        if (-not (Test-Path -LiteralPath $CertificateKeyPath -PathType Leaf)) {
            throw "TLS private key was not found: $CertificateKeyPath"
        }
    }

    $config = Get-Content -LiteralPath $TemplatePath -Raw -Encoding UTF8
    $config = $config.Replace("{{UPSTREAM_PORT}}", [string]$UpstreamPort)
    $config = $config.Replace("{{DOMAIN}}", $Domain.ToLowerInvariant())
    $config = $config.Replace("{{HTTP_SERVER}}", $httpServer.Replace("{{DOMAIN}}", $Domain.ToLowerInvariant()))
    $config = $config.Replace("{{HTTPS_SERVER}}", $httpsServer.Replace("{{DOMAIN}}", $Domain.ToLowerInvariant()))
    if (-not $HttpOnly) {
        $config = $config.Replace("{{CERTIFICATE_PATH}}", (Convert-ToNginxPath $CertificatePath))
        $config = $config.Replace("{{CERTIFICATE_KEY_PATH}}", (Convert-ToNginxPath $CertificateKeyPath))
    }

    foreach ($directory in @($ConfigDirectory, (Join-Path $NginxRoot "logs"), (Join-Path $NginxRoot "temp"))) {
        New-Item -ItemType Directory -Force -Path $directory | Out-Null
    }
    [IO.File]::WriteAllText($ConfigPath, $config, (New-Object Text.UTF8Encoding($false)))
    if (-not $SkipValidation) {
        Test-NginxConfig
    }
    Write-Host "Nginx configuration is ready: $ConfigPath"
    Write-Host "Set TEAM_LOOP_TRUST_PROXY=1 before starting Team Loop, and keep the backend bound to 127.0.0.1:$UpstreamPort."
}

function Get-TeamLoopNginxProcesses {
    $normalizedRoot = [IO.Path]::GetFullPath($NginxRoot).TrimEnd("\")
    $rootPrefix = $normalizedRoot + "\"
    return @(Get-Process nginx -ErrorAction SilentlyContinue | Where-Object {
        try { $_.Path -and ([IO.Path]::GetFullPath($_.Path)).StartsWith($rootPrefix, [StringComparison]::OrdinalIgnoreCase) } catch { $false }
    })
}

switch ($Action) {
    "Render" { Write-NginxConfig -SkipValidation }
    "Configure" { Write-NginxConfig }
    "Start" {
        Test-NginxConfig
        if ((Get-TeamLoopNginxProcesses).Count -gt 0) {
            throw "Nginx is already running from $NginxRoot. Use -Action Reload."
        }
        Start-Process -WindowStyle Hidden -FilePath $NginxExe -WorkingDirectory $NginxRoot -ArgumentList @("-p", (Get-NginxPrefix), "-c", "conf/team-loop.conf")
        Start-Sleep -Milliseconds 700
        if ((Get-TeamLoopNginxProcesses).Count -eq 0) {
            throw "Nginx did not remain running. Review $NginxRoot\logs\team-loop-error.log."
        }
        Write-Host "Nginx started with $ConfigPath."
    }
    "Reload" {
        Test-NginxConfig
        & $NginxExe -p (Get-NginxPrefix) -c "conf/team-loop.conf" -s reload
        if ($LASTEXITCODE -ne 0) { throw "Nginx reload failed." }
        Write-Host "Nginx configuration reloaded."
    }
    "Stop" {
        Assert-NginxInstallation
        if ((Get-TeamLoopNginxProcesses).Count -eq 0) {
            Write-Host "Nginx is not running from $NginxRoot."
            break
        }
        & $NginxExe -p (Get-NginxPrefix) -c "conf/team-loop.conf" -s quit
        if ($LASTEXITCODE -ne 0) { throw "Nginx stop failed." }
        Write-Host "Nginx stop signal sent."
    }
    "Status" {
        $processes = Get-TeamLoopNginxProcesses
        Write-Host ("nginx: root={0}, config={1}, running={2}, processes={3}" -f $NginxRoot, (Test-Path -LiteralPath $ConfigPath), ($processes.Count -gt 0), $processes.Count)
    }
}
