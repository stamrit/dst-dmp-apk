<h1 align="center">DST DMP Android</h1><p align="center">
  <strong>Don't Starve Together · DMP Android 管理客户端</strong>
</p><p align="center">
  面向 Android 手机和平板的 DST Management Platform 第三方客户端
</p><p align="center">
  <strong>非官方项目 · Android 适配</strong>
</p>---

📱 项目介绍

DST DMP Android 是一个面向 Android 的 Don't Starve Together（饥荒联机版）服务器管理客户端。

本项目用于在 Android 设备上连接 DST Management Platform（DMP） 服务端，并针对 Android WebView、触摸操作以及移动端使用环境进行适配。

项目主要包含：

- Android 原生客户端
- Android WebView
- DMP Web 前端适配
- DMP API 通信
- JavaScript Bridge
- 移动端界面及交互适配
- DMP 服务器连接与配置

APK 内置经过 Android 适配的 DMP Web 前端资源，可直接从 APK 本地加载相关页面资源。

---

🔗 相关上游项目

本项目使用、适配或与以下开源项目进行兼容。

DST Management Platform API

项目地址：

https://github.com/miracleEverywhere/dst-management-platform-api

DST Management Platform 的服务端/API 项目。

本 Android 客户端按照 DMP API 提供的接口与 DMP 服务端进行通信，实现相关服务器管理功能。

原项目许可证：

MIT License
Copyright (c) 2024 Miracle

MIT License 副本：

LICENSES/DST-Management-Platform-API-MIT.txt

---

DST Management Platform Desktop

项目地址：

https://github.com/miracleEverywhere/dst-management-platform-desktop

本 APK 内置的部分 DMP Web 前端资源来源于或基于 DST Management Platform Desktop，并针对 Android WebView 和移动设备进行了适配。

原项目许可证：

MIT License
Copyright (c) 2025 Miracle

MIT License 副本：

LICENSES/DST-Management-Platform-Desktop-MIT.txt

感谢 Miracle 以及 DST Management Platform 项目所有贡献者的开源工作。

---

🧩 项目结构

主要 Android 代码和 Web 前端资源位于：

app/src/main/
├── java/
│   └── cn/xiaojie_gjs/bianjiemj/ui/dmp/
│
└── assets/
    └── dmp_web/

Android 原生部分

"java/.../ui/dmp/" 中包含 Android 侧的 DMP 相关功能，例如：

DmpActivity
DmpWebActivity
DmpApiClient
DmpJavascriptBridge
...

Web 前端

APK 内置 Web 前端位于：

app/src/main/assets/dmp_web/

其中部分前端资源来源于或基于 DST Management Platform Desktop。

Android 原生代码与 Web 前端之间的部分功能通过 JavaScript Bridge 进行通信。

---

🛠️ 构建

本项目是 Android Gradle 项目。

Windows

普通构建：

.\gradlew.bat :app:assembleDebug

如果 Gradle 依赖已经缓存，可以使用离线构建：

.\gradlew.bat :app:assembleDebug --offline

Linux / macOS

普通构建：

./gradlew :app:assembleDebug

离线构建：

./gradlew :app:assembleDebug --offline

---

📦 APK 输出位置

Debug APK 默认生成在：

app/build/outputs/apk/debug/

通常为：

app/build/outputs/apk/debug/app-debug.apk

实际 APK 文件名可能根据 Gradle 配置发生变化。

---

🌐 连接 DMP

客户端需要连接用户自行部署或有权使用的 DMP 服务端。

例如局域网：

http://192.168.1.100:端口

或者使用域名：

https://example.com

实际地址、端口以及认证方式以 DMP 服务端配置为准。

对于通过公网访问的 DMP 服务，建议配置 HTTPS。

HTTP 属于明文通信，在不可信网络环境中可能存在认证信息或管理数据被监听、篡改的风险。

---

🔐 安全提醒

请勿将真实的服务器认证信息提交到公开 GitHub 仓库，包括但不限于：

- DMP 管理密码
- API Token
- Cookie
- Session
- SSH 密码
- SSH 私钥
- 服务器管理凭据
- 其他敏感认证信息

包含敏感数据的本地配置文件建议加入 ".gitignore"。

---

📜 许可证

本仓库包含适用不同许可条件的代码与资源。

DST Management Platform API

DST Management Platform API：

Copyright (c) 2024 Miracle
MIT License

对应许可证副本：

LICENSES/DST-Management-Platform-API-MIT.txt

如果本项目包含来源于或衍生自 DST Management Platform API 的代码或其他受版权保护内容，这些部分继续按照原项目 MIT License 授权。

仅与 DMP API 进行通信或兼容本身不改变本项目原创 Android 代码的许可证。

---

DST Management Platform Desktop

DST Management Platform Desktop：

Copyright (c) 2025 Miracle
MIT License

本项目中来源于、修改自或基于 DST Management Platform Desktop 的 Web 前端资源继续按照原项目 MIT License 授权。

对应许可证副本：

LICENSES/DST-Management-Platform-Desktop-MIT.txt

---

本项目原创部分

除第三方开源组件、上游代码及其衍生部分外，本项目自行开发的 Android 原生代码、Android 集成、移动端适配及其他原创内容按照仓库根目录：

LICENSE

中的条款处理。

«本仓库包含 MIT License 授权的第三方内容，但这并不意味着本仓库全部原创代码均以 MIT License 授权。»

第三方项目、版权和许可证的详细说明：

THIRD_PARTY_NOTICES.md

原始 MIT License 副本保存在：

LICENSES/
├── DST-Management-Platform-API-MIT.txt
└── DST-Management-Platform-Desktop-MIT.txt

---

🤖 AI 辅助开发

本项目的部分代码、文档、调试、重构及开发过程可能使用 AI 工具辅助完成。

AI 辅助开发不会改变第三方代码原本适用的许可证或版权归属。

---

⚠️ 免责声明

本项目是非官方第三方 Android 客户端。

本项目由独立开发者维护，与 DST Management Platform 原作者不存在官方隶属、赞助或背书关系。

本项目与 Klei Entertainment 不存在官方关联、赞助或背书关系。

Don't Starve、Don't Starve Together、Klei Entertainment 以及相关名称、商标、Logo、游戏资源和其他知识产权归其各自权利人所有。

使用者应自行承担使用本项目连接、配置及管理服务器产生的风险。

第三方开源组件继续适用其各自许可证中的免责声明和责任限制。

---

❤️ 致谢

感谢 Miracle 以及 DST Management Platform 的所有贡献者。

DST Management Platform API

https://github.com/miracleEverywhere/dst-management-platform-api

DST Management Platform Desktop

https://github.com/miracleEverywhere/dst-management-platform-desktop

---

<p align="center">
  <strong>DST DMP Android</strong>
</p><p align="center">
  Android adaptation for DST Management Platform
</p>
