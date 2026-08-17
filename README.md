# DMP Mobile

独立 Android APK 工程，提取自“便捷9号”中的 DMP 服务器管理模块。

## 构建

在本目录执行：

```powershell
.\gradlew.bat :app:assembleDebug --offline
```

生成的 APK 位于 `app\build\outputs\apk\debug\app-debug.apk`。

离线管理前端位于 `app/src/main/assets/dmp_web`，其基础构建产物来自 `dst-management-platform-desktop-master/dist`，并通过 `dmp-android-bridge.js` 适配 Android WebView。
