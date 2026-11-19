# 安全与隐私说明

## 数据范围

本应用没有内置遥测、广告或第三方账号登录功能。用户输入的 DMP 地址、端口、备注和管理令牌用于连接用户选择的服务端；服务器返回的房间、玩家、日志、备份及模组数据只用于显示或执行用户请求。服务器令牌会保存在应用的本地配置和 WebView 会话中，以支持后续请求。

## 已采取的防护

- Web 页面通过 `WebViewAssetLoader` 从 `https://appassets.androidplatform.net` 加载；不再允许页面访问任意 `file://` 文件或跨文件源读取。
- JavaScript bridge 只挂载给内置页面；非内置页面不会留在该 WebView 中运行。
- 下载请求只有在 URL 与当前 DMP 的协议、主机和端口完全一致时才附加 `X-DMP-TOKEN`。外部下载不会收到 DMP 令牌。
- 原生 API 和静态版本探测不自动跟随 HTTP 重定向，避免令牌被重定向到其他主机。
- 服务器卡片、APK、截图和 UI dump 等本地测试工件已加入忽略规则，不应作为源码提交。

## 已知限制

- Debug 构建为兼容旧 DMP 部署仍允许用户配置 HTTP 地址；HTTP 会明文传输令牌，不适合公网或不可信网络。发布构建已关闭明文流量和 mixed content，生产环境应使用 HTTPS。
- 服务器令牌目前保存在普通 Android 私有存储/会话中，而不是 Android Keystore 加密数据库。普通应用之间不可直接读取，但 root、调试、恶意备份或受控设备环境可能读取。高权限令牌应限制生命周期并定期轮换。
- `getBootstrap()` 必须向内置 DMP 前端提供当前令牌才能调用 API；因此不得把远程页面、未经审查的脚本或外部资源注入 WebView。修改导航策略时必须保持 appassets 来源限制。
- APK 中包含上游 DMP Web bundle 及其第三方依赖，上传前应保留上游许可证和第三方声明，并复核依赖版本。

## GitHub 发布前检查

1. 使用全新 checkout/目录初始化 Git，不要把当前设备的服务器配置、`local.properties`、截图、UI XML、APK、反编译目录或构建缓存加入首个提交。
2. 检查 `git diff --cached` 和 `git grep`，确认没有真实 IP、域名、令牌、Cookie、密码、私钥或服务器备份文件。
3. 不要提交 `keystore.properties`、`.jks`、`.keystore` 或任何签名私钥；发布 APK 应作为 GitHub Release 附件并使用私有签名。
4. 公开发布前在至少一个 HTTPS DMP 服务端上验证登录、房间读取、日志/备份下载和外部链接行为。

若发现可复现的安全问题，请不要公开粘贴令牌或服务器地址；先通过私下渠道联系项目维护者，并提供最小化复现步骤。
