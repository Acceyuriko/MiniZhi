# MiniZhi 项目记忆

## 项目定位（一句话）

个人本机使用的轻量知乎阅读器（网页版），解决知乎网页版卡顿问题：只读浏览
推荐流 / 热榜 / 问题页 / 评论，Node.js 单进程服务 + 零构建原生前端，数据全部
走知乎网页 API（www.zhihu.com）。

## 运行环境（Windows）

- Windows 11 + PowerShell 7（`pwsh`）。
- 已安装 Microsoft.Coreutils，可正常使用大部分 bash 工具；**不要使用 git bash**。
- pwsh 习惯：
  - 路径统一用正斜杠 `/`，如 `C:/Users/zec_i/Documents/git/MiniZhi/...`，不要用反斜杠；
  - 字符串参数用单引号 `'...'`，避免转义问题。
- 本机已装：Node v24、Python 3.13、git（GitHub 直连可达，无需代理；origin 走 SSH）。

## 沟通风格

- **大白话优先**：向用户解释研究 / 方案 / 结论时，默认写成高中议论文式的平实
  中文——先结论、后理由、再细节，避免术语堆砌。

## 关键设计决策（与用户 grilling 达成的共识）

- **范围**：纯只读 + 可查看评论；单机 localhost 使用；一期不做互动/创作/搜索/扫码
  （扫码登录为二期，与粘贴 session 共用同一套 cookie 存储）。
- **登录**：一期粘贴浏览器 session cookie（本地文件存储，`/api/v4/me` 校验显示昵称，
  401/403 全局提示重新粘贴，不自动重试）。
- **数据源**：全走网页 API（www.zhihu.com）；粘贴的网页 cookie 与网页 API 同源。
  所有请求附加 `x-zse-93` / `x-zse-96` 签名（自研实现，与 zhihu-plus-plus 参考
  实现**对拍验证**，不复制其 AGPL-3.0 代码）。
- **风控预算**：请求串行化、翻页间隔 ≥1s、只手动刷新、无轮询。
- **推荐流**：展示除广告外的全部类型（回答/文章/想法/视频）；单条大卡片；
  会话级列表记忆（切页返回不丢位置）；尾部自动续页；上一个/下一个 + `←`/`→` 键；
  回答卡片的问题标题可点击进入问题页。
- **热榜**：全站热榜 50 条，手动刷新；点击问题进问题页，从头展示。
- **问题页**（独立路由，含排序参数）：热度 = 知乎默认排序；时间 = 回答时间排序
  （order 参数实现期以真实 session 实测选定并如实汇报）。单回答展示 + 上一个/下一个。
  从推荐进入时定位来源回答（定位上限 5 页，失败回退从头）；排序切换重置列表。
- **详情阅读**：文章/想法站内阅读（复用正文渲染）；视频经 `play_info` 取地址，
  mp4 原生 `<video>`、m3u8 本地 hls.js，失败给外链。
- **评论**：一级评论列表（默认排序）+ 点开楼中楼，只读；排序切换二期再加。
- **链接**：正文中知乎问题/回答/文章链接转站内路由，其余外链新标签打开。
- **资源代理**：图片/视频流经本地后端代理（补 Referer + cookie），**内存 LRU 缓存，
  不落盘**（浏览器自身 HTTP 缓存负责常规磁盘缓存）。
- **技术栈**：Node.js（`node:http` 起步、极简依赖）+ 原生 HTML/CSS/JS 前端，
  零构建；包管理 pnpm。
- **前端样式（v2，用户指定 tailwind）**：Tailwind v4 运行时版已 vendor 本地化
  （`public/vendor/tailwind.browser.js` + LICENSE，离线可用，零构建保持）；
  视觉资产分两层——组件层（`.card/.btn/.hot-list/…`）用 style.css 手写 CSS 变量
  体系（glass 顶栏、大圆角、柔和阴影、明暗双主题），布局/间距用 Tailwind
  utility。注意：style.css 是 unlayered 样式，优先级高于 tailwind 的 layer，
  两者别在同一元素上写同一属性。
- **UI**：单页应用，顶部 Tab（推荐/热榜）；单栏阅读，内容区最宽约 1000px 居中
  （用户屏幕 1920 宽，宽度留配置可调）；亮/暗主题跟随系统。
- **仓库**：MiniZhi 为私有仓库；`zhihu-plus-plus/`（参考项目 clone）与运行数据
  目录均已 gitignore；提交用 Conventional Commits，不推送。
- **服务常驻 / 开机自启**：`scripts/minizhi-serve.cmd` 是守护循环
  （cd 到项目 → `node server/index.js` → 退出后隔 3 秒重启，日志追加
  `data/server.log`）；`%APPDATA%\Microsoft\Windows\Start Menu\Programs\
  Startup\MiniZhi.vbs` 以隐藏窗口调用它 → 开机自启 + 崩溃自愈（实测杀进程后
  3 秒自动恢复）。**别再拿 agent 会话的后台任务（background job）当常驻服务**：
  会话一断进程即被回收（曾导致"服务挂了"）。

## 实测经验（2026 年实弹验证，务必遵守）

- **签名可用**：自研 x-zse-96 已通过 Rust 参考实现对拍（5/5），并被知乎真实
  服务器接受（`/api/v4/me` 正常返回）。实测 **full（含 query）与 path（纯路径）
  两种签名口径都能过**（服务端实际按 pathname 校验），session.signMode 保持
  `'full'`（与参考实现一致）。
- **HTML 页面请求绝不带签名头**（带了反而 404）；只有 /api/ 请求需要签名。
- **雪花 id 精度陷阱**：知乎问题/回答/文章 id 是 19 位量级（> 2^53）。JSON 里的
  数字字段**本身可能已被知乎后端舍入**（实测热榜 `target.id` 与其 `url` 里嵌的
  id 不一致，按 target.id 请求会 404！）。因此：
  1. 解析一律用 `parseZhihuJson`（把 ≥16 位整数字面量保精度转成字符串）；
  2. **取 id 优先从 `url` 字符串提取**（`/question/(\d+)`、`/answer/(\d+)`），
     不信任纯数字 id 字段。
- **答案正文获取（2026 新版知乎已重构，重点！）**：
  - 旧式 `/api/v4/answers/{id}?include=...`、`/feeds?include=...`（offset 分页）
    **已废弃**：任何 include 参数 → HTML 404；无 include 的回答详情不含正文。
  - 列表端点（如 members/*/answers）仍支持 include；热榜/推荐流自带正文。
  - **问题页正文走 SSR**：GET `https://www.zhihu.com/question/{qid}`（纯净浏览器
    头 + cookie，**无签名**）→ 取 `<script id="js-initialData" type="text/json">`
    → `initialState.question.answers.{qid}`：`ids`（有序回答引用+cursor）、
    `next`（下一页完整 URL：**cursor 参数 + `data[*].xxx` 长 include**，已被验证
    返回带正文回答）、`sessionId`；`initialState.entities.answers`（正文等）、
    `entities.questions`（标题/计数）。回答实体字段为 **camelCase**，API 返回为
    **snake_case**。
  - feeds cursor 翻页 URL 的 `paging.next` 有 `zhihu.com//api/` **双斜杠怪癖**，
    使用前必须清洗；snake_case 回答 content 字段与正文同在 target 上。
- **排序语义实测**：问题 feeds `order=updated` → 按 updated_time 严格倒序（可作
  “时间”排序）；`order=created` 返回乱序（疑似回落默认，不可用）；默认=热度。
- **评论**：`/api/v4/comment_v5/answers/{aid}/root_comment?order_by=default` 与
  `/comment/{cid}/child_comment` 均可用；评论精确 id 从 comment.url 提取
  （**注意 url 两种形态：`/comment/{id}` 与 `/comments/{id}`**，字段也时有时无，
  → 前端兜底逻辑：url 正则 || comment.id 字符串字段）。
- **字段稳定性坑（2026-09 实测）**：知乎接口的 `url` 字段**时有时无**（热榜条目
  的 target.url、根评论的 url 都遇到过缺失/变体）→ 前端一律「url 正则提取 ||
  id 兜底」，id 靠 parseZhihuJson 保精度字符串化后可直接用。
- **正文图片两个坑（2026-09 实测，问题页 SSR 复现）**：
  1. **懒加载占位**：`src` 是透明 `data:image/svg+xml`（只为按原图尺寸撑高度，
     实测撑出 903×2690 的大片空白），真地址在 `data-actualsrc` / `data-original`。
     取图优先级：src（非 data: 占位）→ data-actualsrc → data-original → data-src
     → data-original-src；一个都没有就**删掉该 img**，别留透明块。
     图片域名除 pic1-4 还有 **picx / pica / picb / picc**，正则漏了会直连（可能被
     防盗链拦）→ 一律按 `*.zhimg.com` 交给本地 /media 代理（代理白名单兜底）。
  2. **SSR 同一图位有两个 `<img>`**：`<noscript>` 里的 no-JS 回退图 + 懒加载占位图。
     `DOMParser`（脚本关闭）会把 noscript 子节点解析成**真元素**，塞回带脚本文档后
     noscript 又变 display:none → 必须先**展开 noscript**（子节点搬到父节点再删
     noscript），再按 URL 里的 `v2-<32hex>` token 去重，否则同一张图显示两遍。
     实测：12 张图的回答去重后 8 张，滚动后全部经代理正常加载（图片代理不受 API
     的 1s 串行限速；`loading="lazy"` 只在滚到视口才请求，属正常现象）。
- **play_info 通道已验证**：POST /api/v4/video/play_info?r={videoId} + JSON body
  {content_id,content_type_str,video_id,scene_code:'answer_detail_web',
  is_only_video:true} + 头 x-app-za:OS=webplayer（照 plus-plus）→ 知乎正常受理
  （假 id 返回业务错 VideoIDErrorException 而非 403，通道 OK）。真实视频样本在
  本会话推荐流/热榜首屏均未出现（12 页推荐全 answer），待用户遇到带视频内容时
  实测 mp4/m3u8 播放。
- **推荐流反馈（不感兴趣）实测**：POST /api/v4/zrec-feedback/uninterested，
  表单 body scene_code=RECOMMEND&content_type={2=回答|1=文章}&content_token={内容
  id}&uninterested_type={less_similar=该内容|author=该作者}&feed_deliver_type=
  Normal&desktop=true；返回 {"success":true}（埋点式，假 token 也 success，无
  法据响应分辨语义）；**无需 x-zst-81 头**（浏览器抓包带它，我们的签名引擎不带
  也直通）；实现上**屏蔽以知乎 API 为准、本地不落盘**：点一次即上报知乎，
  本模块只在会话内存里记一份已忽略的内容/作者，用于立刻隐藏与本次会话过滤，
  刷新页面即清空（public/js/discard.js）。推荐流与问题页共用同一套
  applyDiscard/过滤逻辑（问题页需要 service 端 normalizeAnswer 带 author.id，
  否则跨页作者 key 对不上）。
- **会话实测**：粘贴 cookie + 签名请求已打通（账号 Acceyuriko）。
- 参考实现对拍工程在 `.scratch/zse-vec`（cargo path 依赖 rs-zse-sign），向量文件
  `.scratch/zse-vectors.txt`；探测脚本 `.scratch/probe*.mjs`，样本存
  `.scratch/samples/`。均 gitignore。

## 明确不做（一期及以后暂缓）

搜索、关注页、消息、互动（赞同/评论/创作）、话题页、盐选内容过滤、跨设备部署。
