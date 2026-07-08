export const windowsPowerScribeOcrScript = String.raw`
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
  $minX = 0.18
  $minY = 0.20
  $maxRight = 0.98
  $maxBottom = 0.88
  $x = [Math]::Max($minX, $bounded.x)
  $y = [Math]::Max($minY, $bounded.y)
  $right = [Math]::Min($maxRight, [Math]::Max($x + 0.45, $bounded.x + $bounded.width))
  $bottom = [Math]::Min($maxBottom, [Math]::Max($y + 0.24, $bounded.y + $bounded.height))
  return Normalize-Rect ([pscustomobject]@{ x = $x; y = $y; width = $right - $x; height = $bottom - $y })
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
    $rowSignal = New-Object double[] $height
    $colSignal = New-Object double[] $width
    $xMin = [int][Math]::Floor($width * 0.18)
    $xMax = [int][Math]::Floor($width * 0.98)
    $yMin = [int][Math]::Floor($height * 0.20)
    $yMax = [int][Math]::Floor($height * 0.88)

    for ($y = $yMin + 1; $y -lt $yMax; $y++) {
      for ($x = $xMin + 1; $x -lt $xMax; $x++) {
        $pixel = $small.GetPixel($x, $y)
        $left = $small.GetPixel($x - 1, $y)
        $up = $small.GetPixel($x, $y - 1)
        $lum = ($pixel.R + $pixel.G + $pixel.B) / 3.0
        $leftLum = ($left.R + $left.G + $left.B) / 3.0
        $upLum = ($up.R + $up.G + $up.B) / 3.0
        $contrast = [Math]::Max([Math]::Abs($lum - $leftLum), [Math]::Abs($lum - $upLum))
        if ($contrast -gt 18 -or $lum -lt 88) {
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
      width = [Math]::Min(0.8, ([Math]::Min($width - 1, $colBand.end + [Math]::Round($width * 0.035)) / [double]$width) - (($colBand.start / [double]$width) - 0.02))
      height = [Math]::Min(0.68, ([Math]::Min($height - 1, $rowBand.end + [Math]::Round($height * 0.025)) / [double]$height) - (($rowBand.start / [double]$height) - 0.015))
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

function Best-GutterBand([double[]] $Values, [double] $MinRatio, [double] $MaxRatio, [double] $Threshold) {
  $minIndex = [Math]::Max(0, [int][Math]::Floor($Values.Length * $MinRatio))
  $maxIndex = [Math]::Min($Values.Length - 1, [int][Math]::Ceiling($Values.Length * $MaxRatio))
  $minWidth = [Math]::Max(6, [int][Math]::Round($Values.Length * 0.012))
  $best = $null
  $start = $null
  $sum = 0.0

  for ($i = $minIndex; $i -le $maxIndex; $i++) {
    $low = $Values[$i] -le $Threshold
    if ($low -and $null -eq $start) {
      $start = $i
      $sum = 0.0
    }
    if ($low) { $sum += $Values[$i] }
    if ((-not $low -or $i -eq $maxIndex) -and $null -ne $start) {
      $end = if ($low) { $i } else { $i - 1 }
      $width = $end - $start + 1
      if ($width -ge $minWidth) {
        $average = $sum / [Math]::Max(1, $width)
        $score = $width * [Math]::Max(0.0001, $Threshold - $average)
        if ($null -eq $best -or $score -gt $best.score) {
          $best = [pscustomobject]@{
            center = (($start + $end) / 2.0) / [double]$Values.Length
            width = $width / [double]$Values.Length
            score = $score
          }
        }
      }
      $start = $null
      $sum = 0.0
    }
  }

  return $best
}

function Detect-ColumnLayoutFromProjection([double[]] $Projection) {
  if ($Projection.Length -lt 80) { return Get-FallbackColumnLayout }

  $smoothRadius = [Math]::Max(2, [int][Math]::Round($Projection.Length * 0.006))
  $smoothed = Smooth-Values $Projection $smoothRadius
  $windowStart = [Math]::Floor($smoothed.Length * 0.10)
  $windowEnd = [Math]::Floor($smoothed.Length * 0.96)
  $window = [double[]]($smoothed[$windowStart..$windowEnd])
  $lowThreshold = [Math]::Max(0.0015, (Percentile $window 0.24))
  $firstGutter = Best-GutterBand $smoothed 0.45 0.68 $lowThreshold
  $secondGutter = Best-GutterBand $smoothed 0.66 0.90 $lowThreshold

  if ($null -eq $firstGutter -or $null -eq $secondGutter -or ($secondGutter.center - $firstGutter.center) -lt 0.10) {
    return Get-FallbackColumnLayout
  }

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
    for ($y = $yMin + 1; $y -lt $yMax; $y++) {
      for ($x = 1; $x -lt ($width - 1); $x++) {
        $pixel = $small.GetPixel($x, $y)
        $leftPixel = $small.GetPixel($x - 1, $y)
        $lum = $pixel.R * 0.299 + $pixel.G * 0.587 + $pixel.B * 0.114
        $leftLum = $leftPixel.R * 0.299 + $leftPixel.G * 0.587 + $leftPixel.B * 0.114
        if ($lum -lt 150 -or [Math]::Abs($lum - $leftLum) -gt 28) {
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

function Invoke-Ocr([System.Drawing.Bitmap] $Bitmap) {
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
  if ($null -eq $engine) { throw 'Windows OCR is not available for the current user language.' }
  $softwareBitmap = Get-SoftwareBitmap $Bitmap
  $result = Await-WinRt ($engine.RecognizeAsync($softwareBitmap)) ([Windows.Media.Ocr.OcrResult])
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
  }
}

function Parse-DateTimeText([string] $Text) {
  if (-not $Text) { return $null }
  $patterns = @(
    '\b(?<m>\d{1,2})/(?<d>\d{1,2})/(?<y>\d{2,4})\s+(?<h>\d{1,2}):(?<min>\d{2})(?::\d{2})?\s*(?<ampm>AM|PM|am|pm)?\b',
    '\b(?<y>\d{4})-(?<m>\d{2})-(?<d>\d{2})[T\s](?<h>\d{1,2}):(?<min>\d{2})(?::\d{2})?\b'
  )
  foreach ($pattern in $patterns) {
    $match = [regex]::Match($Text, $pattern)
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

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  throw 'Clipboard does not contain an image.'
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
$bitmap = New-Object System.Drawing.Bitmap $image
try {
  $table = Detect-TableCrop $bitmap
  $columnLayout = Detect-ColumnLayout $bitmap $table.rect
  $procedureRect = Child-Rect $table.rect $columnLayout.columns.procedure
  $examRect = Child-Rect $table.rect $columnLayout.columns.examDate
  $modifiedRect = Child-Rect $table.rect $columnLayout.columns.modifiedDate

  $procedureBitmap = Crop-Bitmap $bitmap $procedureRect
  $examBitmap = Crop-Bitmap $bitmap $examRect
  $modifiedBitmap = Crop-Bitmap $bitmap $modifiedRect
  try {
    $procedureOcr = Invoke-Ocr $procedureBitmap
    $examOcr = Invoke-Ocr $examBitmap
    $modifiedOcr = Invoke-Ocr $modifiedBitmap
    $rows = Recombine-Rows $procedureOcr $examOcr $modifiedOcr
    $rows | ConvertTo-Json -Depth 8 -Compress
  } finally {
    $procedureBitmap.Dispose()
    $examBitmap.Dispose()
    $modifiedBitmap.Dispose()
  }
} finally {
  $bitmap.Dispose()
}
`;
