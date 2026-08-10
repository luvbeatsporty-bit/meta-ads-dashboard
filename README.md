# Meta Ads Intelligence 数据看板

一个纯前端的 B 端 Meta 广告数据分析看板。它使用原生 HTML、CSS 和 JavaScript ES Module，不需要 React、Vue 或构建工具。

## 1. 项目是什么

看板支持导入 Meta Ads Manager 导出的 CSV / XLSX 广告报表，并在浏览器本地计算 KPI、国家表现、Campaign 排名、风险诊断和 Lead 质量。当前项目不连接广告平台 API，数据不会自动从 Meta 拉取。

## 2. 本地项目路径

```text
/Users/wangxiran/Documents/数据看板
```

## 3. 本地如何启动

在终端执行：

```bash
cd "/Users/wangxiran/Documents/数据看板"
python3 -m http.server 4173
```

然后访问：`http://localhost:4173/`。

不要直接双击 `index.html`，因为 ES Module 在 `file://` 下可能被浏览器跨域策略拦截。

如果 4173 已被占用，可以使用其他端口，例如：

```bash
python3 -m http.server 8765
```

## 4. 数据在哪里

正式项目不把广告数据写死在网页代码中。数据通过页面导入：

- 广告报表：CSV / XLSX；
- Lead / CRM 文件：CSV / XLSX；
- 当前浏览器使用 IndexedDB 保存大数据，部分设置和人工处理状态使用 localStorage。

导入数据只保存在当前浏览器，不会自动同步给其他访问者，也不会自动上传服务器。

## 5. 如何更新广告数据

1. 在 Meta Ads Manager 导出新的广告报表；
2. 打开网站，导入 `.csv` 或 `.xlsx`；
3. 如需 Lead 质量，进入“Lead 质量”并导入 CRM Lead 文件；
4. 检查日期、国家、花费、Lead、CPL、CTR 和风险诊断；
5. 使用筛选器检查重点国家和 Campaign。

推荐广告报表至少包含：国家/地区、Campaign、Ad Set、Ad、花费、成效或 Lead、展示、链接点击、报告起止日期。

## 6. 如何修改网页

常用文件：

- `index.html`：页面结构和文案；
- `styles.css`：视觉样式和响应式布局；
- `app.js`：页面状态、筛选、导入和交互；
- `charts.js`：图表渲染；
- `metrics.js`：指标汇总；
- `diagnosis.js`：风险诊断规则；
- `data-model.js`：字段识别和数据模型；
- `excel-import.js`：广告文件读取；
- `lead-import.js`：Lead 文件读取与匹配；
- `storage.js`：浏览器本地保存；
- `export.js`：CSV 导出。

项目没有构建步骤，修改后刷新浏览器即可看到效果。

## 7. 如何测试

先启动本地服务器，然后检查：

1. 首页能打开且无空白；
2. 点击“加载演示数据”；
3. KPI、趋势图、国家和 Campaign 模块出现数据；
4. 切换国家、Campaign 和搜索条件；
5. 导入真实 CSV / XLSX；
6. 导入 Lead 文件并检查匹配；
7. 测试风险筛选、列表展开/收起、图表展开/收起和 CSV 导出。

代码检查（如本机有 Node.js）：

```bash
node --check app.js
node --check charts.js
node --check data-model.js
node --check diagnosis.js
node --check excel-import.js
node --check lead-import.js
node --check metrics.js
node --check settings.js
node --check storage.js
```

## 8. 如何提交 Git

```bash
git status
git add .
git commit -m "说明本次修改"
git push
```

不要提交公司的广告数据、Lead 文件、`.env`、`.netlify/` 或系统缓存文件。

## 9. 如何部署

正式部署方式是：

```text
本地 Git 仓库 → GitHub 仓库 → 固定 Netlify Site → 固定网站地址
```

连接完成后，每次 `git push` 到已连接分支，Netlify 会在同一个 Site 上重新部署，不会创建新 Site。

如需先手动测试部署，可在项目目录运行：

```bash
netlify deploy --dir .
```

正式发布使用：

```bash
netlify deploy --prod --dir .
```

## 10. Netlify Site 是哪个

当前目录残留的 `.netlify/state.json` 指向过去的临时匿名站点 ID：

```text
32a99266-d0a0-4615-ad95-15c73a193b66
```

它不代表已经完成长期账号绑定。本次正式部署需要在你的 Netlify 账号下创建或选择一个 Site，并连接 GitHub 仓库。建议 Site Name：

```text
meta-ads-intelligence-dashboard
```

如果名称已被占用，可尝试：

- `b2b-meta-ads-dashboard`
- `ads-performance-intelligence`
- `meta-campaign-insights`

## 11. 正式网站 URL 是什么

在 Netlify Site 创建并绑定后，Netlify 会生成固定地址：

```text
https://你的-site-name.netlify.app
```

当前还没有账号绑定后的正式 URL。过去的匿名 Drop 地址不作为正式地址使用。

## 12. 为什么以后更新网站 URL 不会改变

Netlify 的 URL 属于 Site，而不是某一次部署。只要以后继续向同一个 GitHub 仓库和同一个 Netlify Site 部署，网页内容可以更新，但 Site URL 保持不变。绑定自有域名后，域名也继续指向同一个 Site。

## 13. 哪些文件不能随便删除

不能随便删除：

- `index.html`；
- `styles.css`；
- `app.js`；
- `charts.js`；
- `data-model.js`；
- `metrics.js`；
- `diagnosis.js`；
- `excel-import.js`；
- `lead-import.js`；
- `storage.js`；
- `export.js`。

`legacy-index.html` 是旧版备份，暂时保留，不参与首页加载。

## 14. 如果网站打不开应该先检查什么

1. Netlify Deploys 是否为 Published；
2. 最新部署日志是否报错；
3. `index.html` 是否仍在 publish directory 根目录；
4. 浏览器控制台是否有 JS 模块路径错误；
5. Git push 是否推到了 Netlify 连接的分支；
6. 是否误删了上述核心文件；
7. 是否只是浏览器缓存，尝试强制刷新。

## 15. 如何回滚到上一个正常版本

在 Git 中查看提交：

```bash
git log --oneline
```

恢复到指定版本并推送：

```bash
git revert <commit-id>
git push
```

推荐使用 `git revert`，它会保留历史。也可以在 Netlify 控制台的 Deploys 页面选择上一个成功部署并执行“Publish deploy”，无需改变网站 URL。

## 安全说明

当前项目是纯前端应用，没有真正的登录保护。任何发布到公网的 HTML、CSS、JavaScript 都可以被访问者下载和检查；前端写入的密码不能防止数据被读取。

如果看板包含公司广告花费、Lead 或其他内部数据，建议使用 Netlify 的访问控制能力（例如团队权限、受保护部署或第三方身份认证）并把真实数据放在登录后的后端服务中。不要把 API Token、Secret、真实密码或公司原始数据提交到前端代码或 GitHub。启用真正访问控制前，应先确认 Netlify 方案、账号权限和可能的费用。
