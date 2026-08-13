$ErrorActionPreference = 'Stop'

$signaturePattern = '[鍚鐗鎴鏉娣绯绾瀛璇缁锛锟閿鏂鑳銆鈥]'
$segmentRegex = [regex]'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]{2,}'

$commonChars = @('的','了','在','是','不','有','和','人','这','中','大','为','上','个','国','我','以','要','他','时','来','用','们','生','到','作','地','于','出','就','分','对','成','会','可','主','发','年','动','同','工','也','能','下','过','子','说','产','种','面','而','方','后','多','定','行','学','法','所','民','得','经','十','三','之','进','着','等','牛','只','查','询','管','理','数','据','统','计','异','常','健','康','预','警','监','控','泌','乳','繁','殖','饲','喂','事','件','记','录','筛','选','详','情','页','面')
$badChars = @('鍚','鐗','鎴','鏉','娣','绯','绾','瀛','璇','缁','锛','锟','閿','鏂','鑳','銆','鈥')

$commonSet = New-Object 'System.Collections.Generic.HashSet[string]'
$badSet = New-Object 'System.Collections.Generic.HashSet[string]'
$commonChars | ForEach-Object { [void]$commonSet.Add($_) }
$badChars | ForEach-Object { [void]$badSet.Add($_) }

function Get-Score([string]$s) {
  $common = 0
  $bad = 0
  $punc = 0
  $cjk = 0
  foreach ($ch in $s.ToCharArray()) {
    $code = [int][char]$ch
    if (($code -ge 0x4E00 -and $code -le 0x9FFF) -or ($code -ge 0x3400 -and $code -le 0x4DBF)) {
      $cjk++
      if ($commonSet.Contains([string]$ch)) { $common++ }
      if ($badSet.Contains([string]$ch)) { $bad++ }
    }
    if ('，。！？：；、“”‘’（）《》【】、'.Contains($ch)) { $punc++ }
  }
  $base = if ($cjk -gt 0) { 1 } else { 0 }
  return ($common * 2 + $punc - $bad * 2 + $base)
}

function Try-FixSegment([string]$seg) {
  if ($seg -notmatch $signaturePattern) { return $seg }

  try {
    $bytes = [System.Text.Encoding]::GetEncoding('GB18030').GetBytes($seg)
    $candidate = [System.Text.Encoding]::UTF8.GetString($bytes)
  }
  catch {
    return $seg
  }

  if ($candidate -notmatch '[\u4e00-\u9fff]') { return $seg }

  $origScore = Get-Score $seg
  $candScore = Get-Score $candidate

  if ($candScore -gt ($origScore + 1)) { return $candidate }
  return $seg
}

$files = & rg -l '[鍚锛鎴鐗娴鏉璁閿鏂缁鑳銆锟]' src
if (-not $files) {
  Write-Output 'No affected files found.'
  exit 0
}

$changed = @()
foreach ($file in $files) {
  $raw = [System.IO.File]::ReadAllBytes($file)
  $hasBom = $raw.Length -ge 3 -and $raw[0] -eq 0xEF -and $raw[1] -eq 0xBB -and $raw[2] -eq 0xBF
  $text = [System.IO.File]::ReadAllText($file, [System.Text.Encoding]::UTF8)

  $newText = $segmentRegex.Replace($text, {
    param($m)
    return (Try-FixSegment $m.Value)
  })

  if ($newText -ne $text) {
    $utf8 = New-Object System.Text.UTF8Encoding($hasBom)
    [System.IO.File]::WriteAllText($file, $newText, $utf8)
    $changed += $file
  }
}

Write-Output ("Changed files: {0}" -f $changed.Count)
$changed | ForEach-Object { Write-Output $_ }
