# x402 Agent Gateway · AI Agent 链上微支付底座

> **Monad Metropolis Hackathon 参赛项目** · Consumer Products and Payments 赛道 · 截止 2026-10-13
> 同一底座多赛复用：Monad（本投）/ Colosseum（Base 版）/ Avalanche（已投）

**产品一句话**：让 AI Agent 完成任务后，通过 x402 开放支付标准自动发起链上微支付——无需账号、无需 API key、无需订阅；Agent 签名 gasless（EIP-3009），结算服务端广播，链上全程可审计。

**差异化卖点（对标同赛道获奖项目）**：不止是「又一个 x402 网关」——本产品把 Agent 支付的**收款端**做成可审计收款池（`AgentPayments`：逐笔 paymentId → payer/amount/token，支持对账/退款），并完整落地 **EIP-3009 委托授权**（Agent 用无 gas 的钱包离线签名、gas 由服务商付）。这相当于把「机器自主花钱」从协议层一直打通到服务商账本层。

---

## 官方标准背书（为什么这不是玩具 demo）

- **100% x402 V2 协议实现**（官方三 header：`PAYMENT-REQUIRED` / `PAYMENT-SIGNATURE` / `PAYMENT-RESPONSE`），exact 方案 + EIP-712 域分隔 + nonce 防重放——对齐 [x402 官方规范](https://docs.x402.org)
- **收款池 = 官方 `batch-settlement` scheme 的落地**：x402 官方三大支付方案之一（批量结算、离线 voucher、链上批量入账），我们的 `AgentPayments` 就是它的账本实现
- **paymentId = 官方 `Payment Identifier` extension**：官方标准明确支持"为支付附加唯一 ID 用于追踪、对账、幂等"——本产品开箱即用
- **兼容 Google A2A x402 消息流**（payment-required → payment-submitted → payment-completed）：已实现 [A2A-x402 v0.2](https://github.com/google-agentic-commerce/a2a-x402/blob/main/spec/v0.2) Standalone Flow 三端点——`GET /api/a2a/agent-card`（AgentCard 声明 x402 extension）、`POST /api/a2a/task`（创建任务返回 `payment-required`）、`POST /api/a2a/message`（提交 `payment-submitted` → 验证结算 → 返回 `payment-completed` + receipts），agent 之间互相卖服务的标准协议开箱即用

## 场景楔子：AI 代购自动结算（主推）

**AI Agent 替用户下单 → 完成即自动向商家收款池结算 → 商家批量对账**——这是「Stripe for Agents」的第一场景：

| 场景 | 怎么用本产品 |
|---|---|
| **AI 代购自动结算** | Agent 完成一次代购即自动向服务商收款池结算，商家端批量对账/退款 |
| **数据分析 Agent 按次付费** | Agent 调数据 API，每次调用触发 402 → 签名 → 结算，替代 API key/订阅 |
| **IoT 设备按次推理付费** | 设备钱包离线签名，为单次模型推理付几厘钱，无需设备持 gas |
| **AI 信用/声誉服务** | 把支付与身份/信任层组合，形成 agent 之间的商业闭环 |

## 为什么是 Monad

- **Monad 官方背书 x402**：Monad 生态亲自办过 **Blitz SF = x402 Edition** 黑客松，Consumer Products and Payments 赛道认这个方向
- **EIP-3009 gasless 授权**天然适配「Agent 无 gas 钱包」——这是 x402 exact 方案在 EVM 的标准做法
- **Monad 高性能 EVM**：亚秒级出块 + 低 gas，正好承载 Agent 经济的高频微支付

## 核心链路（演示闭环）

```
Agent 发起任务 ──▶ API 返回 402 + PAYMENT-REQUIRED（价格/收款地址/网络）
      │
      ▼
Agent 钱包签名 EIP-3009 transferWithAuthorization（gasless，链下）
      │
      ▼
Agent 带 PAYMENT-SIGNATURE 重试 ──▶ 服务端 verify → 链上结算 → 返回结果 + PAYMENT-RESPONSE
```

- **前端**：Next.js 16 + 钱包连接（burner 零门槛试用）
- **支付层**：x402 V2 协议完整实现（`lib/x402/`）——types / Base64 编解码 / server / client / facilitator
- **链上层**：`AgentToken`（EIP-3009 ERC-20）+ `AgentPayments`（结算收款池，可查询审计轨迹、可退款）
- **Facilitator**：`POST /api/x402/verify`（链下验签）+ `POST /api/x402/settle`（链上广播结算）

## 快速开始

```bash
# 1. 安装依赖
npm install --legacy-peer-deps

# 2. 本地运行（demo 模式无需测试币、无需部署）
npm run dev          # http://localhost:3000

# 3. 端到端验证（对着运行中的 dev server）
npm run smoke:x402   # 402 → 签名 → verify → 结算 全链路
```

浏览器打开后：连接钱包（burner 零门槛）→ 选任务 → ① 发起任务（触发 402）→ ② 签名授权并支付 → 看结算回执 + 任务结果。

### 免费领取测试代币（Faucet）

工作台左侧内置 **「领取 1 AGT」** 按钮——评审/访客用自己的钱包一键领取测试代币，即可真实支付跑通全链路。

```bash
# API：POST /api/faucet  { "address": "0x..." }
# demo 模式：返回 mock 领取成功（无链上交易）
# 真实模式（X402_DEMO=false + X402_DEPLOYER_PRIVATE_KEY）：链上 mint 1 AGT，返回 tx hash
```

## 部署到 Monad（测试网 Chain ID 10143 / 主网 Chain ID 143）

```bash
# 1. 编译合约（已产出 scripts/artifacts/*.json）
npm run compile:x402

# 2. 测试网部署（需要测试网 MON 作为 gas）
MONAD_TESTNET=1 DEPLOYER_PRIVATE_KEY=<YOUR_PRIVATE_KEY> npm run deploy:x402

# 3. 主网部署（需要真实 MON）
DEPLOYER_PRIVATE_KEY=<YOUR_PRIVATE_KEY> npm run deploy:x402

# 4. 配置环境变量（.env.local）
X402_TOKEN=<AgentToken 地址>
X402_PAYTO=<AgentPayments 地址>
X402_DEMO=false            # 关闭 demo 模式，走真实链上结算

# 5. 给测试钱包铸币（演示用）
DEPLOYER_PRIVATE_KEY=<YOUR_PRIVATE_KEY> TOKEN=<AgentToken> TO=<钱包> AMOUNT=100 npm run mint:x402
```

**网络参数**：

| 项 | 测试网 | 主网 |
|---|---|---|
| Chain ID | 10143 | 143 |
| RPC | `https://testnet-rpc.monad.xyz` | `https://rpc.monad.xyz` |
| Explorer | MonadScan | [monadscan.com](https://monadscan.com) |

## 环境变量（.env.local）

| 变量 | 说明 |
|---|---|
| `X402_TOKEN` | 结算代币地址（AgentToken） |
| `X402_PAYTO` | 收款池地址（AgentPayments） |
| `X402_AMOUNT` | 每任务价格（原子单位，默认 0.001 AGT） |
| `X402_DEMO` | demo 模式（默认 true，无需链上交易即可演示） |
| `X402_DEPLOYER_PRIVATE_KEY` | Facilitator 钱包私钥（付 gas 广播结算） |
| `MONAD_TESTNET` | 脚本开关：置 1 走测试网（10143），否则主网（143） |

## 架构

```
┌─ 前端 Next.js 16（钱包连接/burner）────────────────────────┐
│  ① 发起任务 → 收到 402 挑战                                     │
│  ② 钱包签名 EIP-3009（gasless）                                │
│  ③ 带 PAYMENT-SIGNATURE 重试 → 结果 + PAYMENT-RESPONSE        │
├─ 支付层 lib/x402（V2 协议）─────────────────────────────────┤
│  PaymentRequired / PaymentPayload / SettlementResponse       │
│  server（挑战+验证）· client（签名+重试）· facilitator（结算）   │
├─ API 路由（Next.js App Router）─────────────────────────────┤
│  /api/agent-task（受保护资源）· /api/x402/verify · /api/x402/settle │
│  /api/faucet（免费领取 1 AGT 测试代币）                       │
│  /api/a2a/*（A2A x402 v0.2：agent-card / task / message）     │
└─ 链上结算（Monad）──────────────────────────────────────────┘
   AgentToken（EIP-3009 ERC-20） → AgentPayments（收款池+审计）
```

## 竞品定位

本产品**不是** facilitator 平台（区别于 Corbits 这类 x402 商户仪表盘/开发者平台），而是**场景产品**：面向"AI 代购/数据 API/IoT 按次付费"的具体生意，把收款池账本（对账/退款/批量结算）做成开箱即用的能力。

## 参考与借鉴

- **x402 官方**：https://docs.x402.org（规范 + batch-settlement scheme + Payment Identifier extension + `@x402/*` SDK）
- **Coinbase x402**：`github.com/coinbase/x402`（官方参考实现，Apache 2.0）
- **Google A2A x402**：`github.com/google-agentic-commerce/a2a-x402`（A2A × x402 扩展，MIT）
- **Superfluid x402-sf**：`github.com/superfluid-org/x402-sf`（EF 官方点名：标准协议 + value-added 叠加范式，MIT）
- **Corbits**：`corbits.dev`（同赛道竞品，用于差异化定位）

## 多赛复用

| 比赛 | 状态 | 复用点 |
|---|---|---|
| Monad Metropolis（10/13 截止） | **本投** | Consumer Products and Payments 赛道，部署 Monad |
| Colosseum Crypto World's Fair（10/12 截止） | 同底座 Base 版 | Base Sepolia 部署 + 同套场景 |
| Avalanche Buildathon（已投） | 已提交 | Fuji 已部署，评审 10/1-10/8 |
| BNB Hack Online（长期） | 待投 | 换 BSC 网络参数 + 原生 BNB 结算 |

## 目录结构

```
app/            Next.js App Router（页面 + API 路由）
components/     Agent 支付演示面板
contracts/      AgentToken.sol（EIP-3009）+ AgentPayments.sol（收款池）
lib/x402/       x402 协议实现（types/encode/server/client/facilitator/config）
scripts/        compile/deploy/mint/smoke 脚本 + artifacts
```
