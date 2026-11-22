param([string]$Title,[string]$Path)
Add-Type @"
using System;using System.Text;using System.Runtime.InteropServices;
public class FD {
 public delegate bool EnumProc(IntPtr h, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
 [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
 [DllImport("user32.dll")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern int GetClassName(IntPtr h, StringBuilder s, int n);
 [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, string l);
 [DllImport("user32.dll")] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr w, IntPtr l);
}
"@
$target=[IntPtr]::Zero
[FD]::EnumWindows({param($h,$l) $sb=New-Object Text.StringBuilder 256; [void][FD]::GetWindowText($h,$sb,256); if([FD]::IsWindowVisible($h) -and $sb.ToString() -eq $Title){ $script:target=$h }; return $true },[IntPtr]::Zero) | Out-Null
if($target -eq [IntPtr]::Zero){ Write-Error "dialog not found: $Title"; exit 2 }
$edit=[IntPtr]::Zero; $open=[IntPtr]::Zero
[FD]::EnumChildWindows($target,{param($h,$l) $sb=New-Object Text.StringBuilder 256; [void][FD]::GetWindowText($h,$sb,256); $cn=New-Object Text.StringBuilder 256; [void][FD]::GetClassName($h,$cn,256); $id=[FD]::GetDlgCtrlID($h); if($cn.ToString() -eq 'Edit' -and ($id -eq 1148 -or $id -eq 1001)){ $script:edit=$h }; if($cn.ToString() -eq 'Button' -and $id -eq 1){ $script:open=$h }; return $true },[IntPtr]::Zero) | Out-Null
if($edit -eq [IntPtr]::Zero -or $open -eq [IntPtr]::Zero){ Write-Error "controls not found edit=$edit open=$open"; exit 3 }
[void][FD]::SendMessage($edit,0x000C,[IntPtr]::Zero,$Path)
Start-Sleep -Milliseconds 80
[void][FD]::SendMessage($open,0x00F5,[IntPtr]::Zero,[IntPtr]::Zero)
Start-Sleep -Milliseconds 120
Write-Output "ok $Title <- $Path"

