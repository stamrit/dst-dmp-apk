<h1 align="center">DST DMP Android</h1><p align="center">
  <strong>Don't Starve Together · DMP Android 管理客户端</strong>
</p><p align="center">
  在 Android 设备上连接和管理 DST Management Platform
</p><p align="center">
  <strong>非官方第三方 Android 客户端</strong>
</p>---

📱 项目介绍

DST DMP Android 是一个面向 Android 的 Don't Starve Together（饥荒联机版）服务器管理客户端。

本项目用于在 Android 手机、平板等设备上连接 DST Management Platform（DMP），并针对 Android WebView、触摸操作和移动端环境进行适配。

项目主要由以下部分组成：

- Android 原生客户端
- DMP Web 前端
- DMP API 通信
- JavaScript Bridge
- Android WebView 适配
- 移动端界面及交互适配

APK 内置经过适配的 DMP Web 前端资源，因此前端页面可以直接从 APK 本地资源加载。

---

🔗 上游项目

本项目基于或使用以下开源项目。

DST Management Platform API

项目地址：

https://github.com/miracleEverywhere/dst-management-platform-api

DMP 服务端及 API 项目，为本 Android 客户端提供服务器管理相关 API。

许可证：

MIT License
Copyright (c) 2024 Miracle

---

DST Management Platform Desktop

项目地址：

https://github.com/miracleEverywhere/dst-management-platform-desktop

本 APK 内置的部分 DMP Web 前端资源来源于或基于该项目，并针对 Android WebView 和移动端环境进行了适配。

许可证：

MIT License
Copyright (c) 2025 Miracle

感谢 Miracle 以及 DST Management Platform 项目所有贡献者的开源工作。

---

🧩 项目结构

主要 Android 代码及 Web 前端资源位于：

app/src/main/
├── java/
│   └── cn/xiaojie_gjs/bianjiemj/ui/dmp/
│
└── assets/
    └── dmp_web/

其中：

"java/.../ui/dmp/"

主要包含 Android 原生 DMP 功能，例如：

DmpActivity
DmpWebActivity
DmpApiClient
DmpJavascriptBridge
...

"assets/dmp_web/"

包含 APK 内置的 DMP Web 前端资源。

Android 原生代码与 Web 前端之间的部分功能通过 JavaScript Bridge 进行通信。

---

🛠️ 构建

本项目是 Android Gradle 项目。

Windows

普通构建

.\gradlew.bat :app:assembleDebug

离线构建

如果 Gradle 依赖已经缓存：

.\gradlew.bat :app:assembleDebug --offline

---

Linux / macOS

普通构建

./gradlew :app:assembleDebug

离线构建

./gradlew :app:assembleDebug --offline

---

📦 APK 输出位置

Debug APK 默认生成在：

app/build/outputs/apk/debug/

通常可以在这里找到：

app/build/outputs/apk/debug/app-debug.apk

实际 APK 文件名可能根据 Gradle 配置发生变化。

---

🌐 网络连接

客户端需要连接一个可以正常访问的 DMP 服务端。

例如局域网环境：

http://192.168.1.100:端口

或者通过域名访问：

https://example.com

对于公网 DMP 服务，建议配置 HTTPS。

使用 HTTP 时，通信内容为明文，在不可信网络环境下可能存在认证信息或管理数据被监听、篡改的风险。

---

🔐 安全提醒

请勿将真实的服务器认证信息提交到公开 GitHub 仓库，例如：

- API Token
- DMP 管理密码
- Cookie / Session
- SSH 密码
- SSH 私钥
- 服务器管理凭据
- 其他敏感认证信息

包含敏感数据的本地配置文件建议加入 ".gitignore"。

---

📜 许可证

本项目包含不同许可条件的代码与资源。

DMP API

来自 DST Management Platform API 的代码、资源及其衍生部分继续按照原项目 MIT License 授权。

Copyright (c) 2024 Miracle

完整 MIT License：

LICENSES/DST-Management-Platform-API-MIT.txt

DMP Desktop

来自 DST Management Platform Desktop 的代码、Web 前端资源及其衍生部分继续按照原项目 MIT License 授权。

Copyright (c) 2025 Miracle

完整 MIT License：

LICENSES/DST-Management-Platform-Desktop-MIT.txt

DST DMP Android 原创部分

除第三方开源组件及其衍生部分外，本项目自行开发的 Android 原生代码、Android 集成、移动端界面适配及其他原创内容按照仓库根目录：

LICENSE

中的条款处理。

«本仓库包含 MIT License 授权的第三方内容，但这并不意味着本仓库所有原创代码均以 MIT License 授权。»

完整第三方版权及许可证说明：

THIRD_PARTY_NOTICES.md

---

🤖 AI 辅助开发

本项目的部分代码、文档、调试、重构及开发过程可能使用 AI 工具辅助完成。

AI 辅助开发不会改变第三方代码原本适用的许可证和版权归属。

---

⚠️ 免责声明

本项目是一个非官方第三方 Android 客户端。

本项目与 DST Management Platform 原作者不存在官方隶属、赞助或背书关系。

本项目与 Klei Entertainment 不存在官方关联、赞助或背书关系。

Don't Starve、Don't Starve Together、Klei Entertainment 以及相关名称、商标、Logo、游戏资源和其他知识产权归其各自权利人所有。

使用者应自行承担使用本项目连接、配置和管理服务器产生的风险。

第三方开源组件继续适用其各自许可证中的免责声明和责任限制。

---

❤️ 致谢

感谢以下开源项目及其贡献者：

DST Management Platform API

https://github.com/miracleEverywhere/dst-management-platform-api

DST Management Platform Desktop

https://github.com/miracleEverywhere/dst-management-platform-desktop

特别感谢 Miracle 及所有参与 DST Management Platform 开发和维护的贡献者。
