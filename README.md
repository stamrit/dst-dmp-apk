# DST DMP APK

DMP 的 Android APK 工程，

## 致谢与说明

本项目基于 [MiracleEverywhere/dst-management-platform-api](https://github.com/miracleEverywhere/dst-management-platform-api) 的开源项目进行学习、适配与二次开发。

- 原项目作者：Miracle（GitHub：[@miracleEverywhere](https://github.com/miracleEverywhere)）
- 本项目为非官方 Android 客户端改造版本
- 部分功能由 AI 辅助修改与实现
- 本项目基于 Miracle 的开源文件，个人修改制作

## 免责声明

本项目仍处于实验和完善阶段，可能存在功能缺陷、兼容性问题或未知 Bug。  
请在使用前自行备份服务器配置与重要数据，并自行承担使用风险。

使用、分发或修改本项目时，请同时遵守原项目的开源许可证；如有冲突，以原项目许可证为准。

## 构建

暂不提供apk安装包，需自行打包，在本目录执行：

```powershell
.\gradlew.bat :app:assembleDebug --offline
```

生成的 APK 位于 `app\build\outputs\apk\debug\app-debug.apk`。

离线管理前端位于 `app/src/main/assets/dmp_web`，其基础构建产物来自 `dst-management-platform-desktop-master/dist`，并通过 `dmp-android-bridge.js` 适配 Android WebView。
