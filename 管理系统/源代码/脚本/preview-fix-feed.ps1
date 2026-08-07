$file='src/views/feed-management/index.vue'
$text=[IO.File]::ReadAllText($file,[Text.Encoding]::UTF8)
$sig='[鍚鐗鎴鏉娣绯绾瀛璇缁锛锟閿鏂鑳銆鈥鏁鏃鏍楗閰鎶鍦鏌閲鍒璁瀹搴棰娲鍋瑕嗙洊闇]'
$seg=[regex]'[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef\uE000-\uF8FF\?�]{2,}'
$gb=[Text.Encoding]::GetEncoding('GB18030')
function CountR([string]$s,[string]$p){ ([regex]::Matches($s,$p)).Count }
$new=$seg.Replace($text,{
  param($m)
  $s=$m.Value
  if($s -notmatch $sig){ return $s }
  try{ $b=$gb.GetBytes($s); $t=[Text.Encoding]::UTF8.GetString($b) }catch{ return $s }
  $sb=CountR $s $sig; $tb=CountR $t $sig
  $sr=CountR $s '�'; $tr=CountR $t '�'
  if(($tb -lt $sb) -or ($tb -eq $sb -and $tr -lt $sr)){ return $t }
  return $s
})
$oldCnt=(rg -n "[鍚锛鎴鐗娴鏉璁閿鏂缁鑳銆锟]|�" $file | Measure-Object | % {$_.Count})
$tmp='src/views/feed-management/.tmp.preview.txt'
[IO.File]::WriteAllText($tmp,$new,[Text.UTF8Encoding]::new($true))
$newCnt=(rg -n "[鍚锛鎴鐗娴鏉璁閿鏂缁鑳銆锟]|�" $tmp | Measure-Object | % {$_.Count})
Write-Output "old=$oldCnt new=$newCnt"
Remove-Item $tmp -Force
