# PITCH — AI Agent × x402 链上支付底座

> Avalanche Buildathon · 方向四「身份·信任·AI 基础设施」· 1000 USDT 奖池
> 提交截止 2026-10-01 05:59 (Asia/Shanghai) · Demo Day 10-11

## 一句话

**让 AI Agent 干活后自动付钱**——把 HTTP 402「Payment Required」复活成开放支付标准，Agent 完成任务即通过 x402 发起链上微支付，无需账号、无需订阅、无需 API key。

## 解决的问题

AI Agent 生态里最痛的一环是**付费**：

- 今天 Agent 调付费 API 要注册账号、绑定信用卡、谈合同——机器不配拥有支付能力
- 微支付（几厘钱一次调用）没有靠谱的收款通道
- 链上支付很贵、很慢、很麻烦——普通钱包每笔都要 gas、要签名、要等确认

x402 标准 + Avalanche 的高性能 C-Chain 正好解决：**HTTP 层声明价格，Agent 签名授权，服务端广播结算，gas 由服务商付**。

## 我们做了什么

一个**完整可运行**的 x402 支付底座，部署在 Avalanche Fuji：

| 层 | 实现 | 亮点 |
|---|---|---|
| 前端 | Next.js 16 + AvaKit | 钱包连接（Core/社交/burner 零门槛），演示 Agent 支付闭环 |
| 协议 | `lib/x402/` 完整 V2 实现 | PaymentRequired / PaymentPayload / SettlementResponse 三 header，Base64 传输 |
| 受保护 API | `POST /api/agent-task` | 无签名 → 402 挑战；带签名 → 返回任务结果 |
| Facilitator | `/api/x402/verify` + `/settle` | 链下验签（EIP-712）→ 链上广播 EIP-3009 结算 |
| 链上 | `AgentToken`（EIP-3009 ERC-20）+ `AgentPayments`（收款池+审计） | gasless 授权、可查账、可退款 |

## 为什么是 Avalanche

- **x402 官方支持多链**，但 Fuji 有完善的开发者工具链（AvaKit / eERC / Builder Hub），Demo 闭环 10 分钟可跑通
- **EIP-3009 gasless 授权**天然适配「Agent 无 gas 钱包」场景——这是 x402 exact 方案在 EVM 的标准做法，我们用 Avalanche 作为首发落地链
- **eERC 隐私代币**作为可选结算资产，为「Agent 付款隐私」留出延伸空间（项目内第二 Tab 已集成）

## 技术复杂度亮点

1. **完整 x402 V2 协议实现**（非玩具 demo）：三 header 编解码、exact 方案、EIP-712 域分隔符、nonce 防重放
2. **EIP-3009 端到端**：Agent 链下签名 → 服务端链上广播 → 一笔交易完成结算
3. **可审计收款池**：`AgentPayments` 合约记录每笔 paymentId → payer/amount/token/时间，支持退款
4. **一键部署**：`compile:x402` + `deploy:x402`，测试币到账即上链

## 演示脚本（Demo Day 现场）

1. 打开 dApp → 连接钱包（burner 一键）
2. 选任务（生成周报/研究摘要/代码审查）→ 点「① 发起任务」
3. 看到 **HTTP 402 挑战**（价格 0.001 AGT、收款池地址、Fuji 网络）
4. 点「② 签名授权并支付」→ 钱包弹窗签名（无 gas 消耗）
5. 自动重试 → 展示**结算回执**（PAYMENT-RESPONSE）+ **任务结果**
6. （可选）切到「隐私代币 eERC」Tab 展示第二能力

## 四赛复用

同一底座，换链换壳即可再投三场：

| 比赛 | 截止 | 调整 |
|---|---|---|
| Avalanche Buildathon | 10/1 | 本投（Fuji 部署） |
| BNB Hack Online | 长期 | BSC + 原生 BNB 结算 |
| X-Agent MCP Hackathon | 在线 | 402 流程封装为 MCP 工具 |
| Binance Agentic AI Challenge | 11/13 | 同底座 + Binance 链 |

## 链接

- 项目目录：`E:\gitproject\avalanche-agent`
- PRD：https://my.feishu.cn/docx/JxvkdQMNWo2g00x8Y3acIqoInRc
- 参赛手册：https://my.feishu.cn/wiki/IlZVwrU5di0eetkZsdAcK3hSnqd
