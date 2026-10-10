@echo off
rem Builds "Update Site.exe" in the repo root using the C# compiler that ships with Windows (.NET Framework 4.x).
"%WINDIR%\Microsoft.NET\Framework64\v4.0.30319\csc.exe" /nologo /codepage:65001 /target:winexe /optimize ^
  /r:System.Web.Extensions.dll /r:System.Windows.Forms.dll /r:System.Drawing.dll ^
  /out:"%~dp0..\Update Site.exe" "%~dp0updater\Updater.cs" && echo Built "Update Site.exe"
