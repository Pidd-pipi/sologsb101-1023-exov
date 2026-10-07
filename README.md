# 岩茶做青与焙火工序台（gbtearock）

面向武夷岩茶初制车间与茶厂的工艺留档工具：按山场批次记录晒青、做青、杀青、揉捻、焙火各道工序的温湿度与时长参数，并组织毛茶审评与拼配。**每个山场持有一份版本化的做青 + 焙火基准，基准、做青记录、焙火道次与审评结论接成判定链**。核心动作是「**建山场（自动落 v1 基准）与茶青批次 → 排做青轮次 → 录杀青揉捻参数 → 排焙火曲线 → 录审评评分（定稿冻结判定）→ 登记拼配方案**」。

纯前端单页应用，**无后端 / 无数据库服务 / 无 API 服务**，所有数据保存在访问者本机浏览器（IndexedDB）里。

> **判定链与基准传播**
> - **基准留痕**：每个山场一份基准（做青温湿度 / 失水 / 摇青区间 + 中火 / 足火热负荷阈值），每次调整发布为新版本（v1、v2…），旧版本保留可查，同一山场仅一条生效。
> - **基准一改动**：**未定稿批次**（做青中 / 已杀青 / 已焙火）立即按新基准重算失水与火功判定、拼配候选跟着按工艺贴合度重排；**已定稿批次**（已审评）锁定定稿时的基准版本号并冻结当时判定，基准再改也不动历史结论。
> - **并发不互相覆盖**：两个标签页同时提交同一批次的做青 / 焙火记录，或同时发布基准时，后提交的一方因乐观锁版本号过期被整笔拒绝，提示「已被别人更新」，绝不盖掉对方刚录的内容；刷新后可取最新版本重试。
> - **老数据升级**：v3 升级时为没有基准留痕的老库按车间「当前值」（20-26 ℃ / 60-80% / 失水 12-20% / 中火 600、足火 1500 ℃·h）补齐每山场 v1 基准，并把已定稿批次按当时记录冻结。

---

## 一、Docker 一键启动（推荐）

```bash
# 1. 首次启动先准备环境变量
cp .env.example .env

# 2. 一条命令构建并启动
docker compose up -d --build
```

启动后访问：**http://localhost:22823**

常用命令：

| 操作 | 命令 |
| --- | --- |
| 查看状态 | `docker compose ps` |
| 查看日志 | `docker compose logs -f frontend` |
| 停止服务 | `docker compose down` |
| 改端口后重建 | 编辑 `.env` 中的 `FRONTEND_PORT` 后执行 `docker compose up -d --build` |
| 校验编排文件 | `docker compose config --quiet` |

> 顶层已写 `name: gbtearock` 兜底，即使本项目放在中文目录下，`docker compose config --quiet` 也不会因为项目名为空而报错。
> 端口覆盖：`.env` 里的 `FRONTEND_PORT` 是「宿主端口 → 容器 80」的左侧值，默认 `22823`。

---

## 二、项目简介

| 路由 | 模块 | 说明 |
| --- | --- | --- |
| `/gardens` | 山场与茶青批次台账 | 建山场（品种 / 土壤 / 海拔 / 朝向，建山场自动落 v1 基准），卡片回显批次数、鲜叶合计与审评均分；详情抽屉展示每批次的判定链（基准版本 → 失水 / 火功 → 是否冻结）；登记批次并推进工序状态；整库 JSON 导出 / 导入 |
| `/standards` | 山场工艺基准 | 每山场一份做青（室温 / 湿度 / 失水 / 摇青区间）+ 焙火（中火 / 足火热负荷阈值、足火道次）基准；发布即生成新版本、旧版留痕；发布前显示影响面（N 个未定稿批次将重算、M 个已定稿批次冻结）；并发发布晚到者被乐观锁拒绝 |
| `/turns` | 做青轮次编排 | 摇青 / 静置交替时间线与累计时长、失水率走势；失水 / 温湿度 / 摇青判定全部取山场当前基准；**HTML5 拖拽排序 + 表单提交均走批次 `turnsRev` 乐观锁**，两标签页同批提交晚到者被拒；复制上一轮参数后微调、参数模板存 / 套用 |
| `/fixing` | 杀青揉捻记录 | 锅温、杀青时长、揉捻压力与时长、操作人登记；登记后自动把批次回写为「已杀青」（未定稿，判定仍跟随基准） |
| `/roasting` | 焙火曲线与复焙安排 | 多道次按序排列（上移 / 下移写回 `passNo`）、火功档位与足火判定取山场焙火基准；提交走批次 `roastsRev` 乐观锁；复焙提醒（逾期 / 今日 / 7 日内 / 已排期） |
| `/reviews` | 毛茶审评 | 香气 30% / 汤色 20% / 滋味 35% / 叶底 15% 加权换算总分；**登记审评即定稿：锁定当前基准版本号并冻结当时失水 / 火功判定**；表格展示完整判定链；按总分排序生成拼配候选清单 |
| `/blending` | 拼配方案登记与结构版本导出 | 候选先按审评总分、再按现行基准复算的**工艺贴合度**排序（基准改动后未定稿候选跟着重排，定稿候选标「定稿冻结」）；占比校验（合计必须 100%）、方案 JSON 与整库结构版本 JSON 导出 |

批次工序状态按工序自动流转：**做青中 → 已杀青 → 已焙火 → 已审评**（只向后推进，不回退）。

---

## 三、技术栈

| 分类 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | React | 18.3 |
| 语言 | TypeScript（`strict` + `noUnusedLocals/Parameters`） | 5.6 |
| UI 组件 | Ant Design（`@ant-design/icons`） | 5.22 |
| 构建 | Vite | 5.4 |
| 状态管理 | Zustand | 4.5 |
| 路由 | React Router（`createBrowserRouter`） | 6.28 |
| 本地数据库 | Dexie（IndexedDB 封装，含结构版本号与升级迁移） | 4.0 |
| 日期处理 | dayjs | 1.11 |
| 容器 | 多阶段构建：`node:20-alpine` → `nginx:alpine` | — |

---

## 四、本地开发

```bash
cd frontend
npm install
npm run dev       # http://localhost:22823
npm run build     # tsc --noEmit && vite build（类型检查 + 生产构建）
npm run preview   # 预览 dist 产物，http://localhost:22823
```

---

## 五、目录结构

```
sologsb101-1023/
├── README.md                       # 本文档
├── docker-compose.yml              # 不写 version 字段；顶层 name: gbtearock
├── .env / .env.example             # COMPOSE_PROJECT_NAME / FRONTEND_PORT（内容一致）
├── .gitignore
├── sologsb101-1023.md              # 提示词原文（只读）
└── frontend/
    ├── Dockerfile                  # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf                  # try_files $uri $uri/ /index.html; + gzip + /assets/ 长缓存
    ├── .dockerignore
    ├── package.json / package-lock.json
    ├── tsconfig.json / vite.config.ts / index.html
    ├── public/favicon.svg
    └── src/
        ├── main.tsx                # 入口：ConfigProvider(zhCN) + AntdApp + RouterProvider
        ├── App.tsx                 # 外壳：侧边导航、当前山场/批次、行数统计、首次初始化 + 播种
        ├── vite-env.d.ts
        ├── styles/main.css         # 墨绿/茶褐/炭金主题与拖拽、时间线样式
        ├── types/                  # 实体定义（每个实体独立文件）
        │   ├── garden.ts           # 山场：name / altitudeM / soil / cultivar / aspect
        │   ├── standard.ts         # 山场工艺基准（版本化）+ ProcessJudgment 判定结构
        │   ├── batch.ts            # 茶青批次：... / standardVersionNo / finalizedAt / frozenJudgment / turnsRev / roastsRev
        │   ├── turn.ts             # 做青轮次：batchId / roundNo / shakeMin / restMin / roomTempC / humidityPct / waterLossPct / rev
        │   ├── fix.ts              # 杀青揉捻：batchId / wokTempC / fixMin / rollPressure / rollMin / operator
        │   ├── roast.ts            # 焙火：batchId / passNo / tempC / hours / charcoal / nextRoastDate / state / rev
        │   └── review.ts           # 审评：batchId / reviewedAt / 四项分 / totalScore / blendNote（候选含工艺贴合度）
        ├── stores/                 # Zustand：跨页状态全部放这里
        │   ├── gardenStore.ts      # 山场列表、派生指标、当前选中山场、筛选（建山场顺带落 v1 基准）
        │   ├── standardStore.ts    # 基准历史版本、发布新版本（CAS）、改动影响面
        │   ├── batchStore.ts       # 批次与工序流转（到「已审评」走 finalizeBatch 冻结）、审评/拼配筛选、拼配草稿
        │   ├── turnStore.ts        # 当前批次轮次、模板、拖拽重排（全部走 commitTurns 乐观锁）
        │   └── roastStore.ts       # 焙火道次顺序、复焙提醒、足火判定（全部走 commitRoasts 乐观锁）
        ├── components/common/      # 共享组件
        │   ├── GradeTag.tsx        # 嫩度 / 火功 / 评分 / 工序状态 / 焙火状态 / 揉捻压力标签
        │   ├── JudgmentChain.tsx   # 判定链：基准版本 → 失水 / 火功 → 审评结论（冻结 / 实时态）
        │   ├── FilterBar.tsx       # 关键字 + 多个下拉多选，并同步 URL query
        │   ├── StatBadge.tsx       # 统计徽标（累计时长、失水率、均分、热负荷…）
        │   └── EmptyPanel.tsx      # 空数据引导 + 主/次操作按钮
        ├── hooks/
        │   ├── useTurnTimeline.ts    # 轮次累计摇青/静置时长、交替时间线段、失水率走势
        │   ├── useProcessJudgment.ts # 全批次判定链订阅（定稿读冻结 / 未定稿按当前基准复算）
        │   └── useIdbTable.ts        # Dexie 表响应式订阅 + 增删改查封装
        ├── utils/
        │   ├── tea.ts              # 嫩度/火功枚举、固定阈值兜底判定、评分加权、拼配候选（含贴合度排序）
        │   ├── standard.ts         # 按基准的区间 / 火功 / 贴合度纯函数与判定链组装
        │   ├── db.ts               # Dexie 实例、七张表、v1-v3 迁移（v3 按当前值补基准留痕）、乐观锁提交、定稿冻结
        │   └── export.ts           # 批次工艺记录（含基准与判定）/ 整库存档 / 拼配方案 JSON 导出与校验
        ├── pages/                  # 七个页面，与路由一一对应
        │   ├── GardenList.tsx      # /gardens
        │   ├── StandardBoard.tsx   # /standards
        │   ├── TurnBoard.tsx       # /turns
        │   ├── FixRecord.tsx       # /fixing
        │   ├── RoastPlan.tsx       # /roasting
        │   ├── ReviewBoard.tsx     # /reviews
        │   └── BlendPlan.tsx       # /blending
        └── router/index.tsx        # 路由表：/ 与未知路径重定向到 /gardens，页面懒加载
```

> `frontend/scripts/` 下另有三份纯本地校验脚本（不进生产包），可用 `npx tsx scripts/<name>.ts` 运行：`verify-judgment.ts`（判定链纯函数）、`verify-db.ts`（播种 / 乐观锁 / 基准发布 / 定稿冻结）、`verify-migration.ts`（v2→v3 按当前值补齐留痕）。

---

## 六、IndexedDB 库名与数据存储说明

- **库名**：`gbtearock`（`src/utils/db.ts` 中的 `DB_NAME`）
- **结构版本号**：`DB_VERSION = 3`
  - `version(1)` 初版结构：六张分表的最小索引
  - `version(2).stores(...)` 补齐外键 / 状态 / 日期索引，并 `.upgrade()` **真实迁移历史数据**：补齐 `createdAt` / `updatedAt`、山场补齐朝向与土壤品种兜底值、批次工序状态归一化、轮次与焙火数值截断到合法区间、审评总分由「四项简单平均」改为「分项加权换算」后重算。
  - `version(3).stores(...)` 新增 `standards` 山场工艺基准表（`gardenId / versionNo / active / [gardenId+versionNo]` 索引），批次补 `standardVersionNo / finalizedAt / frozenJudgment / turnsRev / roastsRev`，轮次与焙火补行级 `rev`；`.upgrade()` **按当前值补齐基准留痕**：为每个山场补一条 v1 基准（失水 12-20%、室温 20-26 ℃、湿度 60-80%、中火 600 / 足火 1500 ℃·h），并把已定稿（已审评）批次按当时记录冻结失水 / 火功判定。
- **分表**：`gardens`、`standards`（一山场多版本基准）、`batches`、`turns`、`fixes`、`roasts`、`reviews`（每条记录都有 `id` / `createdAt` / `updatedAt`）
- **判定链**：`utils/standard.ts` 的纯函数按基准复算（室温 / 湿度 / 失水 / 摇青区间、中火 / 足火阈值、工艺贴合度）；`hooks/useProcessJudgment.ts` 用 `liveQuery` 订阅全量数据——未定稿批次用山场当前生效基准实时复算，已定稿批次直接回读 `batch.frozenJudgment`。
- **乐观锁**：批次上的 `turnsRev` / `roastsRev` 是做青 / 焙火记录集合的版本号；`commitTurns` / `commitRoasts` 在 Dexie 事务内「读批次 → 比对版本 → 写子表 → 版本号 +1」，版本不符整事务回滚并抛 `ConcurrencyConflictError`。基准发布用基准行 `rev`（沿版本链单调递增）做同样的 CAS。
- **首屏自动播种**：`initDatabase()` 中 `if ((await db.gardens.count()) === 0) { await seedDatabase() }`，播种 3 层互相引用的演示数据 —— 3 个山场（各带一条略有差异的 v1 基准）→ 4 个茶青批次（2 个已定稿并冻结、2 个跟随基准）→ 每个批次下 2-3 条做青轮次、1 条杀青揉捻、1-2 道焙火、1 条审评；播种使用固定 id + `bulkPut`，**幂等**，重复执行不会产生重复行。
- **级联删除**：删除山场会级联删除其基准（含历史版本）、批次与批次下的轮次 / 杀青 / 焙火 / 审评；删除批次会级联删除其全部工序子表（均使用 `db.transaction`）。
- **导出 / 导入**：山场页支持「导出整库 JSON / 导入 JSON」（Blob + `URL.createObjectURL` + `a.download`，导入前做结构与库名校验，老存档缺基准时按当前值补齐并冻结定稿批次，校验失败弹错误提示）；拼配页支持拼配方案 JSON 与整库结构版本 JSON 导出。
- **无命名卷、无数据库服务**：容器只托管静态文件，数据完全存在浏览器本地，换浏览器或清空站点数据即清空。

---

## 七、常见问题

1. **端口被占用**：修改 `.env` 中的 `FRONTEND_PORT`（例如 `FRONTEND_PORT=22824`）后 `docker compose up -d --build`。
2. **刷新子路由 404**：已由 `nginx.conf` 的 `try_files $uri $uri/ /index.html;` 处理，`/gardens`、`/turns` 等路径可直接刷新。
3. **favicon 403**：`public/favicon.svg` 在宿主机上是 `0600` 权限，`COPY` 会保留权限位导致 nginx worker（uid=101）读不到；`Dockerfile` 在 `COPY --from=builder /app/dist` 之后紧跟 `RUN chmod -R a+rX /usr/share/nginx/html` 归一化权限，避免 403。
4. **数据只在本浏览器**：演示数据首次打开自动生成；想恢复初始状态可在浏览器 DevTools → Application → IndexedDB 删除 `gbtearock`，或重新导入一份整库存档。
5. **修改结构版本**：调整实体字段后请把 `DB_VERSION` 加一并补充 `.upgrade()` 迁移逻辑，否则老浏览器里的历史数据不会被修正。
