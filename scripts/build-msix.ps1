<#
  MSIX balíček Finder-Win pro Microsoft Store.

  build (FINDERWIN_STORE=1, --features store, tauri.store.conf.json) → staging → AppxManifest.xml
  → assety z app-icon.png → makepri → makeappx pack.

  Výstup (NEpodepsaný, Store ho podepíše sám):
    src-tauri/target/release/bundle/msix/Finder-Win_<verze>.0_x64.msix

  -TestSign  navíc vyrobí …_x64_TEST-SIGNED.msix podepsaný self-signed certifikátem
             v CurrentUser\My (jen pro lokální instalaci, NIKDY neodesílat do Storu).
  -SkipBuild přeskočí tauri build (použije existující exe v src-tauri/target/store).

  Potřebuje Windows SDK (makeappx, makepri, signtool) – hledá nejnovější v Windows Kits\10\bin.
#>
param(
    [switch]$TestSign,
    [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

# Identita z Partner Center (Product identity).
$IdentityName = "krystof02.Finder-Win"
$Publisher = "CN=7A230D16-A4F0-44D2-9725-8DF77823543E"
$PublisherDisplayName = "krystof02"

$Root = Split-Path -Parent $PSScriptRoot
$Version = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$MsixVersion = "$Version.0"
# Store build má vlastní target dir, ať se jeho exe nesmíchá s NSIS buildem v target/release.
$StoreTarget = Join-Path $Root "src-tauri/target/store"
$Staging = Join-Path $StoreTarget "msix-staging"
$OutDir = Join-Path $Root "src-tauri/target/release/bundle/msix"
$Msix = Join-Path $OutDir "Finder-Win_${MsixVersion}_x64.msix"

function Find-SdkTool([string]$Name) {
    $bin = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    # Bez SDK složka bin vůbec není – Get-ChildItem by spadl dřív než srozumitelný throw.
    $tool = if (Test-Path $bin) { Get-ChildItem $bin -Directory -Filter "10.*" |
        Sort-Object { [version]$_.Name } -Descending |
        ForEach-Object { Join-Path $_.FullName "x64\$Name" } |
        Where-Object { Test-Path $_ } |
        Select-Object -First 1 }
    if (-not $tool) { throw "$Name nenalezen – nainstaluj Windows SDK (winget install Microsoft.WindowsSDK.10.0.26100)." }
    return $tool
}

function Invoke-Tool([string]$Exe, [string[]]$Arguments) {
    & $Exe @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$(Split-Path -Leaf $Exe) skončil s kódem $LASTEXITCODE" }
}

$MakeAppx = Find-SdkTool "makeappx.exe"
$MakePri = Find-SdkTool "makepri.exe"

# 1) Build bez instalátoru, se Store flagem (frontend __STORE__ + Rust feature store + CSP bez GitHubu).
if (-not $SkipBuild) {
    Push-Location $Root
    try {
        $env:FINDERWIN_STORE = "1"
        $env:CARGO_TARGET_DIR = $StoreTarget
        npx tauri build --no-bundle --features store --config src-tauri/tauri.store.conf.json
        if ($LASTEXITCODE -ne 0) { throw "tauri build selhal" }
    } finally {
        Remove-Item Env:FINDERWIN_STORE, Env:CARGO_TARGET_DIR -ErrorAction SilentlyContinue
        Pop-Location
    }
}
$Exe = Join-Path $StoreTarget "release/finder-win.exe"
if (-not (Test-Path $Exe)) { throw "Chybí $Exe – spusť bez -SkipBuild." }

# 2) Staging: stejné finder-win.exe jako v NSIS (žádné další resources Tauri nebalí).
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }
$Assets = Join-Path $Staging "Assets"
New-Item -ItemType Directory -Force $Assets | Out-Null
Copy-Item $Exe $Staging

# 3) Assety z app-icon.png (1024 px, průhledné pozadí). Ikona je na plátně vycentrovaná,
#    $Fill = podíl kratší strany plátna, který zabírá.
Add-Type -AssemblyName System.Drawing
$Icon = [System.Drawing.Bitmap]::new((Join-Path $Root "app-icon.png"))
function New-Asset([string]$Name, [int]$Width, [int]$Height, [double]$Fill) {
    $bmp = [System.Drawing.Bitmap]::new($Width, $Height, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $g = $null
    $attrs = $null
    try {
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.Clear([System.Drawing.Color]::Transparent)
        $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
        $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
        $g.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
        $size = [int][math]::Round([math]::Min($Width, $Height) * $Fill)
        $attrs = [System.Drawing.Imaging.ImageAttributes]::new()
        $attrs.SetWrapMode([System.Drawing.Drawing2D.WrapMode]::TileFlipXY) # bez tmavého lemu na okrajích
        $rect = [System.Drawing.Rectangle]::new([int](($Width - $size) / 2), [int](($Height - $size) / 2), $size, $size)
        $g.DrawImage($Icon, $rect, 0, 0, $Icon.Width, $Icon.Height, [System.Drawing.GraphicsUnit]::Pixel, $attrs)
        $bmp.Save((Join-Path $Assets $Name), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
        if ($attrs) { $attrs.Dispose() }
        if ($g) { $g.Dispose() }
        $bmp.Dispose()
    }
}
try {
    foreach ($scale in 100, 200) {
        $k = $scale / 100
        New-Asset "Square44x44Logo.scale-$scale.png" (44 * $k) (44 * $k) 1.0
        New-Asset "Square150x150Logo.scale-$scale.png" (150 * $k) (150 * $k) 0.66
        New-Asset "Wide310x150Logo.scale-$scale.png" (310 * $k) (150 * $k) 0.66
        New-Asset "StoreLogo.scale-$scale.png" (50 * $k) (50 * $k) 1.0
        New-Asset "SplashScreen.scale-$scale.png" (620 * $k) (300 * $k) 0.5
    }
    # Hlavní panel, Start a Průzkumník (unplated = bez podkladové barvy dlaždice).
    foreach ($t in 16, 24, 32, 48, 256) {
        New-Asset "Square44x44Logo.targetsize-$t.png" $t $t 1.0
        New-Asset "Square44x44Logo.targetsize-${t}_altform-unplated.png" $t $t 1.0
    }
} finally {
    $Icon.Dispose()
}

# 4) Manifest.
$Manifest = @"
<?xml version="1.0" encoding="utf-8"?>
<Package
  xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10"
  xmlns:uap="http://schemas.microsoft.com/appx/manifest/uap/windows10"
  xmlns:rescap="http://schemas.microsoft.com/appx/manifest/foundation/windows10/restrictedcapabilities"
  IgnorableNamespaces="uap rescap">
  <Identity Name="$IdentityName" Publisher="$Publisher" Version="$MsixVersion" ProcessorArchitecture="x64" />
  <Properties>
    <DisplayName>Finder-Win</DisplayName>
    <PublisherDisplayName>$PublisherDisplayName</PublisherDisplayName>
    <Logo>Assets\StoreLogo.png</Logo>
  </Properties>
  <Dependencies>
    <TargetDeviceFamily Name="Windows.Desktop" MinVersion="10.0.17763.0" MaxVersionTested="10.0.26100.0" />
  </Dependencies>
  <Resources>
    <Resource Language="en-US" />
    <Resource Language="cs-CZ" />
  </Resources>
  <Applications>
    <Application Id="FinderWin" Executable="finder-win.exe" EntryPoint="Windows.FullTrustApplication">
      <uap:VisualElements
        DisplayName="Finder-Win"
        Description="A macOS Finder-like file explorer for Windows"
        BackgroundColor="transparent"
        Square150x150Logo="Assets\Square150x150Logo.png"
        Square44x44Logo="Assets\Square44x44Logo.png">
        <uap:DefaultTile Wide310x150Logo="Assets\Wide310x150Logo.png" />
        <uap:SplashScreen Image="Assets\SplashScreen.png" />
      </uap:VisualElements>
    </Application>
  </Applications>
  <Capabilities>
    <rescap:Capability Name="runFullTrust" />
  </Capabilities>
</Package>
"@
Set-Content -Path (Join-Path $Staging "AppxManifest.xml") -Value $Manifest -Encoding utf8

# 5) resources.pri – bez něj se kvalifikované assety (scale/targetsize) nenajdou.
$PriConfig = Join-Path $StoreTarget "priconfig.xml"
Invoke-Tool $MakePri @("createconfig", "/cf", $PriConfig, "/dq", "en-US_cs-CZ", "/pv", "10.0.0", "/o")
# Jeden balíček, ne bundle – resource packy (resources.scale-200.pri …) nechceme, vše do resources.pri.
$cfg = [xml](Get-Content $PriConfig -Raw)
$pkg = $cfg.SelectSingleNode("//packaging")
if ($pkg) { [void]$pkg.ParentNode.RemoveChild($pkg) }
$cfg.Save($PriConfig)
Invoke-Tool $MakePri @("new", "/pr", $Staging, "/cf", $PriConfig, "/mn", (Join-Path $Staging "AppxManifest.xml"), "/of", (Join-Path $Staging "resources.pri"), "/o")

# 6) Balíček.
New-Item -ItemType Directory -Force $OutDir | Out-Null
Invoke-Tool $MakeAppx @("pack", "/d", $Staging, "/p", $Msix, "/o")
Write-Host "MSIX pro Store (nepodepsaný): $Msix"

# 7) Volitelně testovací podpis – samostatná kopie, originál zůstává nepodepsaný.
if ($TestSign) {
    $SignTool = Find-SdkTool "signtool.exe"
    $cert = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object { $_.Subject -eq $Publisher -and $_.FriendlyName -eq "Finder-Win MSIX test" -and $_.NotAfter -gt (Get-Date) } |
        Select-Object -First 1
    if (-not $cert) {
        $cert = New-SelfSignedCertificate -Type Custom -Subject $Publisher -KeyUsage DigitalSignature `
            -FriendlyName "Finder-Win MSIX test" -CertStoreLocation Cert:\CurrentUser\My `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}") -NotAfter (Get-Date).AddMonths(3)
    }
    $Cer = Join-Path $OutDir "Finder-Win-TEST.cer"
    Export-Certificate -Cert $cert -FilePath $Cer | Out-Null
    $TestMsix = Join-Path $OutDir "Finder-Win_${MsixVersion}_x64_TEST-SIGNED.msix"
    Copy-Item $Msix $TestMsix -Force
    Invoke-Tool $SignTool @("sign", "/fd", "SHA256", "/sha1", $cert.Thumbprint, "/s", "My", $TestMsix)
    Write-Host "Testovací balíček (NEODESÍLAT do Storu): $TestMsix"
    Write-Host "Certifikát k důvěře (LocalMachine\TrustedPeople, jako admin): $Cer"
}
