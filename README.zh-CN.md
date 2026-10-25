# pwa-identity-diff

在发布 PWA 更新之前，对比两个版本的 Web App Manifest 实际身份和导航范围。
适用于改变启动地址、部署目录或域名时，提前发现应用被识别成另一个应用的风险。

需要 Node.js 20+，无第三方运行依赖，无网络请求。克隆后可直接运行：

```sh
node bin/cli.js examples/before.json examples/after-breaking.json --urls examples/urls.json
node bin/cli.js examples/before.json examples/after-preserved.json --urls examples/urls.json --json
```

第一条故意返回 1，表示身份改变且一个给定页面离开导航范围；第二条返回 0。
每份快照包含 `manifest`、`manifest_url`、`document_url`，后两个字段为真实部署 URL。
`--urls` 接收绝对 HTTP(S) URL 数组。默认在身份改变或给定 URL 离开范围时返回 1；
格式错误返回 2。`--fail-on any` 可将所有有效 URL 变化作为失败。

工具正确区分 ID 的源站基址、启动地址的清单基址、无效字段回退、查询参数与片段。
它不安装或迁移应用，不预测浏览器更新策略，不检查服务工作线程或服务器响应。
默认策略不会仅因范围缩小而失败，需要给出关键页面作为验证证据。
仅支持无账号密码的 HTTP(S) 上下文；每个文件最多 1 MiB，最多 10,000 个导航 URL。

测试：`npm test`，语法检查：`npm run check`。直接使用时删除克隆即可清理；
若执行过 `npm install --global .`，通过 `npm uninstall --global pwa-identity-diff` 卸载。
完整格式、原理和限制见英文 README。
