# ============================================================
# Setup local de PostgreSQL para CRM-ISEIE.
# Solo dev local. NO ejecutar contra produccion.
#
# Lo que hace:
#   1. Te pide el password del superuser `postgres` (sin echo, nunca sale del proceso).
#   2. Crea el usuario `crm_iseie_user` con password 'crm_iseie_dev_pass'.
#   3. Crea la DB `crm_iseie` con ese usuario como owner.
#   4. Instala la extension pgcrypto.
#   5. Aplica backend/migrations/001_initial_schema.sql.
#   6. Aplica backend/seeds/001_first_project.sql.
#
# Ejecutar desde la raiz del repo:
#   .\scripts\setup-db.ps1
# ============================================================

$ErrorActionPreference = 'Stop'

$PSQL = 'C:\Program Files\PostgreSQL\18\bin\psql.exe'
if (-not (Test-Path $PSQL)) {
    Write-Error "No encuentro psql en $PSQL. Edita la variable `$PSQL al principio del script."
    exit 1
}

# Resolver paths relativos al script para poder ejecutarlo desde cualquier cwd
$repoRoot = Split-Path -Parent $PSScriptRoot
$migrationFile = Join-Path $repoRoot 'backend\migrations\001_initial_schema.sql'
$seedFile = Join-Path $repoRoot 'backend\seeds\001_first_project.sql'

if (-not (Test-Path $migrationFile)) { Write-Error "No encuentro $migrationFile"; exit 1 }
if (-not (Test-Path $seedFile))      { Write-Error "No encuentro $seedFile";      exit 1 }

Write-Host "==> Conectando a PostgreSQL 18 local como 'postgres' superuser." -ForegroundColor Cyan
$securePw = Read-Host "Password del usuario 'postgres'" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$pgPw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

# Usar PGPASSWORD scoped al bloque try/finally para que se limpie pase lo que pase.
$env:PGPASSWORD = $pgPw

try {
    Write-Host "==> Comprobando conexion..." -ForegroundColor Cyan
    & $PSQL -U postgres -h localhost -d postgres -c "SELECT version();" | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "No pude conectar como 'postgres'. Password incorrecto?" }
    Write-Host "    OK" -ForegroundColor Green

    Write-Host "==> Creando usuario crm_iseie_user (idempotente)..." -ForegroundColor Cyan
    $createUser = @"
DO `$`$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'crm_iseie_user') THEN
    CREATE USER crm_iseie_user WITH PASSWORD 'crm_iseie_dev_pass';
  END IF;
END
`$`$;
"@
    $createUser | & $PSQL -U postgres -h localhost -d postgres
    if ($LASTEXITCODE -ne 0) { throw "Fallo creando el usuario." }

    Write-Host "==> Creando DB crm_iseie si no existe..." -ForegroundColor Cyan
    $dbExists = & $PSQL -U postgres -h localhost -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='crm_iseie'"
    if ($dbExists.Trim() -ne '1') {
        & $PSQL -U postgres -h localhost -d postgres -c "CREATE DATABASE crm_iseie OWNER crm_iseie_user;"
        if ($LASTEXITCODE -ne 0) { throw "Fallo creando la DB." }
        Write-Host "    DB creada." -ForegroundColor Green
    } else {
        Write-Host "    DB ya existia." -ForegroundColor Yellow
    }

    Write-Host "==> Instalando extension pgcrypto..." -ForegroundColor Cyan
    & $PSQL -U postgres -h localhost -d crm_iseie -c "CREATE EXTENSION IF NOT EXISTS pgcrypto;"
    if ($LASTEXITCODE -ne 0) { throw "Fallo instalando pgcrypto." }

    Write-Host "==> Aplicando migracion 001_initial_schema.sql..." -ForegroundColor Cyan
    & $PSQL -U postgres -h localhost -d crm_iseie -v ON_ERROR_STOP=1 -f $migrationFile
    if ($LASTEXITCODE -ne 0) { throw "Fallo aplicando la migracion." }

    Write-Host "==> Aplicando seed 001_first_project.sql..." -ForegroundColor Cyan
    & $PSQL -U postgres -h localhost -d crm_iseie -v ON_ERROR_STOP=1 -f $seedFile
    if ($LASTEXITCODE -ne 0) { throw "Fallo aplicando el seed." }

    Write-Host ""
    Write-Host "DB lista. Resumen:" -ForegroundColor Green
    & $PSQL -U postgres -h localhost -d crm_iseie -c "SELECT 'tablas' AS tipo, count(*)::text AS n FROM information_schema.tables WHERE table_schema='public' UNION ALL SELECT 'proyectos', count(*)::text FROM projects UNION ALL SELECT 'usuarios', count(*)::text FROM users;"

    Write-Host ""
    Write-Host "Siguiente paso: crear el superadmin con `node scripts/create-superadmin.js`" -ForegroundColor Cyan
    Write-Host "Tu password de 'postgres' NO se guardo en ningun lado." -ForegroundColor DarkGray
}
finally {
    Remove-Item Env:PGPASSWORD -ErrorAction SilentlyContinue
    $pgPw = $null
}
