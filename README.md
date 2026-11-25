# AI Mock Interview

> 一个会看你简历出题、会层层追问、会打分复盘的技术岗 AI 模拟面试官。

背完八股，一被追问就卡住？面试挂了却不知道原因？这个项目把真实面试中“出题 → 追问 → 评价”的过程交给 AI。你可以在真正面试之前，先被同一套问题问一遍，再拿到一份可以照着做的改进清单。

- **按简历出题**：上传 PDF / Word 简历或直接粘贴文本，大约一半题目来自你简历里的具体项目，另一半是和岗位、JD 相关的八股题和场景题。
- **层层追问**：回答模糊就追问具体数据，回答得好就继续往深挖，每题最多追问 3 层。
- **四维评分**：从准确性、深度、实战关联、表达四个维度给每题打 1–5 分，并指出遗漏的要点。
- **复盘报告**：给出总分、各维度得分、最需要补的 3 个弱项及补法，并可逐题回看问答和参考要点。
- **能力成长**：首页展示总分趋势、各维度相比之前的变化，以及反复出现的弱项，可按岗位筛选。
- **专项练习**：针对反复出现的弱项，一键出 3 道围绕该知识点的题，并跟踪练习后的得分。
- **Skill 题包**：用一个 Markdown 文件描述“某类面试怎么面”——出题指引、评分要点和精选题，按岗位和级别自动选用。内置 Java 后端校招、前端校招两个题包，欢迎贡献更多方向，见 [packs/README.md](packs/README.md)。
- **面经题库**：粘贴或上传真实面经，AI 整理成题目和参考要点，并标出与题库重复的题；开始面试时优先从题库里挑题，考得少的优先。
- **任意模型**：支持所有 OpenAI 兼容接口，包括 DeepSeek、通义千问、Kimi，也可以接你自建的模型网关。
- **轻量**：前端 React + Vite，后端是零依赖的 Node 服务，不需要数据库。

## 快速开始

需要 Node.js 20.19+。

```bash
git clone https://github.com/a-xiaoyuan/ai-mock-interview.git
cd ai-mock-interview
npm install
npm run dev
```

打开 http://localhost:5173 。`npm run dev` 会同时启动 Vite 开发服务器（5173）和后端 API 服务（3000），Vite 会把 `/api` 请求转发给后端。

部署或日常使用时，先构建再启动，只需要一个端口：

```bash
npm run build
npm start          # 打开 http://localhost:3000
```

不配置模型也能运行：此时为 **mock 模式**，题目是固定的，分数按回答长度粗略给出，适合先体验流程。

## 接入模型

把 `.env.example` 复制为 `.env`，然后填写：

```bash
LLM_BASE_URL=https://api.deepseek.com/v1
LLM_API_KEY=sk-xxxx
LLM_MODEL=deepseek-chat
```

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `LLM_BASE_URL` | OpenAI 兼容接口地址 | `https://api.deepseek.com/v1` |
| `LLM_API_KEY` | API Key；不填则进入 mock 模式 | 空 |
| `LLM_MODEL` | 出题、评分、复盘用的模型，建议选推理强的 | `deepseek-chat` |
| `LLM_FAST_MODEL` | 面试官说话用的模型，建议选响应快的 | 同 `LLM_MODEL` |
| `LLM_JSON_MODE` | 模型支持 `response_format: json_object` 时设为 `1` | `0` |
| `PORT` | 服务端口 | `3000` |

常用接口地址：

| 服务商 | `LLM_BASE_URL` | 示例模型 |
| --- | --- | --- |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` |
| 通义千问 | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen-plus` |
| Kimi | `https://api.moonshot.cn/v1` | `moonshot-v1-8k` |

API Key 只保存在服务端，不会发送到浏览器。

## 工作原理

面试官由 4 个分工明确的 Agent 组成，而不是一个大 Prompt。提问和打分由不同的 Agent 负责，避免面试官“自己出题、自己夸”。

```
简历 + JD ──▶ Planner 生成大纲
                  │
                  ▼
          Interviewer 提问 ◀──────────────┐
                  │                       │ 追问（每题 ≤ 3 层）
                  ▼                       │
             候选人回答 ──▶ Judge 评分 ────┤
                                          │ 下一题
                                          ▼
                              全部结束 ──▶ Reviewer 复盘报告
```

| Agent | 接口 | 职责 |
| --- | --- | --- |
| Planner | `POST /api/plan` | 根据简历、JD、岗位和级别生成题目，以及每题的参考要点 |
| Interviewer | `POST /api/ask` | 以流式输出面试官的下一句话：开场、追问或换题 |
| Judge | `POST /api/judge` | 根据整道题的问答链打分，并决定继续追问还是换题，以 JSON 输出 |
| Reviewer | `POST /api/report` | 汇总全场，写出总体评价、亮点和弱项建议 |
| Extractor | `POST /api/extract` | 把面经原文整理成题目和参考要点，再与已有题库对照判重 |

评分标准（每个维度 1–5 分）：

| 维度 | 看什么 |
| --- | --- |
| 准确性 | 事实和原理是否正确 |
| 深度 | 是否讲到底层机制、边界条件和取舍 |
| 实战关联 | 是否结合自己的项目，有没有具体数据 |
| 表达 | 是否先说结论再展开，条理是否清楚 |

所有 Prompt 都集中在 `server.js` 的 `PROMPTS` 对象里，方便修改和试验。

## 项目结构

```
.
├── server.js                  # 后端：API、Agent Prompt、模型调用、mock 模式，生产环境同时托管 dist/
├── lib/packs.js               # 题包的解析、校验与加载（后端和校验脚本共用）
├── packs/                     # Skill 题包（Markdown），格式与贡献方式见 packs/README.md
├── src/
│   ├── App.tsx                # 页面切换：配置 → 面试 → 报告
│   ├── api.ts                 # 后端接口与流式读取
│   ├── hooks/useInterview.ts  # 面试流程状态机：提问、追问、换题、结束
│   ├── components/            # SetupPage / InterviewPage / ReportPage / BankPage 等页面组件
│   ├── lib/                   # 计分、历史记录、成长统计、简历文件解析（pdf.js / mammoth，在浏览器本地完成）
│   └── types.ts
├── evals/                     # 评分回归集：judge-cases.json 用例、baseline.json 基线
├── scripts/                   # eval-judge.mjs 评分回归（npm run eval）、check-packs.cjs 题包校验
├── index.html                 # Vite 入口
├── vite.config.mts            # 开发时把 /api 转发到 3000 端口
└── .env.example               # 配置模板
```

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发模式，前端热更新，后端改动自动重启 |
| `npm run build` | 类型检查并构建前端到 `dist/` |
| `npm start` | 启动后端，并托管已构建的前端 |
| `npm run typecheck` | 只做 TypeScript 类型检查 |
| `npm run eval` | 评分回归：需先启动服务，用固定问答检查评分是否跑偏 |
| `npm run check-packs` | 检查 `packs/` 下题包的格式 |

面试历史和面经题库都保存在浏览器的 localStorage 里，服务端不存储任何数据。

## 评分回归

改了 Judge 的 Prompt 或换了模型，评分可能悄悄变松或变严。`evals/judge-cases.json` 里有一组固定的问答，覆盖高质量回答、长篇空话、自信但错误、直接说不会、简略但正确、项目回答空泛等情况，每个用例写明各维度和总分的预期区间，以及该追问还是换题；另外列出几组“好答案必须高于差答案”的对比。

```bash
npm start                              # 先启动服务（读取 .env 里的模型配置）
npm run eval                           # 每个用例跑 3 次
npm run eval -- --runs 5 --only cache-strong,cache-verbose-empty
npm run eval -- --save-baseline        # 确认结果没问题后，保存为新的基线
npm run eval -- --pack java-backend-campus   # 带上题包的评分要点，检查它会不会把通用评分带偏
```

脚本会报告每个用例是通过、不稳定（多次结果不一致）还是失败，检查好坏对比是否成立，并和 `evals/baseline.json` 对比，标出平均总分变化 ≥ 2 或某个维度变化 ≥ 1 的用例。有用例失败或对比不成立时退出码为 1，可以放进 CI。

建议的流程：改 Prompt 前先跑一遍确认基线，改完再跑；有漂移时看是变好了还是变坏了，确认变好再 `--save-baseline`。提 Prompt 相关的 PR 时，请附上前后两次的运行结果。新增用例时，区间要宽到能容忍正常波动，又要窄到能抓住明显跑偏。

## Roadmap

- [x] PDF 简历解析（在浏览器本地提取文字，不上传文件）
- [x] Word（.docx）简历解析
- [ ] 扫描件 OCR
- [ ] 语音面试：流式 ASR + TTS
- [ ] 视频面试：摄像头、录像回放、仪态建议（在浏览器本地分析）
- [x] 面经上传：把真实面经整理成题目，确认后加入题库，出题时优先使用
- [x] Skill 题包：把“某类面试怎么面”写成可版本管理的题包，支持社区贡献
- [x] 评分回归集：修改 Prompt 或更换模型前，先自动检查评分是否漂移
- [x] 能力成长曲线
- [x] 专项练习：针对弱项的知识点短练
- [ ] 算法手撕：在线编辑器 + 沙箱执行

## 参与贡献

欢迎提 Issue 和 PR，以下几类尤其需要：

- **Prompt 改进**：附上改动前后的面试记录对比和 `npm run eval` 结果，说明好在哪里。
- **评分用例**：在 `evals/judge-cases.json` 里补充容易评错的回答。
- **新岗位方向**：写一个 Skill 题包，补充对应岗位的出题指引、评分要点和精选题，见 [packs/README.md](packs/README.md)。
- **Bug 修复**：请写明复现步骤，以及所用的模型和服务商。

## 说明

- AI 的评分和参考要点仅供练习参考，可能有错，不代表任何公司的真实标准。
- 上传的简历文件只在浏览器本地读取；提取出的文字会随出题请求发送给你配置的模型服务商，请按需对个人信息做脱敏。

## License

[MIT](LICENSE)
