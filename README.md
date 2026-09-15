# 打卡

一个打卡应用：自己编辑每天要做的事，做完所有任务就算完成当天打卡，
可以看到本周记录和连续打卡天数。

前后端都在这个仓库里 —— 前端 React，后端是腾讯云 CloudBase 的云函数 + PostgreSQL，
部署后有国内可直接访问的网址（见「部署」一节）。

> 📖 **想搞懂这个项目是怎么搭起来的、以及为什么部署花了那么久**，
> 看 [`docs/retrospective.md`](docs/retrospective.md)。
> 那是一份写给第一次做全栈项目的人的复盘，包含架构讲解、值得学的知识点、
> 完整工作流，以及一份把术语都拆开解释的词汇表。

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

## 快速开始（不需要任何云服务账号）

```bash
npm install
npm run dev:mock
```

打开 http://localhost:5173 。`dev:mock` 会启动一个**内存后端**，
它直接复用 `backend/api` 下真实的路由处理函数，只把存储换成了内存实现，
所以本地跑出来的行为就是部署后的行为。数据存在内存里，重启就没了。

这意味着一件事：**不注册任何云服务也能把整个应用跑起来、调界面、跑测试**。

其他命令：

```bash
npm test                  # 99 个测试
npm run build             # 类型检查 + 打包
npm run bench             # 实测一次 PBKDF2 要跑多久（密码哈希强度靠它定）
node dev/screenshot.mjs   # 用真实浏览器跑一遍流程并截图到 dev/shots
node dev/probe-remote.mjs <线上地址>   # 检查线上站点并截图
node dev/tcb.mjs <参数.json>           # 调 CloudBase CLI（绕开 PowerShell 的引号问题）
```

## 项目结构

```
backend/                  后端（部署为 CloudBase 云函数）
├── index.js              CommonJS 入口 —— 必须是 CJS，原因见「坑 1」
├── app.mjs               真正的入口逻辑：事件 ↔ Request/Response 翻译 + 路由分发
├── routes.mjs            路由表（单一事实来源）
├── _lib/                 平台无关的业务代码
│   ├── date.mjs          北京时间日期工具
│   ├── streak.mjs        连续打卡计算（纯函数）
│   ├── store.mjs         任务 / 打卡 / 统计的业务逻辑
│   ├── auth.mjs          PBKDF2 密码哈希 + 会话
│   ├── http.mjs          响应与错误处理
│   ├── kv.mjs            key 命名 + JSON 封装（不碰平台）
│   └── kv-cloudbase.mjs  在 PostgreSQL 上实现 KV 契约
└── api/                  路由处理函数，一个文件一个接口
    ├── health.mjs        自检（读 + 写 + 删全走一遍）
    ├── auth/{register,login,logout}.mjs
    ├── tasks/index.mjs
    └── checkins/index.mjs

src/                      前端
├── api.ts                fetch 封装
├── hooks/useAppData.ts   任务 + 打卡状态 + 统计
├── components/
│   ├── StampDefs.tsx     印章质感的 SVG 滤镜（全局挂一次）
│   ├── Stamp.tsx         一枚章：完成 / 部分完成 / 今天空位 / 空白
│   ├── WeekStamps.tsx    一周七枚
│   ├── StreakLine.tsx    连续天数
│   └── TaskList.tsx      任务清单 + 行内编辑器
└── pages/                LoginPage / DashboardPage

dev/                      仅开发用
├── mock-kv.js            内存版 KV，故意把每页限成 3 条来逼出翻页 bug
├── mock-api-plugin.js    本地开发服务器，复用 backend/api 下真实的路由函数
├── bench-pbkdf2.mjs      实测密码哈希耗时
├── probe-remote.mjs      用真实浏览器检查线上站点
└── tcb.mjs               调 CloudBase CLI 的薄封装

tests/                    单元测试 + 接口集成测试
cloudbaserc.json          部署配置（云函数 / 静态托管 / 网关路由）
```

## 接口

统一前缀 `/api`，登录后通过 `Authorization: Bearer <token>` 鉴权。

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/api/health` | 自检：数据库读写通不通（不用登录） |
| POST | `/api/auth/register` | 注册 |
| POST | `/api/auth/login` | 登录 |
| POST | `/api/auth/logout` | 退出 |
| GET | `/api/tasks` | 任务列表 |
| POST | `/api/tasks` | 新建任务 |
| PATCH | `/api/tasks` | 编辑 / 归档 |
| DELETE | `/api/tasks` | 删除 |
| GET | `/api/checkins` | 今天状态 + 本周 7 天 + 统计（一次返回） |
| POST | `/api/checkins` | 切换某个任务今天的完成状态 |

**部署出问题时先打开 `/api/health`。** 它会把配置错误收敛成一句话，
而不是让你面对一堆莫名其妙的 500。

## 数据结构

存储是 CloudBase 的 **PostgreSQL**。表只有两列：

```sql
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
```

`key` 是主键，所以按 key 查、按 key 排序、按前缀范围扫都走索引。

```
user_<用户名>              账号（含 salt / hash / 迭代次数）
session_<token>            会话
tasks_<用户名>             任务列表
prog_<用户名>_<YYYYMMDD>   当天勾了哪些任务 { done: [], total: n }
rec_<用户名>_<YYYYMMDD>    当天**全部完成**时才存在
```

**在关系库上做 KV 抽象是个刻意的取舍。** `store.mjs` / `auth.mjs` 和全部测试
都建立在 `kv.get/put/delete/list` 这个契约上（契约定义见 `dev/mock-kv.js`）。
复刻契约意味着业务代码一行不用改、换平台时风险最小；代价是没吃到关系库的
查询能力 —— 但对这个规模完全够用。以后想改成正经的表结构，`kv.mjs` 就是那道缝。

最后一条键是整个设计的支点：`rec_` 只在当天全部完成时才写入，
于是「哪些天打过卡」就等于按前缀 `rec_<用户名>_` 查出来的 key 列表。
连续打卡统计**只需要读 key 的名字，不需要读任何 value**。

## 部署到 CloudBase

大部分能命令行完成，只有开通环境必须去控制台。

### 1. 在控制台开通环境（一次性）

进 [云开发控制台](https://console.cloud.tencent.com/tcb) → 引导页点「免费开通环境」。
体验版 0 元/月，3000 资源点，6 个月需手动续期。

拿到环境 ID 后填进 `cloudbaserc.json` 的 `envId`。

### 2. 建表并授权

```bash
tcb db execute -e <环境ID> --sql "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)"
```

### 3. 建一个 API Key 并配上

数据库默认给到的是 `anon` 角色，**只有 SELECT**。不要为了省事去给 `anon` 开写权限 ——
那等于把整张表开放给任何持有匿名凭据的人。正确做法是让云函数用服务端身份：

```bash
# 1) 创建服务端 key（--type api_key，不是 publish_key）
tcb env apikey create checkin-server -e <环境ID> --json
```

```bash
# 2) 部署时通过环境变量注入（cloudbaserc.json 里已经是 {{env.CHECKIN_APIKEY}} 模板，
#    所以密钥不会进仓库、不落盘）
export CHECKIN_APIKEY='<刚创建的 key>'
tcb deploy -f
```

node-sdk 会自动读 `CLOUDBASE_APIKEY` 这个环境变量，用它代替匿名凭据
（见 `node-sdk/dist/utils/utils.js:125`）。

### 4. 部署

```bash
tcb login          # 浏览器设备码授权，一次就够
tcb deploy -f      # 按 database → functions → hosting → gateway 顺序编排
```

`cloudbaserc.json` 里已经配好：静态托管（前端 `dist`）、云函数 `api`、
以及 7 条网关路由（`/` 走静态托管，6 个 `/api/*` 走云函数）。

> 网关路由的 `path` **不支持通配符**，所以每个接口要单独一条。

### 5. 验证

```bash
node dev/probe-remote.mjs https://<你的域名>
```

它会用真实浏览器打开站点、点过「测试域名」提示页、注册、建任务、打卡、截图。

## 几个容易踩的坑

按踩到的顺序。**这些都不是看文档能提前知道的**，所以留下来。

### 1. CloudBase 只认 CommonJS 入口，不认 ESM

运行时是用 `require()` 加载入口的。哪怕选的是 Node 24（本该支持 `require(esm)`），
一个什么都不做、只 `export function main` 的函数也会崩，平台只回一句
`0 code exit unexpected`，看不出所以然。

对策是入口做成 CommonJS 壳（`backend/index.js`），真正的逻辑放在 `app.mjs` 里
动态载入。于是 `_lib/**` 和 `api/**` 全部保持 ESM，测试一行没改。

### 2. HTTP 网关默认**不**透传路径

`enablePathTransmission` 默认 `false`，意思是只把「匹配之后的路径」传给上游。
所以配了 `/api/health` 的路由，函数里收到的 `event.path` 是 `/` —— 所有接口都 404。

对策：路由上加 `"enablePathTransmission": true`（`cloudbaserc.json` 里已配）。

### 3. SDK 默认把环境 ID 当数据库 schema

`app.rdb()` 的 `database` 参数默认取**环境 ID**（见 `node-sdk/dist/cloudbase.js:104`），
而这个值会被塞进 PostgREST 的 `Accept-Profile` 头 —— 也就是 schema 名。
于是报 `Invalid schema: <环境ID>`。

对策：显式 `rdb({ database: 'public' })`。

### 4. 时区

运行时的 `process.env.TENCENTCLOUD_TZ` 是 **UTC**。不转的话晚上 8 点之后
打卡会被记到第二天。所有日期都经过 `date.mjs` 转成北京时间。

### 5. 边缘/无服务器环境里，兜住未处理的 Promise 拒绝

云函数实例是长期存活的，一个没人接的 Promise 拒绝会直接杀掉进程，
而平台只报一句没头没尾的 `0 code exit unexpected`。
`app.mjs` 里挂了 `process.on('unhandledRejection')`，至少留下日志、不让实例死掉。

### 6. 自检要检查"能不能写"，不能只检查"能不能读"

「读得动但写不了」是个真实存在的故障（权限只授了 SELECT 就会这样），
只做读探测会漏掉它，然后你会以为是业务逻辑出了问题。
`/api/health` 因此是写一条、读回来、再删掉。

### 7. 平台默认域名是"测试域名"

CloudBase 的默认域名会先弹一个「仅供开发测试使用」的提示页，访客要点一下
「确定访问」才进得去（Cookie 有效期内不重复）。这只影响浏览器导航，
**页面内的 fetch 不受影响** —— 所以线上接口测试用 curl 是准的。

彻底去掉它需要绑一个**已备案**的自定义域名。

### 8. PowerShell 会吃掉传给原生程序的引号

`tcb routes add --data '{"path":"..."}'` 里的引号到达 CLI 时已经没了，
报一个和真实原因无关的 `JSON parse failed`。
`dev/tcb.mjs` 用 Node 的 `spawnSync` 传参数组绕开 shell，复杂参数还可以用
`@文件` 语法从文件读。

## 测试覆盖了什么

99 个测试，分三层：

- **纯函数**（`tests/date.test.js`、`streak.test.js`、`store.test.js`）：
  时区边界、跨月跨年、连续打卡的各种断法、一次性任务的边界情况
- **后端接口**（`tests/api.test.js`）：用内存 KV 把真实的路由处理函数跑一遍，
  覆盖注册登录、鉴权、任务增删改、打卡与取消、一次性任务、连续统计、
  记录多到需要翻页、两个账号之间的数据隔离、以及畸形 token 的防御
- **平台适配**（`tests/cloudbase.test.js`）：事件 → Request → Response 的翻译、
  路径归一化、base64 body、以及**路由表与 `api/` 目录的一致性** ——
  加了接口忘了注册时本地照常能跑、线上会 404，这条断言专门防这个

内存 KV 故意把每页大小设成 3（小于调用方请求的数量），
这样 `listKeys()` 的翻页循环一定会被走到。

## 已知问题

- **PBKDF2 迭代次数没在真实运行时实测过。** 本机测 30 万次约 30ms
  （`npm run bench`），但云端 CPU 配额的实测还没做。迭代次数存在用户记录里，
  所以调高是安全的（老用户登录时会自动升级），但调低救不了已注册用户。
- **登录接口没有频率限制。** 每次登录要烧掉约 30ms CPU，
  有人拿别人的用户名狂撞密码能替你烧掉配额。个人使用的量级下没问题。
- **自检接口会暴露底层错误信息。** 对运维友好，但公开可访问。
  真要对陌生人开放的话应该改成只返回错误码、细节写日志。
