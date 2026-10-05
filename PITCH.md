# PITCH — x402 Agent Gateway：AI Agent 链上微支付底座

> Monad Metropolis · Consumer Products and Payments 赛道 · $250k+ 奖池 · 截止 2026-10-13
> 同一底座多赛复用：Monad（本投）/ Colosseum（Base 版）/ Avalanche（已投）

## 一句话

**让 AI Agent 干活后自动付钱**——把 HTTP 402「Payment Required」复活成开放支付标准，Agent 完成任务即通过 x402 发起链上微支付，无需账号、无需订阅、无需 API key，签名 gasless（EIP-3009），链上全程可审计。

## 官方标准背书

- 完整实现 **x402 V2 官方三 header 协议**（`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`），exact 方案 100% 合规（[docs.x402.org](https://docs.x402.org)）
- **收款池 = 官方 `batch-settlement` scheme 的账本落地**（批量结算/离线 voucher/链上入账）
- **paymentId = 官方 `Payment Identifier` extension**（追踪/对账/幂等）
- **兼容 Google A2A x402 消息流**（payment-required → payment-submitted → payment-completed）

## 解决的问题

AI Agent 生态里最痛的一环是**付费**：

- 今天 Agent 调付费 API 要注册账号、绑定信用卡、谈合同——机器不配拥有支付能力
- 微支付（几厘钱一次调用）没有靠谱的收款通道
- 链上支付很贵、很慢、很麻烦——普通钱包每笔都要 gas、要签名、要等确认

x402 标准 + Monad 高性能 EVM 正好解决：**HTTP 层声明价格，Agent 签名授权，服务端广播结算，gas 由服务商付**。

## 商业模式一页纸

**卖的不是 SDK，是"机器经济的收款管道"**——本项目 = 一个即插即用的 Agent 支付网关 + 链上可审计收款池：

| 角色 | 付费模式 | 我们的位置 |
|---|---|---|
| **Agent 开发者** | pay-per-call：每次调用按价付款，无预充值/无订阅 | 替代 API key 管理、替代 Stripe 式订阅计费 |
| **服务商/API 提供方** | 网关抽成：结算金额的 x% | 收款池集中收付、链上对账，省掉传统支付通道费 |
| **企业 Agent 平台** | 批量结算：一个池子管所有 agent 的支出 | 天然适配 IoT/数据/电商批量微支付 |

**对比传统方案**：信用卡每笔 2.9%+固定费、订阅按月死锁、API key 泄露即被盗刷——x402 + EIP-3009 是**按次、gasless、链上可审计**的机器友好支付。

## 差异化（相对同赛道 x402 项目）

同赛道获奖项目多是「网关/单向支付」（对标：Solana x402 五强、ETHGlobal x402 系列）。本产品多出两层：

1. **收款池批量结算**（`AgentPayments` 合约）：逐笔 paymentId → payer/amount/token 可查、可对账、可退款——服务商账本层，不只是支付协议层（官方 `batch-settlement` + `Payment Identifier` 的落地）
2. **EIP-3009 委托授权全链路落地**：Agent 用无 gas 钱包离线签名，Facilitator 垫 gas 广播——「机器不用管 gas」从白皮书落到真跑通的代码

叠加范式对齐 EF 官方点名的 x402-sf（标准协议 + value-added 服务层），我们把 value-added 层做成**收款池账本**而非实时流——服务商真正需要的对账/退款能力。

## 我们做了什么

一个**完整可运行**的 x402 支付底座，面向 Monad 部署：

| 层 | 实现 | 亮点 |
|---|---|---|
| 前端 | Next.js 16 + 钱包连接（burner 零门槛） | 演示 Agent 支付闭环 + buy-order 代购场景 |
| 协议 | `lib/x402/` 完整 V2 实现 | 官方三 header，Base64 传输，exact 方案 + EIP-712 + nonce |
| 受保护 API | `POST /api/agent-task` | 无签名 → 402 挑战；带签名 → 返回任务结果 |
| Facilitator | `/api/x402/verify` + `/settle` | 链下验签（EIP-712）→ 链上广播 EIP-3009 结算 |
| 链上 | `AgentToken`（EIP-3009 ERC-20）+ `AgentPayments`（收款池+审计） | gasless 授权、可查账、可退款 |

## 为什么是 Monad

- **Monad 官方背书 x402**：Blitz SF 黑客松就是 x402 Edition——Monad 基金会亲自办过这个方向，Consumer Products and Payments 赛道点名认可
- **EIP-3009 gasless 授权**天然适配「Agent 无 gas 钱包」——x402 exact 方案在 EVM 的标准做法
- **Monad 高性能**：亚秒级出块 + 低 gas，承载 Agent 经济高频微支付的正确底座
- 部署目标：Monad 主网（chainId 143，MON）/ 测试网（10143），Explorer 见 [monadscan.com](https://monadscan.com)

## 技术复杂度亮点

1. **完整 x402 V2 协议实现**（非玩具 demo）：官方三 header 编解码、exact 方案、EIP-712 域分隔符、nonce 防重放
2. **EIP-3009 端到端**：Agent 链下签名 → 服务端链上广播 → 一笔交易完成结算
3. **可审计收款池**：`AgentPayments` 合约记录每笔 paymentId → payer/amount/token/时间，支持退款
4. **多链就绪**：同一套 Solidity + 协议层已支持 Monad / Base / Avalanche 三链，一键切换部署

## 演示脚本（Demo Day 现场）

1. 打开 dApp → 连接钱包（burner 一键）
2. 选任务（AI 代购下单 / 数据分析 / 代码审查）→ 点「① 发起任务」
3. 看到 **HTTP 402 挑战**（价格 0.001 AGT、收款池地址、网络）
4. 点「② 签名授权并支付」→ 钱包弹窗签名（无 gas 消耗）
5. 自动重试 → 展示**结算回执**（PAYMENT-RESPONSE）+ **任务结果**
6. 切到收款池视图 → 看到这笔 paymentId 入账，可查可对账

## 多赛复用

同一底座，换链换壳即可再投多场：

| 比赛 | 截止 | 调整 |
|---|---|---|
| Monad Metropolis | 10/13 | **本投**（Monad 部署） |
| Colosseum Crypto World's Fair | 10/12 | Base Sepolia 部署 + 同套场景 |
| Avalanche Buildathon | 已投 | Fuji 已部署 |
| BNB Hack Online | 长期 | BSC + 原生 BNB 结算 |

## 链接

- GitHub：https://github.com/HpIahtcthocw/x402 （monad 分支）
- 项目目录：`E:\gitproject\avalanche-agent`
