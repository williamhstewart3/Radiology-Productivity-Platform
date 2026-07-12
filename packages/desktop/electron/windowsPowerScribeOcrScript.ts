export const windowsPowerScribeOcrScript = String.raw`
param(
  [Nullable[double]] $SavedCropX = $null,
  [Nullable[double]] $SavedCropY = $null,
  [Nullable[double]] $SavedCropWidth = $null,
  [Nullable[double]] $SavedCropHeight = $null
)

$ErrorActionPreference = 'Stop'

Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Runtime.WindowsRuntime

$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Storage.FileAccessMode, Windows.Storage, ContentType = WindowsRuntime]

function Await-WinRt {
  param(
    [Parameter(Mandatory = $true)] $AsyncOperation,
    [Parameter(Mandatory = $true)] [Type] $ResultType
  )

  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and
      $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1
    } |
    Select-Object -First 1
  $task = $method.MakeGenericMethod($ResultType).Invoke($null, @($AsyncOperation))
  $task.Wait()
  return $task.Result
}

function Clamp01([double] $Value) {
  if ([double]::IsNaN($Value) -or [double]::IsInfinity($Value)) { return 0.0 }
  return [Math]::Max(0.0, [Math]::Min(1.0, $Value))
}

function Normalize-Rect($Rect) {
  $x = Clamp01 $Rect.x
  $y = Clamp01 $Rect.y
  $width = [Math]::Max(0.05, [Math]::Min(1.0 - $x, (Clamp01 $Rect.width)))
  $height = [Math]::Max(0.05, [Math]::Min(1.0 - $y, (Clamp01 $Rect.height)))
  return [pscustomobject]@{ x = $x; y = $y; width = $width; height = $height }
}

function Bound-ToStudyListArea($Rect) {
  $bounded = Normalize-Rect $Rect
  $maxRight = 0.98
  $right = [Math]::Min($maxRight, $bounded.x + $bounded.width)
  return Normalize-Rect ([pscustomobject]@{ x = $bounded.x; y = $bounded.y; width = $right - $bounded.x; height = $bounded.height })
}

function Get-OtsuThreshold([int[]] $Histogram, [int] $Total) {
  $sumAll = 0.0
  for ($i = 0; $i -lt 256; $i++) { $sumAll += $i * $Histogram[$i] }
  $sumB = 0.0
  $weightB = 0
  $maxVariance = 0.0
  $threshold = 128
  for ($t = 0; $t -lt 256; $t++) {
    $weightB += $Histogram[$t]
    if ($weightB -eq 0) { continue }
    $weightF = $Total - $weightB
    if ($weightF -eq 0) { break }
    $sumB += $t * $Histogram[$t]
    $meanB = $sumB / $weightB
    $meanF = ($sumAll - $sumB) / $weightF
    $variance = $weightB * $weightF * ($meanB - $meanF) * ($meanB - $meanF)
    if ($variance -gt $maxVariance) {
      $maxVariance = $variance
      $threshold = $t
    }
  }
  return $threshold
}

function Smooth-Values([double[]] $Values, [int] $Radius) {
  $result = New-Object double[] $Values.Length
  for ($i = 0; $i -lt $Values.Length; $i++) {
    $start = [Math]::Max(0, $i - $Radius)
    $end = [Math]::Min($Values.Length - 1, $i + $Radius)
    $sum = 0.0
    for ($j = $start; $j -le $end; $j++) { $sum += $Values[$j] }
    $result[$i] = $sum / [Math]::Max(1, $end - $start + 1)
  }
  return $result
}

function Percentile([double[]] $Values, [double] $P) {
  if ($Values.Length -eq 0) { return 0.0 }
  $sorted = [double[]]($Values | Sort-Object)
  $index = [Math]::Max(0, [Math]::Min($sorted.Length - 1, [Math]::Floor(($sorted.Length - 1) * $P)))
  return $sorted[$index]
}

function Lock-BitmapBytes([System.Drawing.Bitmap] $Bitmap) {
  $rect = New-Object System.Drawing.Rectangle 0, 0, $Bitmap.Width, $Bitmap.Height
  $bitmapData = $Bitmap.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  try {
    $stride = $bitmapData.Stride
    $bytes = New-Object byte[] ($stride * $Bitmap.Height)
    [System.Runtime.InteropServices.Marshal]::Copy($bitmapData.Scan0, $bytes, 0, $bytes.Length)
  } finally {
    $Bitmap.UnlockBits($bitmapData)
  }
  return [pscustomobject]@{ bytes = $bytes; stride = $stride; width = $Bitmap.Width; height = $Bitmap.Height }
}

function Longest-ActiveBand([double[]] $Values, [int] $MinIndex, [int] $MaxIndex, [double] $Threshold) {
  $best = $null
  $start = $null
  $activeCount = 0
  for ($i = $MinIndex; $i -le $MaxIndex; $i++) {
    $active = $Values[$i] -ge $Threshold
    if ($active -and $null -eq $start) {
      $start = $i
      $activeCount = 0
    }
    if ($active -and $null -ne $start) { $activeCount++ }
    if ((-not $active -or $i -eq $MaxIndex) -and $null -ne $start) {
      $end = if ($active) { $i } else { $i - 1 }
      $width = $end - $start + 1
      $coverage = $activeCount / [Math]::Max(1, $width)
      if ($width -ge 10) {
        $score = $width * $coverage
        $bestScore = if ($null -eq $best) { -1 } else { ($best.end - $best.start + 1) * $best.coverage }
        if ($score -gt $bestScore) {
          $best = [pscustomobject]@{ start = $start; end = $end; coverage = $coverage }
        }
      }
      $start = $null
      $activeCount = 0
    }
  }
  return $best
}

function Detect-TableCrop([System.Drawing.Bitmap] $Bitmap) {
  $default = [pscustomobject]@{ x = 0.2; y = 0.22; width = 0.76; height = 0.58 }
  $maxWidth = 900
  $scale = [Math]::Min(1.0, $maxWidth / [double]$Bitmap.Width)
  $width = [Math]::Max(1, [int][Math]::Round($Bitmap.Width * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($Bitmap.Height * $scale))
  $small = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($small)
  $graphics.DrawImage($Bitmap, 0, 0, $width, $height)
  $graphics.Dispose()

  try {
    $locked = Lock-BitmapBytes $small
    $bytes = $locked.bytes
    $stride = $locked.stride

    $luminance = New-Object double[] ($width * $height)
    $histogram = New-Object int[] 256
    for ($y = 0; $y -lt $height; $y++) {
      for ($x = 0; $x -lt $width; $x++) {
        $offset = $y * $stride + $x * 4
        $lum = ($bytes[$offset + 2] + $bytes[$offset + 1] + $bytes[$offset]) / 3.0
        $luminance[$y * $width + $x] = $lum
        $bucket = [Math]::Max(0, [Math]::Min(255, [int][Math]::Round($lum)))
        $histogram[$bucket] += 1
      }
    }
    $darkThreshold = Get-OtsuThreshold $histogram ($width * $height)

    $gradients = New-Object System.Collections.Generic.List[double]
    for ($y = 1; $y -lt $height; $y++) {
      for ($x = 1; $x -lt $width; $x++) {
        $lum = $luminance[$y * $width + $x]
        $leftLum = $luminance[$y * $width + $x - 1]
        $upLum = $luminance[($y - 1) * $width + $x]
        $gradients.Add([Math]::Max([Math]::Abs($lum - $leftLum), [Math]::Abs($lum - $upLum)))
      }
    }
    $contrastThreshold = Percentile ([double[]]$gradients.ToArray()) 0.80

    $rowSignal = New-Object double[] $height
    $colSignal = New-Object double[] $width
    $xMin = 1
    $xMax = $width - 1
    $yMin = 1
    $yMax = $height - 1

    for ($y = $yMin; $y -lt $yMax; $y++) {
      for ($x = $xMin; $x -lt $xMax; $x++) {
        $lum = $luminance[$y * $width + $x]
        $leftLum = $luminance[$y * $width + $x - 1]
        $upLum = $luminance[($y - 1) * $width + $x]
        $contrast = [Math]::Max([Math]::Abs($lum - $leftLum), [Math]::Abs($lum - $upLum))
        if ($contrast -gt $contrastThreshold -or $lum -lt $darkThreshold) {
          $rowSignal[$y] += 1
          $colSignal[$x] += 1
        }
      }
    }

    for ($i = 0; $i -lt $rowSignal.Length; $i++) { $rowSignal[$i] = $rowSignal[$i] / [Math]::Max(1, $xMax - $xMin) }
    for ($i = 0; $i -lt $colSignal.Length; $i++) { $colSignal[$i] = $colSignal[$i] / [Math]::Max(1, $yMax - $yMin) }

    $smoothedRows = Smooth-Values $rowSignal 5
    $smoothedCols = Smooth-Values $colSignal 6
    $rowWindow = [double[]]($smoothedRows[$yMin..($yMax - 1)])
    $colWindow = [double[]]($smoothedCols[$xMin..($xMax - 1)])
    $rowThreshold = [Math]::Max(0.015, (Percentile $rowWindow 0.78))
    $colThreshold = [Math]::Max(0.010, (Percentile $colWindow 0.70))
    $rowBand = Longest-ActiveBand $smoothedRows $yMin $yMax $rowThreshold
    $colBand = Longest-ActiveBand $smoothedCols $xMin $xMax $colThreshold

    if ($null -eq $rowBand -or $null -eq $colBand) {
      return [pscustomobject]@{ rect = $default; confidence = 0.2; method = 'fallback' }
    }

    $detected = Bound-ToStudyListArea ([pscustomobject]@{
      x = ($colBand.start / [double]$width) - 0.02
      y = ($rowBand.start / [double]$height) - 0.015
      width = ([Math]::Min($width - 1, $colBand.end + [Math]::Round($width * 0.035)) / [double]$width) - (($colBand.start / [double]$width) - 0.02)
      height = ([Math]::Min($height - 1, $rowBand.end + [Math]::Round($height * 0.025)) / [double]$height) - (($rowBand.start / [double]$height) - 0.015)
    })

    $rowCoverage = ($rowBand.end - $rowBand.start + 1) / [Math]::Max(1, $yMax - $yMin)
    $colCoverage = ($colBand.end - $colBand.start + 1) / [Math]::Max(1, $xMax - $xMin)
    $confidence = [Math]::Max(0.0, [Math]::Min(1.0, ($rowCoverage * 0.65 + $colCoverage * 0.35) * $rowBand.coverage * 1.8))
    if ($confidence -lt 0.35 -or $detected.width -lt 0.45 -or $detected.height -lt 0.22) {
      return [pscustomobject]@{ rect = $default; confidence = $confidence; method = 'fallback' }
    }

    return [pscustomobject]@{ rect = $detected; confidence = $confidence; method = 'detected' }
  } finally {
    $small.Dispose()
  }
}

function Get-FallbackColumnLayout {
  return [pscustomobject]@{
    threeColumnRect = [pscustomobject]@{ x = 0.13; y = 0.0; width = 0.865; height = 1.0 }
    columns = [pscustomobject]@{
      procedure = [pscustomobject]@{ x = 0.13; y = 0.0; width = 0.43; height = 1.0 }
      examDate = [pscustomobject]@{ x = 0.575; y = 0.0; width = 0.195; height = 1.0 }
      modifiedDate = [pscustomobject]@{ x = 0.765; y = 0.0; width = 0.23; height = 1.0 }
    }
    confidence = 0.45
    method = 'fallback'
  }
}

function Get-TextMassMidpointIndex([double[]] $Values) {
  $total = 0.0
  foreach ($v in $Values) { $total += $v }
  if ($total -le 0) { return [int][Math]::Floor($Values.Length / 2) }
  $half = $total / 2.0
  $cumulative = 0.0
  for ($i = 0; $i -lt $Values.Length; $i++) {
    $cumulative += $Values[$i]
    if ($cumulative -ge $half) { return $i }
  }
  return $Values.Length - 1
}

function Find-LowInkValleys([double[]] $Values, [int] $MinIndex, [int] $MaxIndex, [double] $Threshold) {
  $minWidth = [Math]::Max(6, [int][Math]::Round($Values.Length * 0.012))
  $valleys = @()
  $start = $null
  $sum = 0.0

  for ($i = $MinIndex; $i -le $MaxIndex; $i++) {
    $low = $Values[$i] -le $Threshold
    if ($low -and $null -eq $start) {
      $start = $i
      $sum = 0.0
    }
    if ($low) { $sum += $Values[$i] }
    if ((-not $low -or $i -eq $MaxIndex) -and $null -ne $start) {
      $end = if ($low) { $i } else { $i - 1 }
      $width = $end - $start + 1
      if ($width -ge $minWidth) {
        $average = $sum / [Math]::Max(1, $width)
        $score = $width * [Math]::Max(0.0001, $Threshold - $average)
        $valleys += [pscustomobject]@{
          center = (($start + $end) / 2.0) / [double]$Values.Length
          width = $width / [double]$Values.Length
          score = $score
        }
      }
      $start = $null
      $sum = 0.0
    }
  }

  return $valleys
}

function Detect-ColumnLayoutFromProjection([double[]] $Projection) {
  if ($Projection.Length -lt 80) { return Get-FallbackColumnLayout }

  $smoothRadius = [Math]::Max(2, [int][Math]::Round($Projection.Length * 0.006))
  $smoothed = Smooth-Values $Projection $smoothRadius
  $lowThreshold = [Math]::Max(0.0015, (Percentile $smoothed 0.24))
  $midpointIndex = Get-TextMassMidpointIndex $smoothed
  $valleys = @(Find-LowInkValleys $smoothed $midpointIndex ($smoothed.Length - 1) $lowThreshold)
  $topValleys = @($valleys | Sort-Object -Property width -Descending | Select-Object -First 2 | Sort-Object -Property center)

  if ($topValleys.Count -lt 2 -or ($topValleys[1].center - $topValleys[0].center) -lt 0.10) {
    return Get-FallbackColumnLayout
  }

  $firstGutter = $topValleys[0]
  $secondGutter = $topValleys[1]

  $padding = 0.012
  $left = 0.13
  $right = 0.99
  $procedureRight = [Math]::Max(0.34, $firstGutter.center - $padding)
  $examLeft = [Math]::Min(0.72, $firstGutter.center + $padding)
  $examRight = [Math]::Max($examLeft + 0.10, $secondGutter.center - $padding)
  $modifiedLeft = [Math]::Min(0.88, $secondGutter.center + $padding)

  if ($procedureRight -le $left + 0.18 -or $examRight -le $examLeft + 0.08 -or $right -le $modifiedLeft + 0.08) {
    return Get-FallbackColumnLayout
  }

  $confidence = [Math]::Max(0.55, [Math]::Min(0.95, 0.60 + $firstGutter.width * 6.0 + $secondGutter.width * 6.0))
  return [pscustomobject]@{
    threeColumnRect = Normalize-Rect ([pscustomobject]@{ x = $left; y = 0.0; width = $right - $left; height = 1.0 })
    columns = [pscustomobject]@{
      procedure = Normalize-Rect ([pscustomobject]@{ x = $left; y = 0.0; width = $procedureRight - $left; height = 1.0 })
      examDate = Normalize-Rect ([pscustomobject]@{ x = $examLeft; y = 0.0; width = $examRight - $examLeft; height = 1.0 })
      modifiedDate = Normalize-Rect ([pscustomobject]@{ x = $modifiedLeft; y = 0.0; width = $right - $modifiedLeft; height = 1.0 })
    }
    confidence = $confidence
    method = 'detected'
  }
}

function Detect-ColumnLayout([System.Drawing.Bitmap] $Bitmap, $TableRect) {
  $r = Normalize-Rect $TableRect
  $sourceX = [int][Math]::Round($r.x * $Bitmap.Width)
  $sourceY = [int][Math]::Round($r.y * $Bitmap.Height)
  $sourceWidth = [Math]::Max(1, [int][Math]::Round($r.width * $Bitmap.Width))
  $sourceHeight = [Math]::Max(1, [int][Math]::Round($r.height * $Bitmap.Height))
  $maxWidth = 900
  $scale = [Math]::Min(1.0, $maxWidth / [double]$sourceWidth)
  $width = [Math]::Max(1, [int][Math]::Round($sourceWidth * $scale))
  $height = [Math]::Max(1, [int][Math]::Round($sourceHeight * $scale))
  $small = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($small)
  $graphics.DrawImage(
    $Bitmap,
    (New-Object System.Drawing.Rectangle 0, 0, $width, $height),
    (New-Object System.Drawing.Rectangle $sourceX, $sourceY, $sourceWidth, $sourceHeight),
    [System.Drawing.GraphicsUnit]::Pixel
  )
  $graphics.Dispose()

  try {
    $projection = New-Object double[] $width
    $yMin = [int][Math]::Floor($height * 0.06)
    $yMax = [int][Math]::Floor($height * 0.98)
    $locked = Lock-BitmapBytes $small
    $bytes = $locked.bytes
    $stride = $locked.stride

    $luminance = New-Object double[] ($width * $height)
    $histogram = New-Object int[] 256
    for ($y = $yMin; $y -lt $yMax; $y++) {
      for ($x = 0; $x -lt $width; $x++) {
        $offset = $y * $stride + $x * 4
        $lum = $bytes[$offset + 2] * 0.299 + $bytes[$offset + 1] * 0.587 + $bytes[$offset] * 0.114
        $luminance[$y * $width + $x] = $lum
        $bucket = [Math]::Max(0, [Math]::Min(255, [int][Math]::Round($lum)))
        $histogram[$bucket] += 1
      }
    }
    $darkThreshold = Get-OtsuThreshold $histogram (($yMax - $yMin) * $width)

    $gradients = New-Object System.Collections.Generic.List[double]
    for ($y = $yMin + 1; $y -lt $yMax; $y++) {
      for ($x = 1; $x -lt $width; $x++) {
        $lum = $luminance[$y * $width + $x]
        $leftLum = $luminance[$y * $width + $x - 1]
        $gradients.Add([Math]::Abs($lum - $leftLum))
      }
    }
    $contrastThreshold = Percentile ([double[]]$gradients.ToArray()) 0.80

    for ($y = $yMin + 1; $y -lt $yMax; $y++) {
      for ($x = 1; $x -lt ($width - 1); $x++) {
        $lum = $luminance[$y * $width + $x]
        $leftLum = $luminance[$y * $width + $x - 1]
        if ($lum -lt $darkThreshold -or [Math]::Abs($lum - $leftLum) -gt $contrastThreshold) {
          $projection[$x] += 1
        }
      }
    }
    for ($i = 0; $i -lt $projection.Length; $i++) {
      $projection[$i] = $projection[$i] / [Math]::Max(1, $yMax - $yMin)
    }
    return Detect-ColumnLayoutFromProjection $projection
  } finally {
    $small.Dispose()
  }
}

function Child-Rect($Parent, $Child) {
  $p = Normalize-Rect $Parent
  $c = Normalize-Rect $Child
  return Normalize-Rect ([pscustomobject]@{
    x = $p.x + $p.width * $c.x
    y = $p.y + $p.height * $c.y
    width = $p.width * $c.width
    height = $p.height * $c.height
  })
}

function Crop-Bitmap([System.Drawing.Bitmap] $Bitmap, $Rect) {
  $r = Normalize-Rect $Rect
  $sourceX = [int][Math]::Round($r.x * $Bitmap.Width)
  $sourceY = [int][Math]::Round($r.y * $Bitmap.Height)
  $sourceWidth = [Math]::Max(1, [int][Math]::Round($r.width * $Bitmap.Width))
  $sourceHeight = [Math]::Max(1, [int][Math]::Round($r.height * $Bitmap.Height))
  $source = New-Object System.Drawing.Rectangle $sourceX, $sourceY, $sourceWidth, $sourceHeight
  $dest = New-Object System.Drawing.Bitmap $source.Width, $source.Height
  $graphics = [System.Drawing.Graphics]::FromImage($dest)
  $graphics.DrawImage($Bitmap, (New-Object System.Drawing.Rectangle 0, 0, $dest.Width, $dest.Height), $source, [System.Drawing.GraphicsUnit]::Pixel)
  $graphics.Dispose()
  return $dest
}

function Get-SoftwareBitmap([System.Drawing.Bitmap] $Bitmap) {
  $temp = [System.IO.Path]::Combine([System.IO.Path]::GetTempPath(), ('powerscribe-ocr-' + [guid]::NewGuid().ToString('N') + '.png'))
  $Bitmap.Save($temp, [System.Drawing.Imaging.ImageFormat]::Png)
  try {
    $storageFile = Await-WinRt ([Windows.Storage.StorageFile]::GetFileFromPathAsync($temp)) ([Windows.Storage.StorageFile])
    $stream = Await-WinRt ($storageFile.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
    try {
      $decoder = Await-WinRt ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
      return Await-WinRt ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
    } finally {
      if ($stream) { $stream.Dispose() }
    }
  } finally {
    Remove-Item -LiteralPath $temp -Force -ErrorAction SilentlyContinue
  }
}

function Get-LineBox($Line) {
  $left = [double]::PositiveInfinity
  $top = [double]::PositiveInfinity
  $right = 0.0
  $bottom = 0.0
  foreach ($word in $Line.Words) {
    $rect = $word.BoundingRect
    $left = [Math]::Min($left, $rect.X)
    $top = [Math]::Min($top, $rect.Y)
    $right = [Math]::Max($right, $rect.X + $rect.Width)
    $bottom = [Math]::Max($bottom, $rect.Y + $rect.Height)
  }
  if ([double]::IsPositiveInfinity($left)) {
    return [pscustomobject]@{ x0 = 0.0; y0 = 0.0; x1 = 0.0; y1 = 0.0 }
  }
  return [pscustomobject]@{ x0 = $left; y0 = $top; x1 = $right; y1 = $bottom }
}

function Get-WordBoxes($OcrResult) {
  $words = @()
  foreach ($line in $OcrResult.Lines) {
    foreach ($word in $line.Words) {
      $text = ($word.Text -replace '\s+', '').Trim()
      if (-not $text) { continue }
      $rect = $word.BoundingRect
      $x0 = $rect.X
      $y0 = $rect.Y
      $x1 = $rect.X + $rect.Width
      $y1 = $rect.Y + $rect.Height
      $words += [pscustomobject]@{
        text = $text
        x0 = $x0
        y0 = $y0
        x1 = $x1
        y1 = $y1
        centerY = ($y0 + $y1) / 2.0
        height = [Math]::Max(1.0, $y1 - $y0)
      }
    }
  }
  return $words
}

function Invoke-Ocr([System.Drawing.Bitmap] $Bitmap) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { throw 'Windows OCR is not available for the current user language.' }
  $softwareBitmap = Get-SoftwareBitmap $Bitmap
  $result = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
  $words = Get-WordBoxes $result
  $lines = @()
  foreach ($line in $result.Lines) {
    $text = ($line.Text -replace '\s+', ' ').Trim()
    if (-not $text) { continue }
    $box = Get-LineBox $line
    $lines += [pscustomobject]@{
      text = $text
      bbox = $box
      centerY = (($box.y0 + $box.y1) / 2.0)
      height = [Math]::Max(1.0, $box.y1 - $box.y0)
    }
  }
  return [pscustomobject]@{
    text = ($result.Text -replace ([string][char]13), '').Trim()
    lines = $lines
    words = $words
  }
}

$script:OcrDateCharMap = @{
  'O' = '0'; 'o' = '0'; 'Q' = '0'; 'D' = '0'
  'I' = '1'; 'l' = '1'
  'S' = '5'; 's' = '5'
  'B' = '8'; 'F' = '7'
}

function Normalize-DateColumnText([string] $Text) {
  if (-not $Text) { return $Text }
  $withSeparators = [regex]::Replace($Text, '(?<=\d)[.,](?=\d)', '/')
  $chars = $withSeparators.ToCharArray()
  for ($i = 0; $i -lt $chars.Length; $i++) {
    $key = [string]$chars[$i]
    if ($script:OcrDateCharMap.ContainsKey($key)) {
      $chars[$i] = $script:OcrDateCharMap[$key]
    }
  }
  return -join $chars
}

function Parse-DateTimeText([string] $Text) {
  if (-not $Text) { return $null }
  $normalized = Normalize-DateColumnText $Text
  $patterns = @(
    '\b(?<m>\d{1,2})/(?<d>\d{1,2})/(?<y>\d{2,4})\s+(?<h>\d{1,2}):(?<min>\d{2})(?::\d{2})?\s*(?<ampm>AM|PM|am|pm)?\b',
    '\b(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})[T\s](?<h>\d{1,2}):(?<min>\d{2})(?::\d{2})?\b',
    '\b(?<m>\d{1,2})/(?<d>\d{1,2})/(?<y>\d{2,4})\s*(?<h>\d{1,2})(?<min>\d{2})\s*(?<ampm>AM|PM|am|pm)\b'
  )
  foreach ($pattern in $patterns) {
    $match = [regex]::Match($normalized, $pattern)
    if (-not $match.Success) { continue }
    $month = [int]$match.Groups['m'].Value
    $day = [int]$match.Groups['d'].Value
    $year = [int]$match.Groups['y'].Value
    if ($year -lt 100) { $year = if ($year -ge 50) { 1900 + $year } else { 2000 + $year } }
    $hour = [int]$match.Groups['h'].Value
    $minute = [int]$match.Groups['min'].Value
    $ampm = $match.Groups['ampm'].Value
    if ($ampm) {
      if ($ampm.ToUpperInvariant() -eq 'PM' -and $hour -lt 12) { $hour += 12 }
      if ($ampm.ToUpperInvariant() -eq 'AM' -and $hour -eq 12) { $hour = 0 }
    }
    try {
      $dt = Get-Date -Year $year -Month $month -Day $day -Hour $hour -Minute $minute -Second 0
      return $dt.ToString('yyyy-MM-ddTHH:mm')
    } catch {
      return $null
    }
  }
  return $null
}

function Clean-Procedure([string] $Text) {
  $cleaned = ($Text -replace '\s+', ' ').Trim()
  $cleaned = $cleaned -replace '^(?:(?:[+@#*|/\\_\-.:;()[\]{}<>!?~]+|v\d{1,3}|\d{1,4}|vb|vi|vo|vx|v|l|i|o|x|signed|final|complete(?:d)?|normal|abnormal|new|old|read|unread|warning|warn|alert|check)\s+)+', ''
  $cleaned = $cleaned -replace '\b(?:reset\s+filters?|browse|search|filters?|refresh|apply|clear|cancel|save|export|print)\b', ' '
  $cleaned = $cleaned -replace '\s+', ' '
  $cleaned = $cleaned.Trim()
  if ($cleaned.Length -lt 2) { return 'UNCLEAR POWERSCRIBE ROW' }
  return $cleaned
}

function Strip-ProcedureDigitNoise([string] $Text) {
  if (-not $Text) { return [pscustomobject]@{ text = $Text; contaminated = $false } }
  $tokens = New-Object System.Collections.Generic.List[string]
  foreach ($token in ($Text -split '\s+')) {
    if ($token -ne '') { $tokens.Add($token) }
  }

  while ($tokens.Count -gt 0 -and $tokens[0] -match '^\d+$') {
    if ($tokens.Count -gt 1 -and $tokens[1] -match '(?i)^VIEWS?$') { break }
    $tokens.RemoveAt(0)
  }
  while ($tokens.Count -gt 0 -and $tokens[$tokens.Count - 1] -match '^\d+$') {
    if ($tokens.Count -gt 1 -and $tokens[$tokens.Count - 2] -match '(?i)^VIEWS?$') { break }
    $tokens.RemoveAt($tokens.Count - 1)
  }

  $contaminated = $false
  foreach ($token in $tokens) {
    if ($token -match '^\d{3,}$') { $contaminated = $true }
  }

  return [pscustomobject]@{ text = ($tokens -join ' '); contaminated = $contaminated }
}

function Apply-ProcedureDigitHygiene([string] $ProcedureName) {
  $hygiene = Strip-ProcedureDigitNoise $ProcedureName
  $text = if ($hygiene.text.Length -ge 2) { $hygiene.text } else { 'UNCLEAR POWERSCRIBE ROW' }
  return [pscustomobject]@{ text = $text; contaminated = $hygiene.contaminated }
}

function Median([double[]] $Values) {
  if ($Values.Length -eq 0) { return 22.0 }
  $sorted = [double[]]($Values | Sort-Object)
  $middle = [int][Math]::Floor($sorted.Length / 2)
  if ($sorted.Length % 2 -eq 1) { return $sorted[$middle] }
  return ($sorted[$middle - 1] + $sorted[$middle]) / 2.0
}

function Nearest-Line($Lines, [double] $Center, [double] $Tolerance) {
  $best = $null
  foreach ($line in $Lines) {
    $distance = [Math]::Abs($line.centerY - $Center)
    if ($distance -le $Tolerance -and ($null -eq $best -or $distance -lt $best.distance)) {
      $best = [pscustomobject]@{ line = $line; distance = $distance }
    }
  }
  if ($null -eq $best) { return $null }
  return $best.line
}

function Recombine-Rows($ProcedureOcr, $ExamOcr, $ModifiedOcr) {
  $allLines = @($ProcedureOcr.lines) + @($ExamOcr.lines) + @($ModifiedOcr.lines)
  $heights = [double[]]($allLines | ForEach-Object { $_.height })
  $tolerance = [Math]::Max(18.0, (Median $heights) * 0.85)
  $centers = @()
  foreach ($line in $allLines | Sort-Object centerY) {
    $existing = $null
    for ($i = 0; $i -lt $centers.Count; $i++) {
      if ([Math]::Abs($centers[$i] - $line.centerY) -le $tolerance) {
        $existing = $i
        break
      }
    }
    if ($null -eq $existing) {
      $centers += $line.centerY
    } else {
      $centers[$existing] = ($centers[$existing] + $line.centerY) / 2.0
    }
  }

  $rows = @()
  foreach ($center in $centers | Sort-Object) {
    $procedure = Nearest-Line $ProcedureOcr.lines $center $tolerance
    $exam = Nearest-Line $ExamOcr.lines $center $tolerance
    $modified = Nearest-Line $ModifiedOcr.lines $center $tolerance
    $rawProcedure = if ($procedure) { $procedure.text } else { '' }
    $rawExam = if ($exam) { $exam.text } else { '' }
    $rawModified = if ($modified) { $modified.text } else { '' }
    if (-not $rawProcedure -and -not $rawExam -and -not $rawModified) { continue }

    $procedureName = Clean-Procedure $rawProcedure
    $digitHygiene = Apply-ProcedureDigitHygiene $procedureName
    $procedureName = $digitHygiene.text
    $examDateTime = Parse-DateTimeText $rawExam
    $modifiedDateTime = Parse-DateTimeText $rawModified
    $alignmentScore = 1.0
    if (-not $procedure -or -not $exam -or -not $modified) { $alignmentScore = 0.72 }
    $confidence = 0.25
    if ($procedureName -ne 'UNCLEAR POWERSCRIBE ROW') { $confidence += 0.35 }
    if ($examDateTime) { $confidence += 0.20 }
    if ($modifiedDateTime) { $confidence += 0.20 }
    $confidence = [Math]::Max(0.0, [Math]::Min(1.0, $confidence * $alignmentScore))
    $reviewReasons = @()
    if ($procedureName -eq 'UNCLEAR POWERSCRIBE ROW') { $reviewReasons += 'Unclear PowerScribe procedure text' }
    if (-not $examDateTime) { $reviewReasons += 'Missing or unclear Exam Date' }
    if (-not $modifiedDateTime) { $reviewReasons += 'Missing or unclear Modified Date' }
    if ($alignmentScore -lt 1.0) { $reviewReasons += 'Incomplete OCR row alignment' }
    if ($digitHygiene.contaminated) { $reviewReasons += 'Numeric contamination in procedure text' }
    $needsReview = $reviewReasons.Count -gt 0 -or $confidence -lt 0.75

    $rows += [pscustomobject]@{
      procedureName = $procedureName
      examDateTime = $examDateTime
      modifiedDateTime = $modifiedDateTime
      rawProcedureText = $rawProcedure
      rawExamDateText = $rawExam
      rawModifiedText = $rawModified
      confidence = [Math]::Round($confidence, 3)
      needsReview = $needsReview
      reviewReason = if ($reviewReasons.Count -gt 0) { $reviewReasons -join '; ' } else { $null }
    }
  }
  return $rows
}

function Band-Rows($ProcedureOcr, $ExamOcr, $ModifiedOcr) {
  $anchorLines = @($ModifiedOcr.lines | Where-Object { Parse-DateTimeText $_.text } | Sort-Object centerY)
  if ($anchorLines.Count -eq 0) {
    return Recombine-Rows $ProcedureOcr $ExamOcr $ModifiedOcr
  }

  $pitches = @()
  for ($i = 1; $i -lt $anchorLines.Count; $i++) {
    $pitches += ($anchorLines[$i].centerY - $anchorLines[$i - 1].centerY)
  }
  $medianPitch = if ($pitches.Count -gt 0) { Median ([double[]]$pitches) } else { 40.0 }

  $rows = @()
  for ($i = 0; $i -lt $anchorLines.Count; $i++) {
    $anchor = $anchorLines[$i]
    $lower = if ($i -eq 0) { [double]::NegativeInfinity } else { ($anchorLines[$i - 1].centerY + $anchor.centerY) / 2.0 }
    $upper = if ($i -eq $anchorLines.Count - 1) { [double]::PositiveInfinity } else { ($anchor.centerY + $anchorLines[$i + 1].centerY) / 2.0 }

    $procedureLines = @($ProcedureOcr.lines | Where-Object { $_.centerY -gt $lower -and $_.centerY -le $upper } | Sort-Object centerY)
    $examLines = @($ExamOcr.lines | Where-Object { $_.centerY -gt $lower -and $_.centerY -le $upper } | Sort-Object centerY)

    $rawProcedure = (($procedureLines | ForEach-Object { $_.text }) -join ' ').Trim()
    $rawExam = (($examLines | ForEach-Object { $_.text }) -join ' ').Trim()
    $rawModified = $anchor.text

    $procedureName = Clean-Procedure $rawProcedure
    $digitHygiene = Apply-ProcedureDigitHygiene $procedureName
    $procedureName = $digitHygiene.text
    $examDateTime = Parse-DateTimeText $rawExam
    $modifiedDateTime = Parse-DateTimeText $rawModified

    $confidence = 0.25
    if ($procedureName -ne 'UNCLEAR POWERSCRIBE ROW') { $confidence += 0.35 }
    if ($examDateTime) { $confidence += 0.20 }
    if ($modifiedDateTime) { $confidence += 0.20 }
    $confidence = [Math]::Max(0.0, [Math]::Min(1.0, $confidence))

    $reviewReasons = @()
    if ($procedureName -eq 'UNCLEAR POWERSCRIBE ROW') { $reviewReasons += 'Unclear PowerScribe procedure text' }
    if (-not $examDateTime) { $reviewReasons += 'Missing or unclear Exam Date' }
    if (-not $modifiedDateTime) { $reviewReasons += 'Missing or unclear Modified Date' }
    if ($digitHygiene.contaminated) { $reviewReasons += 'Numeric contamination in procedure text' }
    if ($i -gt 0) {
      $gap = $anchor.centerY - $anchorLines[$i - 1].centerY
      if ($gap -gt $medianPitch * 1.6) {
        $reviewReasons += 'Possible undetected row above this one'
      }
    }
    $needsReview = $reviewReasons.Count -gt 0 -or $confidence -lt 0.75

    $rows += [pscustomobject]@{
      procedureName = $procedureName
      examDateTime = $examDateTime
      modifiedDateTime = $modifiedDateTime
      rawProcedureText = $rawProcedure
      rawExamDateText = $rawExam
      rawModifiedText = $rawModified
      confidence = [Math]::Round($confidence, 3)
      needsReview = $needsReview
      reviewReason = if ($reviewReasons.Count -gt 0) { $reviewReasons -join '; ' } else { $null }
    }
  }
  return $rows
}

function Find-PowerScribeHeaderAnchors($Words) {
  $procedureCandidates = $Words | Where-Object { $_.text -imatch '^Procedure$' }
  foreach ($proc in $procedureCandidates) {
    $rowTolerance = $proc.height * 0.7
    $examCandidate = $Words |
      Where-Object {
        $_.text -imatch '^Exam$' -and
        [Math]::Abs($_.centerY - $proc.centerY) -le $rowTolerance -and
        $_.x0 -gt $proc.x1
      } |
      Sort-Object x0 |
      Select-Object -First 1
    if (-not $examCandidate) { continue }

    $modifiedCandidate = $Words |
      Where-Object {
        $_.text -imatch '^Modif(?:ied|led|ted)$' -and
        [Math]::Abs($_.centerY - $proc.centerY) -le $rowTolerance -and
        $_.x0 -gt $examCandidate.x1
      } |
      Sort-Object x0 |
      Select-Object -First 1
    if (-not $modifiedCandidate) { continue }

    $heightPad = $proc.height
    $bottomPad = $proc.height * 0.5
    $headerBottom = [Math]::Max($proc.y1, [Math]::Max($examCandidate.y1, $modifiedCandidate.y1)) + $bottomPad

    return [pscustomobject]@{
      found = $true
      headerBottom = $headerBottom
      procX0 = [Math]::Max(0.0, $proc.x0 - $heightPad)
      examX0 = [Math]::Max(0.0, $examCandidate.x0 - $heightPad)
      modX0 = [Math]::Max(0.0, $modifiedCandidate.x0 - $heightPad)
    }
  }

  return [pscustomobject]@{ found = $false }
}

function Test-DateShapeWord([string] $Text) {
  if ($Text -imatch '^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$') { return $true }
  if ($Text -imatch '^\d{1,2}:\d{2}$') { return $true }
  if ($Text -imatch '^(?:AM|PM)$') { return $true }
  if ($Text -imatch '^\d{4}-\d{2}-\d{2}$') { return $true }
  return $false
}

function Get-TableRectFromAnchors($Words, $Anchors) {
  $dateWords = @($Words | Where-Object {
    $_.y0 -gt $Anchors.headerBottom -and
    $_.x0 -ge ($Anchors.examX0 - 4) -and
    (Test-DateShapeWord $_.text)
  })
  if ($dateWords.Count -eq 0) { return $null }

  $avgRowHeight = ($dateWords | Measure-Object -Property height -Average).Average
  $maxY1 = ($dateWords | Measure-Object -Property y1 -Maximum).Maximum
  $maxX1 = ($dateWords | Measure-Object -Property x1 -Maximum).Maximum
  $tableBottom = $maxY1 + $avgRowHeight * 0.7
  $tableRight = $maxX1 + $avgRowHeight

  return [pscustomobject]@{
    top = $Anchors.headerBottom
    bottom = $tableBottom
    left = $Anchors.procX0
    right = $tableRight
    columns = [pscustomobject]@{
      procedure = [pscustomobject]@{ x0 = $Anchors.procX0; x1 = $Anchors.examX0 - 6 }
      examDate = [pscustomobject]@{ x0 = $Anchors.examX0; x1 = $Anchors.modX0 - 6 }
      modifiedDate = [pscustomobject]@{ x0 = $Anchors.modX0; x1 = $tableRight }
    }
  }
}

function Get-InkProjectionRowEstimate([System.Drawing.Bitmap] $Bitmap) {
  $locked = Lock-BitmapBytes $Bitmap
  $bytes = $locked.bytes
  $stride = $locked.stride
  $width = $locked.width
  $height = $locked.height

  $luminance = New-Object double[] ($width * $height)
  $histogram = New-Object int[] 256
  for ($y = 0; $y -lt $height; $y++) {
    for ($x = 0; $x -lt $width; $x++) {
      $offset = $y * $stride + $x * 4
      $lum = ($bytes[$offset + 2] + $bytes[$offset + 1] + $bytes[$offset]) / 3.0
      $luminance[$y * $width + $x] = $lum
      $bucket = [Math]::Max(0, [Math]::Min(255, [int][Math]::Round($lum)))
      $histogram[$bucket] += 1
    }
  }
  $darkThreshold = Get-OtsuThreshold $histogram ($width * $height)

  $rowSignal = New-Object double[] $height
  for ($y = 0; $y -lt $height; $y++) {
    $count = 0
    for ($x = 0; $x -lt $width; $x++) {
      if ($luminance[$y * $width + $x] -lt $darkThreshold) { $count++ }
    }
    $rowSignal[$y] = $count / [Math]::Max(1, $width)
  }

  $smoothed = Smooth-Values $rowSignal 2
  $rowThreshold = [Math]::Max(0.01, (Percentile $smoothed 0.6))
  $runs = 0
  $active = $false
  for ($y = 0; $y -lt $height; $y++) {
    $isActive = $smoothed[$y] -ge $rowThreshold
    if ($isActive -and -not $active) { $runs++ }
    $active = $isActive
  }
  return $runs
}

function Get-AdaptiveThresholdBytes([byte[]] $Gray, [int] $Width, [int] $Height, [int] $Radius = 14, [double] $C = 7.0) {
  $integral = New-Object double[] (($Width + 1) * ($Height + 1))
  for ($y = 0; $y -lt $Height; $y++) {
    $rowSum = 0.0
    for ($x = 0; $x -lt $Width; $x++) {
      $rowSum += $Gray[$y * $Width + $x]
      $integral[($y + 1) * ($Width + 1) + $x + 1] = $integral[$y * ($Width + 1) + $x + 1] + $rowSum
    }
  }
  $output = New-Object byte[] ($Width * $Height)
  for ($y = 0; $y -lt $Height; $y++) {
    $y0 = [Math]::Max(0, $y - $Radius)
    $y1 = [Math]::Min($Height - 1, $y + $Radius)
    for ($x = 0; $x -lt $Width; $x++) {
      $x0 = [Math]::Max(0, $x - $Radius)
      $x1 = [Math]::Min($Width - 1, $x + $Radius)
      $area = ($x1 - $x0 + 1) * ($y1 - $y0 + 1)
      $sum = $integral[($y1 + 1) * ($Width + 1) + $x1 + 1] - $integral[$y0 * ($Width + 1) + $x1 + 1] - $integral[($y1 + 1) * ($Width + 1) + $x0] + $integral[$y0 * ($Width + 1) + $x0]
      $threshold = $sum / $area - $C
      $value = if ($Gray[$y * $Width + $x] -lt $threshold) { 0 } else { 255 }
      $output[$y * $Width + $x] = $value
    }
  }
  return $output
}

function Preprocess-ColumnBitmapForOcr([System.Drawing.Bitmap] $Bitmap) {
  $scale = 3
  $width = [Math]::Max(1, $Bitmap.Width * $scale)
  $height = [Math]::Max(1, $Bitmap.Height * $scale)
  $scaled = New-Object System.Drawing.Bitmap $width, $height
  $graphics = [System.Drawing.Graphics]::FromImage($scaled)
  $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $graphics.DrawImage($Bitmap, 0, 0, $width, $height)
  $graphics.Dispose()
  try {
    $locked = Lock-BitmapBytes $scaled
    $bytes = $locked.bytes
    $stride = $locked.stride
    $gray = New-Object byte[] ($width * $height)
    for ($y = 0; $y -lt $height; $y++) {
      for ($x = 0; $x -lt $width; $x++) {
        $offset = $y * $stride + $x * 4
        $raw = $bytes[$offset + 2] * 0.299 + $bytes[$offset + 1] * 0.587 + $bytes[$offset] * 0.114
        $contrasted = [Math]::Max(0.0, [Math]::Min(255.0, ($raw - 128.0) * 1.55 + 128.0))
        $gray[$y * $width + $x] = [byte][Math]::Round($contrasted)
      }
    }
    $thresholded = Get-AdaptiveThresholdBytes $gray $width $height

    $result = New-Object System.Drawing.Bitmap $width, $height
    $resultRect = New-Object System.Drawing.Rectangle 0, 0, $width, $height
    $resultData = $result.LockBits($resultRect, [System.Drawing.Imaging.ImageLockMode]::WriteOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $resultStride = $resultData.Stride
      $outBytes = New-Object byte[] ($resultStride * $height)
      for ($y = 0; $y -lt $height; $y++) {
        for ($x = 0; $x -lt $width; $x++) {
          $value = $thresholded[$y * $width + $x]
          $outOffset = $y * $resultStride + $x * 4
          $outBytes[$outOffset] = $value
          $outBytes[$outOffset + 1] = $value
          $outBytes[$outOffset + 2] = $value
          $outBytes[$outOffset + 3] = 255
        }
      }
      [System.Runtime.InteropServices.Marshal]::Copy($outBytes, 0, $resultData.Scan0, $outBytes.Length)
    } finally {
      $result.UnlockBits($resultData)
    }
    return $result
  } finally {
    $scaled.Dispose()
  }
}

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  throw 'Clipboard does not contain an image.'
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
$bitmap = New-Object System.Drawing.Bitmap $image
try {
  $cropMethod = $null
  $procedureRect = $null
  $examRect = $null
  $modifiedRect = $null

  $fullOcr = Invoke-Ocr $bitmap
  $headerAnchors = Find-PowerScribeHeaderAnchors $fullOcr.words
  if ($headerAnchors.found) {
    $anchoredTable = Get-TableRectFromAnchors $fullOcr.words $headerAnchors
    if ($null -ne $anchoredTable) {
      $bitmapWidth = [double]$bitmap.Width
      $bitmapHeight = [double]$bitmap.Height
      $cropMethod = 'header-anchor'
      $procedureRect = Normalize-Rect ([pscustomobject]@{
        x = $anchoredTable.columns.procedure.x0 / $bitmapWidth
        y = $anchoredTable.top / $bitmapHeight
        width = ($anchoredTable.columns.procedure.x1 - $anchoredTable.columns.procedure.x0) / $bitmapWidth
        height = ($anchoredTable.bottom - $anchoredTable.top) / $bitmapHeight
      })
      $examRect = Normalize-Rect ([pscustomobject]@{
        x = $anchoredTable.columns.examDate.x0 / $bitmapWidth
        y = $anchoredTable.top / $bitmapHeight
        width = ($anchoredTable.columns.examDate.x1 - $anchoredTable.columns.examDate.x0) / $bitmapWidth
        height = ($anchoredTable.bottom - $anchoredTable.top) / $bitmapHeight
      })
      $modifiedRect = Normalize-Rect ([pscustomobject]@{
        x = $anchoredTable.columns.modifiedDate.x0 / $bitmapWidth
        y = $anchoredTable.top / $bitmapHeight
        width = ($anchoredTable.columns.modifiedDate.x1 - $anchoredTable.columns.modifiedDate.x0) / $bitmapWidth
        height = ($anchoredTable.bottom - $anchoredTable.top) / $bitmapHeight
      })
    }
  }

  if ($null -eq $procedureRect) {
    $table = Detect-TableCrop $bitmap
    $hasSavedCrop = $null -ne $SavedCropX -and $null -ne $SavedCropY -and $null -ne $SavedCropWidth -and $null -ne $SavedCropHeight
    if ($table.method -ne 'detected' -and $hasSavedCrop) {
      $table = [pscustomobject]@{
        rect = Normalize-Rect ([pscustomobject]@{ x = $SavedCropX; y = $SavedCropY; width = $SavedCropWidth; height = $SavedCropHeight })
        confidence = 1.0
        method = 'saved'
      }
      $cropMethod = 'saved-crop'
    } elseif ($table.method -eq 'detected') {
      $cropMethod = 'pixel-valley'
    } else {
      $cropMethod = 'default'
    }
    $columnLayout = Detect-ColumnLayout $bitmap $table.rect
    $procedureRect = Child-Rect $table.rect $columnLayout.columns.procedure
    $examRect = Child-Rect $table.rect $columnLayout.columns.examDate
    $modifiedRect = Child-Rect $table.rect $columnLayout.columns.modifiedDate
  }

  $procedureBitmap = Crop-Bitmap $bitmap $procedureRect
  $examBitmap = Crop-Bitmap $bitmap $examRect
  $modifiedBitmap = Crop-Bitmap $bitmap $modifiedRect
  try {
    $procedurePreprocessed = Preprocess-ColumnBitmapForOcr $procedureBitmap
    $examPreprocessed = Preprocess-ColumnBitmapForOcr $examBitmap
    $modifiedPreprocessed = Preprocess-ColumnBitmapForOcr $modifiedBitmap
    try {
      $procedureOcr = Invoke-Ocr $procedurePreprocessed
      $examOcr = Invoke-Ocr $examPreprocessed
      $modifiedOcr = Invoke-Ocr $modifiedPreprocessed
      $rows = Band-Rows $procedureOcr $examOcr $modifiedOcr

      $anchorCount = @($modifiedOcr.lines | Where-Object { Parse-DateTimeText $_.text }).Count
      $suspectedMissedRows = @($rows | Where-Object { $_.reviewReason -and $_.reviewReason -like '*Possible undetected row above this one*' }).Count
      $inkProjectionRowEstimate = Get-InkProjectionRowEstimate $procedureBitmap

      $accounting = [pscustomobject]@{
        cropMethod = $cropMethod
        anchorCount = $anchorCount
        procedureLineCount = $procedureOcr.lines.Count
        examLineCount = $examOcr.lines.Count
        modifiedLineCount = $modifiedOcr.lines.Count
        bandCount = $rows.Count
        suspectedMissedRows = $suspectedMissedRows
        inkProjectionRowEstimate = $inkProjectionRowEstimate
      }

      [pscustomobject]@{ rows = $rows; accounting = $accounting } | ConvertTo-Json -Depth 8 -Compress
    } finally {
      $procedurePreprocessed.Dispose()
      $examPreprocessed.Dispose()
      $modifiedPreprocessed.Dispose()
    }
  } finally {
    $procedureBitmap.Dispose()
    $examBitmap.Dispose()
    $modifiedBitmap.Dispose()
  }
} finally {
  $bitmap.Dispose()
}
`;
