# 打卡

一个打卡应用：自己编辑每天要做的事，做完所有任务就算完成当天打卡，
可以看到本周记录和连续打卡天数。

前后端都在这个仓库里 —— 前端 React，后端是 EdgeOne 边缘函数 + KV 存储，
部署在腾讯云 EdgeOne Pages（免备案、国内可直连）。

## 功能

- 任务就是一行字（如「跑步 800 米」），可随时增删改
- 任务分两种：**每天都要做**、**只做一次**（一次性任务完成后不再出现）
- 当天所有任务都打勾，才算完成当天打卡
- 本周 7 天的印记 + 当前连续 / 最长连续
- 每人一个账号，各记各的，互相看不到
- 不允许补卡：漏了就是漏了

## 界面为什么长这样

整个应用想要的感觉是一本**集章本**，而不是一块干净的面板。

- **完成不是一块色块，是一枚盖下去的章。** 边缘用 `feTurbulence` + `feDisplacementMap`
  揉歪（见 `src/components/StampDefs.tsx`），再用第二层噪声调制墨色浓淡，
  所以每一枚章都是不规则的、和别的不一样 —— 平面色块是 AI 最容易生成的形状，
  不完美恰恰是它最不会做的。
- **没盖过的日子是真的空着**，不画底、不描边。于是漏掉的一天在印记之间
  就是一个空缺，连续与否一眼可见，不需要图例。
- **红色只出现在真正盖下的章上。** 今天还没盖时是一个灰色的空位，不是淡红色 ——
  这样整页的红色就只有一种含义：你做到了。
- **部分完成**是墨从底部升到相应高度，而且那条墨线本身也被滤镜揉过，是粗糙的。
- **纸张颗粒**：`body::before` 铺了一层极淡的噪声，把纯色矢量面变成纸面。
- 字体全部走系统栈，不引 webfont：中文 webfont 动辄几 MB，
  Google Fonts 在中国大陆也加载不了。

### 功能之外的设计取舍

- 任务不再拆成「名称 + 内容」两栏。打卡场景下拆开只是多一次输入，
  「运动 / 跑步 800 米」和「跑步 800 米」记的是同一件事。
- 没有卡片、没有 logo、没有标语。整页就是纸面上一列内容。
- 每行任务不挂「编辑」按钮，点任务文字就进入行内编辑。
- 统计只留「当前连续」和「最长连续」——「本周完成几天」由上面那排印记直接画出来了。

## 快速开始（不需要任何账号）

```bash
npm install
npm run dev:mock
```

打开 http://localhost:5173 。`dev:mock` 会启动一个**内存后端**，
它直接复用 `edge-functions/api` 下真实的路由处理函数，只是把 KV 换成了内存实现，
所以本地跑出来的行为就是部署后的行为。数据存在内存里，重启就没了。

其他命令：

```bash
npm test                  # 74 个测试
npm run build             # 类型检查 + 打包
npm run bench             # 实测一次 PBKDF2 要跑多久（密码哈希强度靠它定）
node dev/screenshot.mjs   # 用真实浏览器跑一遍流程并截图到 dev/shots
node dev/probe-remote.mjs # 打开线上站点看一眼（KV 没绑时就用它看错误界面）
```

## 项目结构

```
edge-functions/          后端（部署到 EdgeOne 的边缘函数）
├── _lib/                共享代码。下划线开头，不会生成路由
│   ├── kv.js            KV 访问 + key 命名
│   ├── date.js          北京时间日期工具
│   ├── streak.js        连续打卡计算（纯函数）
│   ├── auth.js          PBKDF2 密码哈希 + 会话
│   ├── store.js         任务 / 打卡 / 统计的业务逻辑
│   └── http.js          响应与错误处理
└── api/                 路由，一个文件一个接口
    ├── health.js          自检：KV 绑好没有
    ├── auth/{register,login,logout}.js
    ├── tasks/index.js
    └── checkins/index.js

src/                     前端
├── api.ts               fetch 封装
├── hooks/useAppData.ts  任务 + 打卡状态 + 统计
├── components/
│   ├── StampDefs.tsx    印章质感的 SVG 滤镜（全局挂一次）
│   ├── Stamp.tsx        一枚章：完成 / 部分完成 / 今天空位 / 空白
│   ├── WeekStamps.tsx   一周七枚
│   ├── StreakLine.tsx   连续天数
│   └── TaskList.tsx     任务清单 + 行内编辑器
└── pages/               LoginPage / DashboardPage

dev/                     仅开发用：内存 KV、mock 后端、截图脚本
├── mock-kv.js           内存版 KV，故意把每页限成 3 条来逼出翻页 bug
├── bench-pbkdf2.mjs     实测密码哈希耗时
└── probe-remote.mjs     用真实浏览器看线上站点
tests/                   单元测试 + 后端接口集成测试
```

## 接口

统一前缀 `/api`，登录后通过 `Authorization: Bearer <token>` 鉴权。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 自检：KV 绑定好没有（不用登录） |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks` | 新建任务 |
| PATCH | `/api/tasks` | 编辑 / 归档 |
| DELETE | `/api/tasks` | 删除 |
| GET | `/api/checkins` | 今天状态 + 本周 7 天 + 统计（一次返回） |
| POST | `/api/checkins` | 切换某个任务今天的完成状态 |

## 数据结构（EdgeOne KV）

EdgeOne KV 的 key **只允许字母、数字、下划线**，不能有 `:` 或 `-`，
所以 key 一律用下划线拼接，日期用 `YYYYMMDD`。

```
user_<用户名>              账号（含 salt / hash / 迭代次数）
session_<token>            会话
tasks_<用户名>             任务列表
prog_<用户名>_<YYYYMMDD>   当天勾了哪些任务 { done: [], total: n }
rec_<用户名>_<YYYYMMDD>    当天**全部完成**时才存在
```

最后一条是整个设计的支点：`rec_` 键只在当天全部完成时才写入，
于是「哪些天打过卡」就等于 `list({ prefix: 'rec_用户名_' })` 拿到的 key 列表。
连续打卡统计**只需要读 key 的名字，不需要读任何 value** ——
这是 KV 存储的正确用法，避免了把所有记录读出来再算。

## 部署到 EdgeOne（需要你自己操作）

下面几步需要浏览器登录，得你亲自来。在这之前先用 `npm run dev:mock` 把界面调好。

### 1. 登录 CLI

```bash
edgeone login
```

会打开浏览器，选腾讯云中国站或国际站登录。

### 2. 在控制台开通 KV 并绑定

1. 进 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)，创建一个项目
2. 到「KV 存储」页面开通，创建一个命名空间
3. 把这个命名空间**绑定到项目**，绑定时的**变量名必须填 `CHECKIN_KV`**

最后这一步不能写错：代码里就是靠 `CHECKIN_KV` 这个名字拿存储的
（见 `edge-functions/_lib/kv.js`）。绑完重新部署一次，然后打开自检接口确认：

```
https://你的域名/api/health
```

看到 `{"ok":true,"kv":"bound",...}` 就说明通了。如果返回 503，响应里的 `hint`
会直接告诉你缺什么 —— 不用去猜为什么所有接口都 500。

> ⚠️ **必须用浏览器打开，别用 curl。**
> `*.edgeone.cool` 这个默认域名外面套了一层预览网关，它要求浏览器执行 JS
> 校验 token。`curl` / `Invoke-WebRequest` 这类不会跑 JS 的客户端会被直接挡在
> **平台自己的 401 页面**（"Access Restricted or Authentication Expired"）上 ——
> 那个 401 不是你的应用返回的，跟 KV 有没有绑好毫无关系。
>
> 命令行里想自检就用 `npm run shots:remote`，它是用真实浏览器去请求的。

> KV 命名空间的开通需要平台审批，可能要等一会儿。这期间前端部署本身是好的
> （页面能打开），只是所有 `/api/*` 都会返回 500。

### 3. 关联项目到本地

```bash
edgeone makers link
```

输入控制台里的项目名。关联之后本地开发也能用上真正的 KV。

### 4. 本地全栈调试

```bash
edgeone makers dev
```

前端和函数会跑在同一个端口 http://localhost:8088 ，不用配代理。

> 注意：Edge Functions 的调试服务有启动次数限制，尽量别频繁重启 dev 服务
> （服务内热更新不会增加启动次数）。

### 5. 部署

```bash
edgeone makers deploy
```

会自动构建前端并把 `edge-functions` 一起打包上传，完成后给你一个
`*.edgeone.app` 之类的网址，**不需要备案、国内可直接访问**。

## 几个容易踩的坑

已经处理好了，但值得知道：

1. **本地和线上的 KV 取法不一样。** 线上走 `context.env.CHECKIN_KV`，
   但 `edgeone makers dev` 的本地 KV 代理是把客户端挂在 `globalThis` 上的。
   `kv.js` 里的 `getKV()` 两边都查了一遍，否则会「本地能跑、上线就崩」。

2. **时区。** 边缘节点的 `new Date()` 是 UTC。不转的话晚上 8 点之后打卡会被
   记到第二天。所有日期都经过 `date.js` 转成北京时间。

3. **Edge Functions 不支持 npm，而且有 200ms 的 CPU 时间上限。**
   所以密码哈希只能用运行时的 Web Crypto 做 PBKDF2（不能用 bcrypt/argon2），
   后端整体保持零依赖。

   迭代次数取 **30 万次**，这个数字是实测出来的而不是拍脑袋：`npm run bench`
   在本机跑 10 万次约 10ms，30 万次约 30ms，只占 200ms 预算的 15%，
   边缘节点再慢几倍也撞不到上限。

   迭代次数存在用户记录里，于是**调高是安全的** —— 老用户下次登录时明文密码
   正好在手上，顺手按新标准重算一遍存回去（见 `auth.js` 的 `verifyCredentials`）。

   ⚠️ 但反过来不成立：**调低救不了已经注册的用户**。他们各自的记录里存着
   自己的迭代次数，会继续按旧的高次数校验。所以线上第一次登录务必实测耗时，
   别等人都注册完了才发现太慢。

5. **登录接口是个天然的放大器。** 每次登录要烧掉约 30ms CPU，而
   `PBKDF2` 的耗时正是它防爆破的原理。反过来说，有人拿别人的用户名狂撞密码，
   就能替你烧掉 CPU 额度。目前**没有做频率限制** —— 自己和朋友用的量级下
   没问题，但这是个该知道的缺口，不是"已经解决了"。

6. **`*.edgeone.cool` 是平台的默认域名，官方定位是"演示和测试用"。**
   它对浏览器可用，但对 curl 之类会 401（见上一节），长期也不适合当正式入口。
   想稳定地把网址发给别人，要在控制台**绑定自己的域名**。另外要注意项目的
   加速区域：国际站项目默认覆盖的是中国大陆以外的区域，真要让国内访问最快，
   需要备案过的域名走大陆节点。

4. **KV 的 key 有字符集限制**，所以用户名只允许字母、数字、下划线，
   注册时就卡住了，避免写出非法 key。

## 测试覆盖了什么

68 个测试，分两层：

- **纯函数**（`tests/date.test.js`、`streak.test.js`、`store.test.js`）：
  时区边界、跨月跨年、连续打卡的各种断法、一次性任务的边界情况
- **后端接口**（`tests/api.test.js`）：用内存 KV 把真实的路由处理函数跑一遍，
  覆盖注册登录、鉴权、任务增删改、打卡与取消、一次性任务、
  连续统计、记录多到需要翻页、以及两个账号之间的数据隔离

内存 KV 故意的把每页大小设成 3（小于调用方请求的数量），
这样 `listKeys()` 的翻页循环一定会被走到。
