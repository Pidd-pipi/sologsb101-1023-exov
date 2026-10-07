# 岩茶做青与焙火工序台（gbtearock）

面向武夷岩茶初制车间与茶厂的工艺留档工具：按山场批次记录晒青、做青、杀青、揉捻、焙火各道工序的温湿度与时长参数，并组织毛茶审评与拼配。核心动作是「**建山场与茶青批次 → 排做青轮次（摇青与静置交替）→ 录杀青揉捻参数 → 排焙火曲线与复焙安排 → 录审评评分 → 登记拼配方案**」。

纯前端单页应用，**无后端 / 无数据库服务 / 无 API 服务**，所有数据保存在访问者本机浏览器（IndexedDB）里。

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
| `/gardens` | 山场与茶青批次台账 | 建山场（品种 / 土壤 / 海拔 / 朝向），**每个山场维护一份版本化做青 / 焙火基准（可改版留痕）**，卡片回显批次数、鲜叶合计与审评均分；批次带判定链（基准 → 做青失水 → 焙火火功 → 审评结论）；登记批次并推进工序状态；整库 JSON 导出 / 导入 |
| `/turns` | 做青轮次编排 | 摇青 / 静置交替时间线与累计时长、失水率走势；失水 / 温湿度判定**按所属山场当前基准**；**编辑乐观锁（rev），两个标签页晚到提交会被拒绝，不覆盖对方刚录的记录**；HTML5 原生拖拽排序写回 `roundNo`；复制上一轮参数后微调、参数模板存 / 套用 |
| `/fixing` | 杀青揉捻记录 | 锅温、杀青时长、揉捻压力与时长、操作人登记；登记后自动把批次回写为「已杀青」 |
| `/roasting` | 焙火曲线与复焙安排 | 多道次按序排列（上移 / 下移写回 `passNo`）、**火功按山场焙火基准（中火 / 足火热负荷阈值）判定**、足火判定、复焙提醒（逾期 / 今日 / 7 日内 / 已排期）、判定链标签 |
| `/reviews` | 毛茶审评 | 香气 30% / 汤色 20% / 滋味 35% / 叶底 15% 加权换算总分，按总分排序；**提交审评即定稿，冻结当时基准与失水 / 火功判定（后续基准改版保住该结论）**；定稿提交带乐观锁防两个标签页互相覆盖 |
| `/blending` | 拼配方案登记与结构版本导出 | 按总分组合批次与占比、**占比校验（合计必须 100%）**、方案 JSON 与整库结构版本 JSON 导出；**已定稿候选名次冻结；另列「待定稿投影候选」，按当前基准推算投影分，基准改版立即重排** |

批次工序状态按工序自动流转：**做青中 → 已杀青 → 已焙火 → 已审评**（只向后推进，不回退）。

**判定链规则（核心）**：山场基准 → 做青失水判定 → 焙火火功判定 → 审评结论串成一条链。基准一改版，**未定稿**批次立即按新基准重算失水与火功（投影拼配候选随之重排）；**已定稿**（已审评）批次使用审评记录里冻结的基准快照与判定，结论永不改变。

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
        ├── types/                  # 实体各一文件
        │   ├── garden.ts           # 山场：name / altitudeM / soil / cultivar / aspect
        │   ├── batch.ts            # 茶青批次：gardenId / pickedAt / freshLeafKg / tenderness / weather / state
        │   ├── turn.ts             # 做青轮次：batchId / roundNo / shakeMin / restMin / roomTempC / humidityPct / waterLossPct / rev（乐观锁）/ standardRev
        │   ├── fix.ts              # 杀青揉捻：batchId / wokTempC / fixMin / rollPressure / rollMin / operator
        │   ├── roast.ts            # 焙火：batchId / passNo / tempC / hours / charcoal / nextRoastDate / state / standardRev
        │   ├── review.ts           # 审评：分项分 / totalScore / frozen（定稿冻结判定）/ rev（乐观锁）+ 拼配候选 / 待定稿投影候选
        │   └── standard.ts         # 山场做青/焙火基准（版本化）：turn / roast 阈值 + FrozenJudgment + BatchVerdict
        ├── stores/                 # Zustand：跨页状态全部放这里
        │   ├── gardenStore.ts      # 山场列表、派生指标、当前选中山场、筛选条件
        │   ├── batchStore.ts       # 批次与工序流转、杀青/审评/拼配筛选、拼配方案草稿
        │   ├── turnStore.ts        # 当前批次轮次、参数模板、拖拽重排（写回 roundNo）、乐观锁编辑
        │   ├── roastStore.ts       # 焙火道次顺序、复焙提醒、足火判定
        │   └── standardStore.ts    # 山场基准当前版与历史、改版发布
        ├── components/common/      # 共享组件
        │   ├── GradeTag.tsx        # 嫩度 / 火功 / 评分 / 工序状态 / 焙火状态 / 揉捻压力标签
        │   ├── JudgmentChain.tsx   # 判定链标签 / 卡片：基准版本 → 失水 → 火功 → 定稿结论
        │   ├── StandardPanel.tsx   # 山场当前基准展示、改版发布、历史版本留痕
        │   ├── FilterBar.tsx       # 关键字 + 多个下拉多选，并同步 URL query
        │   ├── StatBadge.tsx       # 统计徽标（累计时长、失水率、均分、热负荷…）
        │   └── EmptyPanel.tsx      # 空数据引导 + 主/次操作按钮
        ├── hooks/
        │   ├── useTurnTimeline.ts  # 轮次累计摇青/静置时长、交替时间线段、失水率走势（支持传入基准）
        │   ├── useJudgmentChain.ts # 判定链响应式派生：基准/做青/焙火/审评，定稿冻结 vs 未定稿重算
        │   └── useIdbTable.ts      # Dexie 表响应式订阅 + 增删改查封装
        ├── utils/
        │   ├── tea.ts              # 嫩度/火功枚举映射、温湿度与失水率区间判定、评分加权换算、拼配候选
        │   ├── db.ts               # Dexie 实例、七张表、version(1/2/3) 迁移、播种、基准改版/定稿提交/乐观锁、快照导入导出
        │   └── export.ts           # 批次工艺记录 / 整库存档 / 拼配方案 JSON 导出与校验
        ├── pages/                  # 六个页面，与路由一一对应
        │   ├── GardenList.tsx      # /gardens
        │   ├── TurnBoard.tsx       # /turns
        │   ├── FixRecord.tsx       # /fixing
        │   ├── RoastPlan.tsx       # /roasting
        │   ├── ReviewBoard.tsx     # /reviews
        │   └── BlendPlan.tsx       # /blending
        └── router/index.tsx        # 路由表：/ 与未知路径重定向到 /gardens，页面懒加载
```

---

## 六、IndexedDB 库名与数据存储说明

- **库名**：`gbtearock`（`src/utils/db.ts` 中的 `DB_NAME`）
- **结构版本号**：`DB_VERSION = 3`
  - `version(1)` 初版结构：六张分表的最小索引
  - `version(2).stores(...)` 补齐外键 / 状态 / 日期索引，并 `.upgrade()` **真实迁移历史数据**：补齐 `createdAt` / `updatedAt`、山场补齐朝向与土壤品种兜底值、批次工序状态归一化、轮次与焙火数值截断到合法区间、审评总分由「四项简单平均」改为「分项加权换算」后重算。
  - `version(3).stores(...)` 新增 **`standards` 山场基准表**（版本化留痕），做青 / 焙火记录补 `standardRev` 基准版本号，做青与审评记录补乐观锁 `rev`，审评记录补定稿冻结快照 `frozen`。`.upgrade()` 里**旧数据没有基准留痕，按内置当前值给每个山场补齐首版基准**，并给历史审评按当时（当前值）判定补齐冻结快照（火功=累计温度×时长、失水=末轮失水率），保住历史结论。
- **分表**：`gardens`、`batches`、`turns`、`fixes`、`roasts`、`reviews`、`standards`（每条主记录都有 `id` / `createdAt` / `updatedAt`）
- **首屏自动播种**：`initDatabase()` 中 `if ((await db.gardens.count()) === 0) { await seedDatabase() }`，播种 3 层互相引用的演示数据 —— 3 个山场 → 4 个茶青批次 → 每个批次下 2-3 条做青轮次、1 条杀青揉捻、1-2 道焙火、1 条审评，父→子→孙贯通；播种使用固定 id + `bulkPut`，**幂等**，重复执行不会产生重复行。
- **级联删除**：删除山场会级联删除其批次与批次下的轮次 / 杀青 / 焙火 / 审评；删除批次会级联删除其全部工序子表（均使用 `db.transaction`）。
- **导出 / 导入**：山场页支持「导出整库 JSON / 导入 JSON」（Blob + `URL.createObjectURL` + `a.download`，导入前做结构与库名校验，校验失败弹错误提示）；拼配页支持拼配方案 JSON 与整库结构版本 JSON 导出。
- **无命名卷、无数据库服务**：容器只托管静态文件，数据完全存在浏览器本地，换浏览器或清空站点数据即清空。

---

## 七、常见问题

1. **端口被占用**：修改 `.env` 中的 `FRONTEND_PORT`（例如 `FRONTEND_PORT=22824`）后 `docker compose up -d --build`。
2. **刷新子路由 404**：已由 `nginx.conf` 的 `try_files $uri $uri/ /index.html;` 处理，`/gardens`、`/turns` 等路径可直接刷新。
3. **favicon 403**：`public/favicon.svg` 在宿主机上是 `0600` 权限，`COPY` 会保留权限位导致 nginx worker（uid=101）读不到；`Dockerfile` 在 `COPY --from=builder /app/dist` 之后紧跟 `RUN chmod -R a+rX /usr/share/nginx/html` 归一化权限，避免 403。
4. **数据只在本浏览器**：演示数据首次打开自动生成；想恢复初始状态可在浏览器 DevTools → Application → IndexedDB 删除 `gbtearock`，或重新导入一份整库存档。
5. **修改结构版本**：调整实体字段后请把 `DB_VERSION` 加一并补充 `.upgrade()` 迁移逻辑，否则老浏览器里的历史数据不会被修正。
