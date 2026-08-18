DST DMP Android

一个面向 Android 的 Don't Starve Together（饥荒联机版）服务器管理客户端。

本项目用于在 Android 设备上连接和管理 DST Management Platform（DMP），并针对 Android WebView 和移动设备进行了适配。

«本项目为非官方第三方 Android 客户端。»

---

项目说明

本项目主要由 Android 原生代码、DMP Web 前端和 DMP API 通信功能组成。

APK 内置了经过 Android 适配的 DMP Web 前端资源，并通过 Android 原生代码、JavaScript Bridge 和 DMP API 实现相关管理功能。

主要上游项目：

DST Management Platform API

https://github.com/miracleEverywhere/dst-management-platform-api

用于提供 DMP 服务端及相关 API 功能。

- Copyright (c) 2024 Miracle
- MIT License

DST Management Platform Desktop

https://github.com/miracleEverywhere/dst-management-platform-desktop

APK 内置的部分 DMP Web 前端资源来源于或基于 DST Management Platform Desktop，并针对 Android WebView 和移动端环境进行了适配。

- Copyright (c) 2025 Miracle
- MIT License

感谢 Miracle 及 DST Management Platform 项目贡献者的开源工作。

---

构建

本项目为 Android Gradle 项目。

Windows

普通构建：

.\gradlew.bat :app:assembleDebug

如果 Gradle 依赖已经缓存完成，可以使用离线构建：

.\gradlew.bat :app:assembleDebug --offline

Linux / macOS

普通构建：

./gradlew :app:assembleDebug

离线构建：

./gradlew :app:assembleDebug --offline

---

APK 输出位置

Debug APK 默认生成在：

app/build/outputs/apk/debug/

通常为：

app/build/outputs/apk/debug/app-debug.apk

---

前端资源

APK 使用的 DMP Web 前端资源位于：

app/src/main/assets/dmp_web/

其中部分资源来源于或基于：

https://github.com/miracleEverywhere/dst-management-platform-desktop

并针对 Android WebView 环境进行了适配。

Android 与 Web 前端之间的部分功能通过 JavaScript Bridge 实现。

---

网络说明

客户端需要连接可访问的 DMP 服务端。

可以根据实际部署情况使用局域网地址、服务器地址或域名，例如：

http://192.168.1.100:端口

或：

https://example.com

对于公网环境，建议使用 HTTPS，避免通过不可信网络明文传输管理信息和认证数据。

---

许可证

本项目包含不同许可条件的代码与资源。

来自 DST Management Platform API 和 DST Management Platform Desktop 的代码、资源及其衍生部分，继续按照各自原始 MIT License 授权。

原始 MIT License 副本已保留在：

LICENSES/DST-Management-Platform-API-MIT.txt
LICENSES/DST-Management-Platform-Desktop-MIT.txt

其中：

- DST Management Platform API
  Copyright (c) 2024 Miracle
- DST Management Platform Desktop
  Copyright (c) 2025 Miracle

本项目自行开发的 Android 原生代码、Android 集成、界面适配及其他原创部分，按照本仓库根目录 "LICENSE" 中的条款处理。

详细的第三方版权及许可证信息请参阅：

THIRD_PARTY_NOTICES.md

---

免责声明

本项目是非官方第三方 Android 客户端。

本项目与 DST Management Platform 原作者及 Klei Entertainment 不存在官方隶属、赞助或背书关系。

Don't Starve、Don't Starve Together、Klei Entertainment 以及相关名称、商标和游戏资源归其各自权利人所有。

本项目的部分代码、文档、调试及开发过程可能使用 AI 工具辅助完成。
