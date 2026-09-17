# 第一章 · 整体架构、数据存储与打卡全链路

> 学习笔记系列之一。写给懂基础 SQL（select/insert）、但没接触过前后端/数据库/服务器完整链路的你。
>
> 配套项目：`checkin-app`（打卡应用，已部署在腾讯云 CloudBase）
>
> **本章不改任何代码**，只做阅读理解。所有结论都标注了 `文件:行号`，可以自己跳过去核对。

---

## 开场：两个必须先纠正的前提

在讲架构之前，有两件事和你的预想可能不一样，它们会影响你后面所有的理解：

| 你的预想 | 实际情况 |
|---|---|
| 项目有个 MySQL 那样的数据库，里面有好几张表 | 用的是 **KV（键值）存储**，底层是一张 PostgreSQL 表，但**只有 2 列** |
| 页面上有个「提交打卡」按钮 | **没有这个按钮**。"打卡"= 把当天任务全部勾完 |

这不是抠字眼，而是这个项目的核心设计。搞懂这两点，你原本的 SQL 知识正好能接上——因为底层真的是 PostgreSQL。

---

## §1 完整架构图（文字版）

```
┌─────────────────────────────────────────────────────────────┐
│ ① 用户手机浏览器                                                │
│    打开 https://<你的域名>/                                    │
└────────────────────────┬────────────────────────────────────┘
                         │ HTTP GET /
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ ② 腾讯云 CloudBase 网关（gateway）                              │
│    配置在 cloudbaserc.json:27-37                               │
│    /            → hosting:web      （静态网页）                 │
│    /api/xxx     → function:api     （云函数）                   │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ ③ 静态托管：返回 dist/ 里的 index.html + JS + CSS               │
│    ↑ 这是"前端"：React 写的，代码在 src/                        │
│    它跑在【用户手机里】，不在服务器上                            │
└────────────────────────┬────────────────────────────────────┘
                         │ 用户点击任务勾选框
                         │ fetch('/api/checkins', POST, JSON)
                         │ 请求头带 Authorization: Bearer <token>
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ ④ 云函数 api（后端，Nodejs24.11，上海）                          │
│    入口 backend/index.js（CommonJS 壳）                         │
│      ↓ 动态 import                                             │
│    真正的逻辑 backend/app.mjs                                   │
│      ├─ 把网关事件翻译成标准 Request 对象                         │
│      ├─ routes.mjs 按路径找处理函数                              │
│      └─ 调用 api/checkins/index.mjs                             │
│           ├─ _lib/auth.mjs    验证 token，拿到"你是谁"            │
│           └─ _lib/store.mjs   业务规则（什么算完成打卡）           │
│                └─ _lib/kv.mjs 统一存取接口                      │
└────────────────────────┬────────────────────────────────────┘
                         │ kv.get / kv.put / kv.list
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ ⑤ kv-cloudbase.mjs：@cloudbase/node-sdk 的 rdb()               │
│    它是个 PostgREST 客户端 —— 把 JS 调用翻译成 HTTP 请求，       │
│    平台再把 HTTP 翻译成真正的 SQL                               │
└────────────────────────┬────────────────────────────────────┘
                         ▼
┌─────────────────────────────────────────────────────────────┐
│ ⑥ PostgreSQL 数据库（CloudBase 托管，schema = public）           │
│    只有一张表：kv(key TEXT 主键, value TEXT)                     │
│    账号、会话、任务、打卡记录 —— 全在这张表里                      │
└────────────────────────┬────────────────────────────────────┘
                         │ JSON 结果
                         ▼
        原路返回：⑥→⑤→④→③→②→① 前端 setState → 界面重绘
```

### 关键认知

**③ 前端跑在用户手机上，④⑤⑥ 跑在腾讯云上。**

中间那条 `fetch('/api/...')` 是唯一的分界线。前端永远拿不到数据库连接，它只能"发请求、等回话"。这也是为什么后端必须做鉴权——请求来自公网，谁都能伪造。

### 一句话概括每层职责

| 层 | 文件/位置 | 职责 | 一句话 |
|---|---|---|---|
| 前端 | `src/` | 画界面、处理点击、发请求 | 只管"显示"和"把用户意图发出去" |
| 适配层 | `backend/app.mjs` | 翻译网关事件 ↔ 标准 Request/Response | 让业务代码不依赖具体云平台 |
| 路由 | `backend/routes.mjs` | 路径 → 处理函数 | 一张手写路由表 |
| 接口层 | `backend/api/**` | 校验参数、鉴权、返回 JSON | 薄薄一层，不写业务规则 |
| 业务层 | `backend/_lib/store.mjs` | "什么算完成打卡"等规则 | 项目的大脑 |
| 存储层 | `backend/_lib/kv.mjs` + `kv-cloudbase.mjs` | 统一的 KV 读写接口 | 屏蔽底层差异 |

---

## §2 "数据库表结构"

### 2.1 真实的表：只有一张

`backend/_lib/kv-cloudbase.mjs:12` 的注释里直接写了建表语句：

```sql
CREATE TABLE kv (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

| 字段 | 类型 | 含义 |
|---|---|---|
| `key` | TEXT | 主键。一个字符串"名字" |
| `value` | TEXT | 这个"名字"对应的内容，**是 JSON 字符串** |

就这两列。所有数据都塞在这里面。

### 2.2 那"任务表""用户表"在哪？—— 逻辑上的表

它们不是物理表，而是 **key 的命名约定**（定义在 `backend/_lib/kv.mjs:76-80`）：

| key 的样子（逻辑表名） | value 里存什么 | 举个例子 |
|---|---|---|
| `user_<用户名>` | 账号信息（盐、密码哈希、迭代次数） | `{"username":"mashuai","salt":"a1b2…","hash":"9f3c…","iterations":300000,"createdAt":"…"}` |
| `session_<64位token>` | 登录会话 | `{"username":"mashuai","expiresAt":1768...}` |
| `tasks_<用户名>` | **这个人的全部任务，一个数组** | `[{"id":"3f8a…","title":"跑步 800 米","type":"daily","archived":false,"completedAt":null,"createdAt":"…"}]` |
| `prog_<用户名>_<YYYYMMDD>` | 某天勾了哪些任务 | `{"done":["3f8a…"],"total":3}` |
| `rec_<用户名>_<YYYYMMDD>` | **某天全部完成的凭证（盖章）** | `{"completedAt":"2026-09-17T12:00:00.000Z"}` |

### 2.3 这个设计最妙的一点（务必看懂）

`rec_` 这个 key **只在当天任务全部勾完时才存在**。没打完，这个 key 干脆不存在。

于是"这个人哪些天打了卡"这个问题，答案是：

```
把 key 以 rec_mashuai_ 开头的行全找出来 → 从 key 名字里就能读出日期
```

**完全不需要读任何 value**。这就是 `backend/_lib/store.mjs:217-223` 干的事。连续打卡天数（`backend/_lib/streak.mjs`）就是在这个日期列表上数连续段。

> 用 SQL 的心智类比：这相当于把"日期"这个字段**编码进了主键**，用主键的范围扫描代替了 `WHERE user_id=? AND completed=1`，而且还不用建索引——主键天然有序。

### 2.4 代价（有得必有失）

- ❌ 不能 `JOIN`，不能 `GROUP BY`，不能写复杂条件查询
- ❌ 改一条任务 = 把整个 `tasks_` 数组读出来改完再**整体写回**（读-改-写）
- ❌ 没有事务

**这些代价会在 §5 变成一个真实的 bug。** 先记住"读-改-写"这三个字。

---

## §3 "提交打卡"的后端代码逐行解析

> 💡 **如果这一节看不懂，先去看 [第零章：基础概念](learning-00-basics.md)。**
> 那里补了 HTTP 请求/响应、前端后端分工、JavaScript 语法这三层地基。

先定位：**POST `/api/checkins`**，文件是 `backend/api/checkins/index.mjs`。

### 3.1 路由怎么找到它

`backend/routes.mjs:20-27` 是一张手写的路由表：

```js
export const ROUTES = {
  '/api/checkins': checkins,     // ← 第 26 行
  // ...
};
```

`backend/app.mjs:98` 用 `matchRoute(event.path)` 拿路径去查这张表，查到就把请求交给 `checkins` 这个函数。

> 为什么要手写路由表？（`routes.mjs:1-11` 的注释）CloudBase 云函数收到的是 API 网关风格的事件，路径在 `event.path` 里，**不能像文件系统路由那样按目录自动映射**，所以必须显式列出。`tests/routes.test.js` 会断言这张表跟 `api/` 下的文件完全对得上——加了新接口忘了注册，测试会先红。

### 3.2 逐行解析 `backend/api/checkins/index.mjs`

```js
const handle = withHandler(async (context) => {
```

**作用**：`withHandler`（`_lib/http.mjs:34-47`）是把业务函数包一层的"外衣"，统一做两件事：

1. 遇到 `OPTIONS` 预检请求直接回 204（浏览器跨域前的探路请求）
2. 业务代码里 `throw` 出来的错误统一转成 JSON 错误响应

好处是下面每一行都不用写 try/catch。

```js
  const kv = getKV(context);
```

**作用**：取出存储客户端。`_lib/kv.mjs:29` 先看 `globalThis.CHECKIN_KV`（本地开发用），再看 `context.env.CHECKIN_KV`（线上用）。拿不到就抛错。

**和数据库的关系**：这一步**还没连数据库**，只是拿到一个"句柄"（可以理解成 SQL 里的会话对象）。

```js
  const { username } = await requireUser(context, kv);
```

**作用**：**鉴权**。回答"你是谁"。

- **数据流向**：请求头 `Authorization: Bearer <token>` → 查库 → 得到 `username`
- **安全隐患**：如果这一步被绕过，任何人都能操作别人的打卡数据

```js
  if (context.request.method === 'GET') {
    return json(await loadCheckinOverview(kv, username, weekDates(beijingDateString())));
  }
```

**作用**：GET 是"读"——一次返回今天状态 + 本周 7 天 + 连续统计。前端首屏加载和每次刷新都走这里。

```js
  if (context.request.method === 'POST') {
    const { taskId, done } = await readJson(context.request);
```

**作用**：POST 是"写"。从请求体里取出两个参数。请求体长这样：

```json
{ "taskId": "3f8a1b...", "done": true }
```

- `taskId`：勾的是哪个任务（任务的 16 位随机 id）
- `done`：勾上（`true`）还是取消（`false`）

**注意请求里没有日期**。日期是服务器自己算的（见 3.4），这是故意的。

```js
    if (typeof taskId !== 'string' || !taskId) throw new ApiError('缺少 taskId');
    if (typeof done !== 'boolean') throw new ApiError('done 必须是布尔值');
```

**作用**：校验类型。避免前端传来 `done: "true"`（字符串）这种脏数据。

**潜在问题**：`taskId` 只校验了"是非空字符串"，**没有校验长度和字符集**。不过它不会拼进 KV key（只是和数组里的 id 比对），所以危害有限。

```js
    await toggleTask(kv, username, taskId, done);
```

**作用**：**真正干活的在这里**。见 3.4。

```js
    return json(await loadCheckinOverview(kv, username, weekDates(beijingDateString())));
```

**作用**：写完**立刻重新全量读一遍**，把最新状态回给前端，省一次往返。

> ⚠️ **性能观察**：`toggleTask` 明明已经算出了新状态（它 `return {taskId, done, complete}`），但这里**把返回值丢掉了**，改用一次"全量重读"。而 `loadCheckinOverview`（`store.mjs:226-273`）内部要跑：1 次列 key + 1 次读任务 + 1 次读进度 + **7 次**读本周每一天的进度 ≈ **10 次数据库往返**。所以每勾一个任务，数据库要被打十几次。这个规模无所谓，但值得知道。

```js
  throw new ApiError('只支持 GET / POST', 405);
```

**作用**：其他 HTTP 方法（PUT/DELETE）一律拒绝。405 是"方法不允许"的标准状态码。

### 3.3 鉴权那一步：`backend/_lib/auth.mjs:144-155`

```js
export async function requireUser(context, kv) {
  const token = parseBearerToken(context);      // 从请求头里抠出 token
  if (!token) throw new ApiError('未登录', 401);

  const session = await getJson(kv, sessionKey(token));   // ① 查库
  if (!session) throw new ApiError('登录已失效，请重新登录', 401);
  if (session.expiresAt < Date.now()) {                    // ② 自己判断过期
    await kv.delete(sessionKey(token));                    // ③ 顺手删掉
    throw new ApiError('登录已过期，请重新登录', 401);
  }
  return { username: session.username, token };
}
```

**数据来源**：token 来自前端 `localStorage`（`src/api.ts:3` 的 `checkin.session`）。

**为什么要 `parseBearerToken` 做正则校验**（`auth.mjs:134-141`）：token 会被直接拼进 KV key（`session_<token>`），而 KV key 只允许字母数字下划线。如果不管，攻击者传 `Bearer not-a-real-token`，短横线会让底层存储直接抛异常 → 对外表现成 **500 而不是 401**，属于"把内部实现细节泄露出去"。代码注释里明说这是测试发现的真实缺陷。

**① 的 SQL 等价物**：

```sql
SELECT value FROM kv WHERE key = 'session_a3f9...（64位）' LIMIT 1;
```

### 3.4 核心：`backend/_lib/store.mjs:177-203` 的 `toggleTask`

```js
export async function toggleTask(kv, username, taskId, done) {
  const dateString = beijingDateString();   // 'YYYY-MM-DD'
  const dateKey    = beijingDateKey();      // 'YYYYMMDD'
```

**作用**：**日期由服务器算，不从请求里取**。

**为什么重要**：这是"严格不允许补卡"的实现方式——不是靠校验参数，而是**结构上就没有日期参数可传**。你想补昨天的卡，无从下手。

**为什么需要 `date.mjs`**（`_lib/date.mjs:1-17`）：云函数可能跑在世界上任何节点，`new Date()` 是 UTC。不转换的话，晚上 8 点后打卡会被算成"第二天"，周末前后的连续统计也会错。所以统一 `+8 小时` 转北京时间。

```js
  const tasks = await loadTasks(kv, username);
```

**① 读库** → `SELECT value FROM kv WHERE key = 'tasks_mashuai' LIMIT 1`
得到整个任务数组。

```js
  const task = tasks.find((item) => item.id === taskId);
  if (!task) throw new ApiError('任务不存在', 404);
  if (task.archived) throw new ApiError('该任务已归档');
```

**作用**：确认这个任务真的存在、且没被归档。防的是"前端发来一个伪造/过期的 taskId"。

```js
  const doneIds = await loadProgress(kv, username, dateKey);
```

**② 读库** → `SELECT value FROM kv WHERE key = 'prog_mashuai_20260917' LIMIT 1`
拿到一个 `Set`，里面是今天已勾的任务 id。读不到就是空集合（今天还没勾过）。

```js
  if (done) doneIds.add(taskId);
  else      doneIds.delete(taskId);
```

**作用**：纯内存操作，勾上就加进集合，取消就从集合里删。**还没写库。**

```js
  if (task.type === 'once') {
    const completedAt = done ? dateString : null;
    if (task.completedAt !== completedAt) {
      task.completedAt = completedAt;
      await saveTasks(kv, username, tasks);
    }
  }
```

**作用**：一次性任务（比如"交论文"）被勾上时，记下完成日期，之后它就不再出现在待办里。

**③ 可能写库** → `INSERT INTO kv ... ON CONFLICT (key) DO UPDATE`（把整个 `tasks_` 数组覆盖写回）。

**注意**：只有一次性任务才会走这一步；每日任务不改这里。

```js
  await saveProgress(kv, username, dateKey, doneIds, todoTasksFor(tasks, dateString).length);
```

**④ 写库** → 把今天勾了哪些，覆盖写回 `prog_` key。

`total` 存的是"今天应该做几个"，用于周视图画"完成了多少"的填充比例（`store.mjs:134-138` 的注释解释了这一点）。

```js
  const complete = await syncDayRecord(kv, username, dateString, dateKey, tasks, doneIds);
```

**⑤ 写库（最重要的一步）**。看 `store.mjs:161-170`：

```js
async function syncDayRecord(kv, username, dateString, dateKey, tasks, doneIds) {
  const complete = isDayComplete(tasks, dateString, doneIds);   // 全部勾完了吗？
  const key = recordKey(username, dateKey);                     // rec_mashuai_20260917
  if (complete) {
    await putJson(kv, key, { completedAt: new Date().toISOString() });  // ★盖章：写入 rec_ key
  } else {
    await kv.delete(key);                                              // 取消勾选导致不完整 → 撤销盖章
  }
  return complete;
}
```

> ★ **这一行 `putJson` 就是"打卡成功"发生的物理瞬间。**
> 之前所有步骤都只是草稿，这一步把"今天完成了"这个事实**落了盘**。

判定规则（`store.mjs:126-130`）：

```js
export function isDayComplete(tasks, dateString, doneIds) {
  const todo = todoTasksFor(tasks, dateString);
  if (todo.length === 0) return false;                // 一个任务都没有 → 不算完成
  return todo.every((task) => doneIds.has(task.id));  // 应做的全部勾上才算
}
```

第一行的 `return false` 是为了防止"没建任务 = 天天满分"这种刷分行为。

```js
  return { taskId, done, complete };
}
```

返回给调用方——**但如前所述，被 `api/checkins/index.mjs:24` 丢掉了。**

### 3.5 对应的原生 SQL（重点）

`@cloudbase/node-sdk` 的 `rdb()` 是**两层翻译**：

```
你的 JS 代码
   ↓ ① SDK 翻译成 HTTP 请求（PostgREST 协议）
HTTP: GET /kv?select=value&key=eq.tasks_mashuai&limit=1
   ↓ ② PostgREST 翻译成 SQL
PostgreSQL 执行
```

#### ① 读（`kv-cloudbase.mjs:60-67`）

```js
db.from('kv').select('value').eq('key', key).limit(1)
```

```sql
SELECT value FROM kv WHERE key = 'tasks_mashuai' LIMIT 1;
```

#### ② 写 / 盖章（`kv-cloudbase.mjs:69-76`）

```js
db.from('kv').upsert({ key, value })
```

```sql
INSERT INTO kv (key, value)
VALUES ('rec_mashuai_20260917', '{"completedAt":"2026-09-17T10:23:41.000Z"}')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

> `upsert` = "有则更新，无则插入"，正好对应 KV 的语义。**这一条 SQL 就是你打卡成功的那一下。**

#### ③ 删除（撤销盖章，`kv-cloudbase.mjs:78-82`）

```js
db.from('kv').delete().eq('key', key)
```

```sql
DELETE FROM kv WHERE key = 'rec_mashuai_20260917';
```

#### ④ 列 key（算连续天数，`kv-cloudbase.mjs:91-111`）

```js
db.from('kv').select('key').like('key', 'rec_mashuai_%').order('key',{ascending:true}).limit(500)
```

```sql
SELECT key FROM kv
WHERE key LIKE 'rec_mashuai_%'
ORDER BY key ASC
LIMIT 500;
```

#### 一次勾选，SQL 层面的完整清单

| 序 | SQL | 目的 |
|---|---|---|
| 1 | `SELECT value FROM kv WHERE key='session_<token>' LIMIT 1` | 鉴权：你是谁 |
| 2 | `SELECT value FROM kv WHERE key='tasks_mashuai' LIMIT 1` | 取任务列表 |
| 3 | `SELECT value FROM kv WHERE key='prog_mashuai_20260917' LIMIT 1` | 今天已勾哪些 |
| 4 | `INSERT ... ON CONFLICT DO UPDATE` on `prog_...` | 存今天进度 |
| 5 | `INSERT ... ON CONFLICT DO UPDATE` on `rec_...` | ★ 盖章 |
| 6 | （仅一次性任务）`INSERT ... ON CONFLICT DO UPDATE` on `tasks_...` | 记完成日期 |
| 7 | `SELECT value ... key='tasks_mashuai'` 等 **约 10 条查询** | 回给前端全量最新状态 |

---

## §4 用户点击勾选框，完整发生了哪些事情

以"最后一个任务被勾上、打卡成功"为例，**12 步**：

| # | 在哪 | 发生什么 |
|---|---|---|
| 1 | 📱 用户手机 | 手指点中勾选框（`src/components/TaskList.tsx:215` 的 `<input type="checkbox">`） |
| 2 | 📱 前端 | 触发 `onChange` → 调用 `onToggle(task.id, true)` |
| 3 | 📱 前端 | `src/hooks/useAppData.ts:48` **乐观更新**：先在本地把 `optimistic[taskId]=true`，界面**立刻**画上印章，不等服务器 |
| 4 | 📱 前端 | `src/api.ts:92` 组装请求：`POST /api/checkins`，body `{"taskId":"3f8a…","done":true}`，头里带 `Authorization: Bearer <token>` |
| 5 | 🌐 网络 | 请求经 TLS 加密发送 → 到达 CloudBase 网关 |
| 6 | ☁️ 网关 | 命中 `cloudbaserc.json:35` 的路由 → 转发给云函数 `api` |
| 7 | ☁️ 云函数 | `backend/index.js` → 动态载入 `app.mjs` → `main(event)`：把网关事件翻译成标准 `Request` 对象（`app.mjs:49-80`） |
| 8 | ☁️ 云函数 | `matchRoute('/api/checkins')` 命中 → 调用 `withHandler` 包过的处理函数 |
| 9 | ☁️ 后端 | `requireUser` 用 token **查一次数据库**确认你没过期 → 拿到 `username` |
| 10 | 🗄️ 数据库 | 见 §3.5 的 1→7 步：读任务、读进度、**写进度**、**写 rec_ 盖章**（此时"打卡成功"已落盘） |
| 11 | ☁️→📱 | 后端把最新全量状态（今天完成数、本周 7 天、连续天数）打包成 JSON 返回，HTTP 200 |
| 12 | 📱 前端 | `setOverview(next)` 收到服务器权威数据 → 覆盖乐观更新 → 界面重绘：印章显现、"已盖章"文字出现、周视图今天那格填满 |

### 如果第 10 步失败会怎样？

`src/hooks/useAppData.ts:60-68` 的 `catch` 会显示错误信息，`finally` 里把乐观状态删掉 → 界面**自动回滚**成服务器状态（印章消失）。

所以乐观更新是安全的，代价只是"用户会看到印章闪一下又没了"。

### 为什么要"乐观更新"？

`useAppData.ts:5-10` 的注释说得很清楚：部署到边缘节点后一个往返可能要几百毫秒，"盖章"那一下必须是即时的。

---

## §5 这条链路上的真实 bug 与安全隐患

### ① 并发写导致丢数据（最值得关注，真实缺陷）

第 10 步的 ③→④ 是典型的**读-改-写**：读出 `prog_` → 内存里改 → 整体覆盖写回。**没有任何事务和版本号保护。**

场景：手快，同时勾了任务 A 和任务 B，两个请求并发到达。

```
请求1：读到 {done:[]} → 准备写 {done:[A]}
请求2：读到 {done:[]} → 准备写 {done:[B]}   ← 也读到了空
请求1 写入：{done:[A]}
请求2 写入：{done:[B]}   ← 把请求1 的结果盖掉了
```

结果：**A 的勾选丢了**。而前端因为乐观更新，两个都显示已勾——不刷新看不出来。

> ⚠️ **这个 bug 是被乐观更新掩盖的**，属于"用户偶发反馈'我明明打了卡怎么没记录'"的典型来源。
>
> 修复思路（以后再说，别现在动）：给 value 加版本号做乐观锁，或者把"勾选 A/B"改成两个独立的 key（每个任务一个 key，就不存在覆盖了）。

### ② key 前缀碰撞（设计缺陷）

`store.mjs:218` 用 `rec_${username}_` 做前缀，而用户名允许下划线（`auth.mjs:166`）。于是：

- 用户 `abc` 的前缀是 `rec_abc_`
- 用户 `abc_1` 的记录 key 是 `rec_abc_1_20260917` ← **也以 `rec_abc_` 开头！**

结果：用户 `abc` 统计连续天数时，会读到 `abc_1` 的记录（虽然会解析出垃圾日期，多数情况无害）。**但这个模式本身是错的**——一旦哪天解析逻辑变了，就是一个真实的跨用户数据泄露。

更隐蔽的是底层 SQL 用的 `LIKE 'rec_abc_%'`：**SQL 里 `_` 是通配符**（匹配任意单个字符），所以这个 LIKE 连 `recXabcY……` 都能匹配上。

### ③ 登录接口没有频率限制

`auth.mjs` 用 PBKDF2 30 万次迭代（这是好事，约 30ms，抬高暴力破解成本），但**没有失败次数锁定、没有验证码、没有 IP 限流**。攻击者可以无限次尝试密码。

### ④ 会话 token 存在 localStorage（`src/api.ts:17`）

一旦网站有 XSS 漏洞，token 可被 JS 直接读走。更安全的做法是 HttpOnly Cookie。这个项目目前没有 XSS 入口（React 默认转义），属于"可接受的取舍"，但应该知道。

### ⑤ CORS 写死 `*`（`_lib/http.mjs:6`）

`access-control-allow-origin: *` 允许任意网站调用你的接口。因为鉴权靠 `Authorization` 头（不是 Cookie），攻击者得先知道 token 才有用，所以危害不高。但生产环境应该改成实际域名。

### ⑥ 归档任务永久堆积

`store.mjs:74` 的 50 个上限只统计**未归档**任务。归档的任务永远留在 `tasks_` 数组里，数组会无限增长，每次读任务都要全量传输。小规模无感，长期是隐患。

---

## §6 动手实验（10 分钟，不改任何代码）

**前提**：用你的域名在**电脑浏览器**打开网站（Chrome/Edge），先登录。手机上看不了开发者工具。

**实验目的**：亲眼看到 §4 表格里第 3、4、11、12 步。

1. 按 `F12` 打开开发者工具 → 切到 **Network（网络）** 面板 → 勾上 `Fetch/XHR` 过滤。
2. 页面刷新一次。会看到两个请求：`tasks` 和 `checkins`（都是 GET）。
   **点开 `checkins`**，看 **Response** 里的 JSON——这就是 `CheckinOverview`。注意找这些字段：
   - `today.doneTaskIds`：今天已勾的任务 id 列表
   - `today.complete`：今天是否已盖章（`false`）
   - `week`：7 个元素，每一天的 `complete` / `doneCount` / `totalCount`
   - `stats.current`：当前连续天数
3. **现在勾上第一个任务**。立刻看 Network 里冒出来的 **POST `checkins`**：
   - 点 **Payload/请求负载** → 应该看到 `{"taskId":"...","done":true}`，**确认里面没有日期**
   - 点 **Headers** → 找到 `authorization: Bearer ...`，那就是你的登录凭证
   - 看 **Response** → 对比第 2 步，观察 `today.doneTaskIds` 多了这个 id，`stats` 变了吗？
4. **把剩下的任务全部勾完**。勾最后一个的瞬间，观察 Response 里 `today.complete` 变成 `true`。
   **这就是 §4 表格第 10 步"盖章"发生的时刻。**
5. **再取消勾选一个**。看 Response，`today.complete` 变回 `false`——服务器执行了 `DELETE FROM kv WHERE key='rec_...'`，印章被撤销。

**观察报告**：把第 3 步的请求体和响应体，各贴几条字段出来。

**加分题（SQL 翻译）**：把"查出 mashuai 这个用户本周一（20260914）勾了哪些任务"写成一条 SQL。提示：看 §3.5 的 ①。

---

## §7 检验理解（答完再进下一章）

**Q1** 一句话回答：这个项目的"打卡成功"这件事，在数据库里**具体是什么变化**？

**Q2** 前端 `src/` 里的代码跑在**谁的设备**上？后端 `backend/` 里的代码跑在**哪里**？两者靠什么通信？

**Q3** 用户"补打昨天的卡"这件事，为什么在这个项目里**做不到**？（提示：不是靠校验，是靠结构）

**Q4** 如果同时勾选两个不同任务，为什么可能丢一个勾？根因是哪三个字？

**Q5** 判断对错并说明理由：`rec_mashuai_20260917` 这条记录的 value 里存着 `{"completedAt":"..."}`，那么统计连续打卡天数时，程序需要读取这些 value 吗？

---

## 本章术语速查

| 术语 | 通俗解释 |
|---|---|
| 前端 / 后端 | 前端 = 跑在用户浏览器里的代码（画界面）；后端 = 跑在服务器上的代码（管数据、定规则） |
| API / 接口 | 后端对外开放的"窗口"，每个窗口有地址（如 `/api/checkins`）和接受的方法（GET/POST） |
| 云函数 | 一种后端，不用自己买服务器，平台按请求次数计费和扩容 |
| KV 存储 | 键值存储。只有"名字→内容"两列，像一本字典 |
| PostgREST | 把 PostgreSQL 数据库包装成 HTTP 接口的中间件，让你能用"网址+参数"来查库 |
| upsert | update + insert。有则更新，无则插入 |
| 乐观更新 | 不等服务器确认，先在界面上把结果显示出来；失败了再回滚 |
| 鉴权 / token | 证明"你是谁"。登录后服务器发一个长随机字符串（token），之后每次请求都带上它 |
| 哈希 / PBKDF2 | 把密码变成不可逆的乱码存起来。PBKDF2 是故意算得慢的哈希，让暴力破解变贵 |
| XSS | 攻击者往网页里注入恶意 JS 脚本，偷取用户数据 |
| CORS | 浏览器的安全规则，规定"哪些别的网站可以调用这个接口" |

---

**上一章**：（无，本章是第一章）
**下一章**：数据库层深入 —— `kv.mjs` / `kv-cloudbase.mjs` 的完整实现，以及"为什么要在关系库上做一层 KV"
