# DST DMP Android

Don't Starve Together · DMP Android 管理客户端

面向 Android 手机和平板的 DST Management Platform 第三方客户端（非官方 Android 适配）。

当前测试版本：`v3.06.201705` · 包名：`cn.xiaojie_gjs.dmp`

## 项目介绍

本项目用于在 Android 设备上连接 DST Management Platform（DMP）服务端，并针对 Android WebView、触摸操作以及移动端使用环境进行适配。APK 内置经过 Android 适配的 DMP Web 前端资源，可直接从 APK 本地加载相关页面资源。

## 项目结构

主要 Android 代码和 Web 前端资源位于：

```text
app/src/main/
├── java/cn/xiaojie_gjs/dmp/ui/dmp/
└── assets/dmp_web/
```

Android 原生部分包含 `DmpActivity`、`DmpWebActivity`、`DmpApiClient`、`DmpJavascriptBridge` 等；Web 前端位于 `app/src/main/assets/dmp_web/`。

## 上游项目与许可

本项目使用、适配或兼容以下 MIT 开源项目：

- [DST Management Platform API](https://github.com/miracleEverywhere/dst-management-platform-api) · Copyright (c) 2024 Miracle
- [DST Management Platform Desktop](https://github.com/miracleEverywhere/dst-management-platform-desktop) · Copyright (c) 2025 Miracle

对应许可证副本保存在 `LICENSES/`，第三方说明见 `THIRD_PARTY_NOTICES.md`。本项目为非官方第三方 Android 适配，与上游作者及 Klei Entertainment 不存在官方隶属、赞助或背书关系。

## 构建

Windows：

```powershell
.\gradlew.bat :app:assembleDebug
```

Linux / macOS：

```bash
./gradlew :app:assembleDebug
```

Debug APK 默认生成在 `app/build/outputs/apk/debug/`。构建产物、APK 解包目录和本地测试截图不纳入源码仓库；如需发布 APK，请作为 GitHub Release 附件单独上传。

## 连接 DMP

客户端需要连接用户自行部署或有权使用的 DMP 服务端。实际地址、端口和认证方式以服务端配置为准；公网访问建议使用 HTTPS。

Debug 构建仍兼容用户配置的 HTTP DMP 地址，以适配旧部署；发布构建要求 HTTPS。HTTP 会以明文传输管理令牌，可能被同一网络中的攻击者截获；涉及真实服务器时请优先启用 HTTPS。WebView 内置页面只从 APK 的 `appassets.androidplatform.net` 安全来源加载，外部链接会交给系统浏览器打开。

## 安全提醒

请勿将真实的服务器认证信息提交到公开仓库，包括 DMP 管理密码、API Token、Cookie、Session、SSH 密码、SSH 私钥、服务器配置或其他敏感凭据。发布目录不包含本机 `local.properties`、Gradle 构建缓存或签名私钥。

应用需要在设备本地保存服务器令牌才能提供免重复登录的管理功能。令牌由 Android 应用沙盒和 WebView 本地存储保护；已 root、调试或被恶意备份的设备仍可能读取它。请不要在共享设备上保存高权限令牌，并在服务器侧定期轮换令牌。

更完整的威胁模型、已知限制和发布前检查见 [`SECURITY.md`](SECURITY.md)。
