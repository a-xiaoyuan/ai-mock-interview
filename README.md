# AI Mock Interview

> 一个会看你简历出题、会层层追问、会打分复盘的技术岗 AI 模拟面试官。

背完八股，一被追问就卡住？面试挂了却不知道原因？这个项目把真实面试中“出题 → 追问 → 评价”的过程交给 AI。你可以在真正面试之前，先被同一套问题问一遍，再拿到一份可以照着做的改进清单。

- **按简历出题**：大约一半题目来自你简历里的具体项目，另一半是和岗位、JD 相关的八股题和场景题。
- **层层追问**：回答模糊就追问具体数据，回答得好就继续往深挖，每题最多追问 3 层。
- **四维评分**：从准确性、深度、实战关联、表达四个维度给每题打 1–5 分，并指出遗漏的要点。
- **复盘报告**：给出总分、各维度得分、最需要补的 3 个弱项及补法，并可逐题回看问答和参考要点。
- **任意模型**：支持所有 OpenAI 兼容接口，包括 DeepSeek、通义千问、Kimi，也可以接你自建的模型网关。
- **零依赖**：只需要 Node.js 18+，不需要 `npm install`，也不需要数据库。

## 快速开始

```bash
git clone https://github.com/a-xiaoyuan/ai-mock-interview.git
cd ai-mock-interview
npm start          # 或 node server.js
```

打开 http://localhost:3000 。

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
├── server.js          # HTTP 服务、Agent Prompt、模型调用、mock 模式
├── public/
│   └── index.html     # 配置页、面试页、报告页（原生 JS，无构建）
├── .env.example       # 配置模板
└── package.json
```

面试历史保存在浏览器的 localStorage 里，服务端不存储任何数据。

## Roadmap

- [ ] PDF / Word 简历解析
- [ ] 语音面试：流式 ASR + TTS
- [ ] 视频面试：摄像头、录像回放、仪态建议（在浏览器本地分析）
- [ ] 面经上传：把真实面经拆成“主问题 + 追问链”，审核后加入题库
- [ ] Skill 题包：把“某类面试怎么面”写成可版本管理的题包，支持社区贡献
- [ ] 评分回归集：修改 Prompt 或更换模型前，先自动检查评分是否漂移
- [ ] 能力成长曲线与专项练习
- [ ] 算法手撕：在线编辑器 + 沙箱执行

## 参与贡献

欢迎提 Issue 和 PR，以下几类尤其需要：

- **Prompt 改进**：附上改动前后的面试记录对比，说明好在哪里。
- **新岗位方向**：补充对应岗位的出题倾向和评分要点。
- **Bug 修复**：请写明复现步骤，以及所用的模型和服务商。

## 说明

- AI 的评分和参考要点仅供练习参考，可能有错，不代表任何公司的真实标准。
- 简历内容会发送给你配置的模型服务商，请按需对个人信息做脱敏。

## License

[MIT](LICENSE)
