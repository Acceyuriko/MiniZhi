@echo off
rem MiniZhi 守护启动：崩溃后 3 秒自动重启；日志写 data\server.log
rem 由启动文件夹里的 MiniZhi.vbs 以隐藏窗口方式调用，开机自动运行
cd /d "%~dp0.."
if not exist data mkdir data
:loop
echo [%date% %time%] --- starting node server/index.js --- >> data\server.log
node server\index.js >> data\server.log 2>&1
echo [%date% %time%] --- exited with code %errorlevel% --- >> data\server.log
timeout /t 3 /nobreak >nul
goto loop
