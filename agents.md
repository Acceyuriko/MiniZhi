# MiniZhi 项目记忆

## 项目定位（一句话）

个人本机使用的轻量知乎阅读器（网页版），解决知乎网页版卡顿问题：只读浏览
推荐流 / 热榜 / 问题页 / 评论，Node.js 单进程服务 + 零构建原生前端，数据全部
走知乎网页 API（www.zhihu.com）。

## 运行环境（Windows）

- Windows 11 + PowerShell 7（`pwsh`）。
- 已安装 Microsoft.Coreutils，可正常使用大部分 bash 工具；**不要使用 git bash**。
- pwsh 习惯：
  - 路径统一用正斜杠 `/`，如 `C:/Users/<用户名>/Documents/git/MiniZhi/...`，不要用反斜杠；
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
- **仓库**：MiniZhi 托管在 GitHub（`Acceyuriko/MiniZhi`，**公开仓库**，用户确认有意
  公开）；`zhihu-plus-plus/`（参考项目 clone）与运行数据目录均已 gitignore；提交用
  Conventional Commits，可以直接 `git push`（上游 `origin/main` 已设好）。
  **既然公开，别把个人信息写进仓库**（用户名、账号名、本机绝对路径一律用占位符）。
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
- **答案正文获取（2026-09-14 再实测，口径已变，重点！）**：
  - **知乎内容页 SSR 全部 403 了**：`/question/{qid}`、`/answer/{id}`、
    `zhuanlan.zhihu.com/p/{id}` 一律返回 403 + 628 字节的 **zse-ck 反爬挑战页**
    （`<meta id="zh-zse-ck">` + `static.zhihu.com/zse-ck/v4/*.js`，要在浏览器里跑
    JS 才给 cookie）。带不带 cookie、补不补 `sec-fetch-*`/`accept-encoding` 全试过，
    都 403；首页 `/` 和 `/hot` 仍 200。→ **Node 侧再也抓不到问题页 HTML，
    依赖 SSR initialData 的方案作废**（server/lib/zhihu.js 的 `plainGetText` 因此
    已无人调用，留着只为将来有办法过 zse-ck 时复用）。
  - **改用 answers 端点（现在完全可用）**：
    `GET /api/v4/questions/{qid}/answers?limit=N&include=<长 include>` → 200，
    返回带**完整正文**的回答（`content`）+ 每条内嵌 `question` 字段；分页是
    **offset**（`paging.next` 里 `offset=5`），实测稳定可续页；`limit` 生效。
  - **该端点不认 order 参数**：`order=default/updated/created` 返回顺序完全相同
    （都回落知乎默认的“热度”口径），所以“时间排序”仍必须用
    `feeds?limit=N&order=updated&include=<长 include>`（实测严格按 updated_time
    倒序）；feeds 分页是 **cursor**，两者 next 口径不同，续页代码不要混。
  - 旧式 `/api/v4/answers/{id}?include=...` **现在也能用了**（实测 200 且带正文）；
    问题详情 `/api/v4/questions/{qid}` 只给 title/id/created，
    **不给 answer_count/follower_count**（`include=*` 反而 400）→ 问题页头部的
    “N 个回答 / N 关注”计数目前无来源，界面直接不显示。
  - 旧式 offset feeds `paging.next` 的 `zhihu.com//api/` **双斜杠怪癖**依旧存在，
    使用前必须清洗；snake_case 回答 content 字段与正文同在 target 上。
- **排序语义实测**：问题 feeds `order=updated` → 按 updated_time 严格倒序（可作
  “时间”排序），cursor 续页时 next 自带 order；`order=created` 返回乱序（疑似回落
  默认，不可用）；默认=热度（现在由 answers 端点提供）。
- **评论**：`/api/v4/comment_v5/answers/{aid}/root_comment?order_by=default` 与
  `/comment/{cid}/child_comment` 均可用；评论精确 id 从 comment.url 提取
  （**注意 url 两种形态：`/comment/{id}` 与 `/comments/{id}`**，字段也时有时无，
  → 前端兜底逻辑：url 正则 || comment.id 字符串字段）。
- **IP 属地（2026-09 实测，已实现）**：两条完全不同的路子。
  1. **回答**：接口默认不给，必须在 include 里加 `ip_info`（实测清单尾部追加
     `,ip_info` 与 `data[*].ip_info` 等效）；answers（热度）与 feeds（时间）两个
     端点都认，值形如 `"IP 属地河南"`（已含前缀）。零额外请求。
  2. **评论**：`comment_tag` 数组里本来就有，形如
     `{type:'ip_info', text:'广东', color:'#999999'}`，text 只是省名（也出现过
     “老挝”这种境外）→ 显示时自己补「IP 属地」前缀。子评论同样带。零额外请求。
  3. **推荐流 / 热榜拿不到**：recommend 端点无论怎么加 include（`data[*].ip_info`、
     `data[*].target.ip_info`）都不返回 ip_info；热榜 target 是问题，本来也没有。
     要显示只能逐条再请求详情，每条多 1 次请求（受 1s 串行限速），用户明确选了
     「不做推荐流」。
  实现：`server/lib/question.js` 的 INCLUDE + normalizeAnswer 的 `ipInfo`；
  `public/js/ui.js` 的 `authorBlock(author, ip)` → `.author-ip`（muted 13px）；
  `public/js/comments.js` 从 comment_tag 取。注意**卡片没数据就什么都不显示**
  （推荐流卡片因此看不到 IP，属预期，不是 bug）。
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
- **评论图片（2026-09 实测）**：评论里的图**不是 `<img>`**，而是
  `<a class="comment_img" href="真图地址" data-width data-height>查看图片</a>`
  （同构变体还有 `comment_gif`、`comment_sticker`；后两者线上样本很罕见，
  只抓到 comment_img）。只按原文渲染的话，评论里就只剩「查看图片」四个字。
  处理（render.js）：把 `<a>` 留下、内容换成 `<img>` + `.comment-media-label`
  文字；默认 `.is-open` 展开显示图片，**点一下折叠回「查看图片」文字**
  （评论里常见 640×3650 的整屏长截图，不想看时可收起；实测折叠 3667px → 29px）。
  图片走 `/media` 代理；`data-width/height` 是小数要取整（206.8148…）并设
  aspect-ratio 防跳动；`href` 保留原图直链（中键/右键仍可开原图）。
  注意 `.content-body a` 自带下划线，包裹图片的链接要单独去掉。
  **验证坑**：`loading="lazy"` 会让未滚到视口的图 `naturalWidth` 为 0，
  别据此判定「图片加载失败」——先 scrollIntoView 再验。
- **视频站内播放（2026-09 端到端跑通，一次修了三个坑）**：POST
  /api/v4/video/play_info?r={videoId} + JSON body {content_id,content_type_str,
  video_id,scene_code:'answer_detail_web',is_only_video:true} + 头
  x-app-za:OS=webplayer（照 plus-plus）→ 返回 video_play.playlist.mp4[]（含
  480P/720P，选 bitrate 最大）。实测 61 秒 / 1280×756 视频在页面里正常播放
  （readyState 4、进度推进）。三个坑：
  1. **正文里的视频卡片有两种形态**：`.zvideo` 和 **`a.video-box`**（用户实际
     遇到的是后者，之前只匹配 .zvideo → 没被当视频处理，只当普通外链）。
     video-box 的陷阱：`href` 是 `https://link.zhihu.com/?target=...` 中转链接，
     点出去会 301 到 `video.zhihu.com/video/{id}?$args`，那个页面在浏览器里打不开
     （`?$args` 是知乎自己 Nginx 变量没展开）；而且 **`data-video-id` /
     `data-video-playable` / `data-name` 都是空串**，真正的 id 在
     **`data-lens-id`** 和 href/文本里的 `/video/{id}`。封面用 `data-poster`
     （原始地址）——注意 `<img>` 的 src 已被图片流程换成 `/media?url=...`，
     别再 api.mediaUrl 包一层（会双重代理）。
  2. **`/media` 代理的流式分支从来没工作过**（本次修）：`fetch()` 返回的
     `res.body` 是 web ReadableStream，**没有 `.pipe()`**；index.js 里
     `r.stream.pipe(res)` 抛错时响应头已发出，catch 里 `if (!res.headersSent)`
     不再补救 → 连接永远不结束，客户端**卡死到超时**（实测 180s 无响应）。
     修法：proxy.js 里 `Readable.fromWeb(res.body)` 后再交出去。图片走 buffer
     分支所以一直没暴露，只有视频（mp4/m3u8/ts）走这条。
  3. **媒体白名单要按后缀放行 `.vzuu.com`**：知乎视频 CDN 用编号域名轮换，
     play_info 实测返回 `vdn3.vzuu.com`，而白名单里只写了 `vdn.vzuu.com`
     → 403 forbidden host。
  另：代理目前不转发 Range（返回 200 + chunked，不返回 206），实测能正常播放，
  但拖动进度条的 seek 行为未验证。
  接线：render.js 把 video-box/zvideo 换成 `.zvideo-holder`（封面 + ▶ 按钮），
  点击 → onVideo 回调 → video.js 的 playVideoIn。`onVideo` 由 ui.js 的
  answerCard 提供，覆盖推荐流/问题页/文章页的作者卡片；**content.js 的文章正文
  原先没传 onVideo**（改了会变成点不动的播放按钮），本次一并接上。
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
  **坑（2026-09 修）**：`api.zh()` 的 url 必须是完整 `https://www.zhihu.com/...`，
  写成相对路径 `/api/v4/...` 会被白名单判 400「只允许代理知乎白名单 API」，
  而 `reportUninterested` 把异常 catch 成 `{sent:false}` → **功能静默失效**
  （discard.js 从诞生起就写错了，只做了本地隐藏）。现已两头堵：
  ① discard.js 改用完整 URL；② 服务端白名单同时接受站内相对路径
  （host 由我们自己补，不可能指向别的站点），双斜杠 `//api` 怪癖也仍归一化。
  失败提示也改成「上报失败，本次仅本地隐藏」，不再误报成「请检查登录」。
- **会话实测**：粘贴 cookie + 签名请求已打通（已用真实账号验证）。
- **已读上报（解决「推荐流反复推同一条」）实测**：两个端点，均已用真实会话打通
  （我们签名链路能直接过，无需 x-zst-81）：
  1. `POST /lastread/touch` —— 曝光/已读。**multipart/form-data**，字段 `items` 是
     JSON 数组 `[["answer","<id>","touch"],["post","<文章id>","touch"]]`，动词
     `touch`（曝光）/`read`（已读）；返回 `201 {"success":true}`（我们走桥拿 200）。
     注意：**网页版把「文章」报成 `post`**（该 id 经 /api/v4/articles 确认
     `type:"article"`），不是 `article`。
  2. `POST /api/v4/read_history/add` —— 打开内容（进浏览历史）。JSON
     `{"content_token":"<id>","content_type":"question|answer|article|pin"}` → `200 null`。
     网页版打开问题页发的就是它（zhihu-plus-plus 点开内容则用 /lastread/touch + "read"）。
  实现：`public/js/readreport.js` —— 只报「真正显示给用户的那一条」（不报仅加载进
  内存的），同一内容每次会话只报一次；曝光立即入队、**停留 15 秒**才算已读；队列攒
  4 秒合并成一个请求；失败静默。推荐流/问题页回答走「曝光→停留→已读」，问题页与
  文章页打开即报已读（照网页版口径），**点开评论也算已读**（在 comments.js 的
  openComments 里报，收起不算——report 放在「确认要展开」之后）。实测链路：翻页后
  先发 `touch`，停够时长后发 `read` + `read_history/add`（两者会合并进同一批
  multipart）；点开评论则 `touch`+`read` 合并在同一批里发出。
  服务端白名单相应新增 `/lastread/`、`/api/v4/read_history/`、`/unify-consumption/`。
  （浏览历史读回需要 api.zhihu.com 主机，桥只放行 www，暂未接入验证。）
- 参考实现对拍工程在 `.scratch/zse-vec`（cargo path 依赖 rs-zse-sign），向量文件
  `.scratch/zse-vectors.txt`；探测脚本 `.scratch/probe*.mjs`，样本存
  `.scratch/samples/`。均 gitignore。

## 明确不做（一期及以后暂缓）

搜索、关注页、消息、互动（赞同/评论/创作）、话题页、盐选内容过滤、跨设备部署。
