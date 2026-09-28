# avalanche-agent · AI Agent × x402 链上支付底座

> Avalanche Buildathon 参赛项目 · 方向四「身份 · 信任 · AI 基础设施」
> 一套代码同时覆盖 Avalanche Buildathon / BNB Hack Online / X-Agent MCP / Binance Agentic AI 四场比赛

**产品一句话**：让 AI Agent 完成任务后，通过 x402 开放支付标准自动发起链上微支付——无需账号、无需 API key、无需订阅，签名 gasless（EIP-3009），结算服务端广播，链上全程可审计。

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

- **前端**：Next.js 16 + AvaKit（钱包连接/社交登录/burner 零门槛试用）
- **支付层**：x402 V2 协议完整实现（`lib/x402/`）——types / Base64 编解码 / server / client / facilitator
- **链上层**：`AgentToken`（EIP-3009 ERC-20）+ `AgentPayments`（结算收款池，可查询审计轨迹）
- **Facilitator**：`POST /api/x402/verify`（链下验证）+ `POST /api/x402/settle`（链上广播结算）

## 快速开始

```bash
# 1. 安装依赖（已装好；若重装需先删 pnpm-workspace.yaml）
npm install --legacy-peer-deps

# 2. 本地运行（demo 模式无需测试币、无需部署）
npm run dev          # http://localhost:3000

# 3. 端到端验证（对着运行中的 dev server）
npm run smoke:x402   # 402 → 签名 → verify → 结算 全链路
```

浏览器打开后：连接钱包（burner 零门槛）→ 选任务 → ① 发起任务（触发 402）→ ② 签名授权并支付 → 看结算回执 + 任务结果。

## 部署到 Fuji（测试币到账后执行）

```bash
# 1. 编译合约（已产出 scripts/artifacts/*.json）
npm run compile:x402

# 2. 部署 AgentToken + AgentPayments（需要 Fuji 测试 AVAX）
DEPLOYER_PRIVATE_KEY=0x... npm run deploy:x402

# 3. 配置环境变量（.env.local）
X402_TOKEN=<AgentToken 地址>
X402_PAYTO=<AgentPayments 地址>
X402_DEMO=false            # 关闭 demo 模式，走真实链上结算

# 4. 给测试钱包铸币（演示用）
DEPLOYER_PRIVATE_KEY=0x... TOKEN=<AgentToken> TO=<钱包> AMOUNT=100 npm run mint:x402
```

## 环境变量（.env.local）

| 变量 | 说明 |
|---|---|
| `NEXT_PUBLIC_WEB3AUTH_CLIENT_ID` | Web3Auth 社交登录（localhost 可用内置 demo key） |
| `X402_TOKEN` | 结算代币地址（AgentToken） |
| `X402_PAYTO` | 收款池地址（AgentPayments） |
| `X402_AMOUNT` | 每任务价格（原子单位，默认 0.001 AGT） |
| `X402_DEMO` | demo 模式（默认 true，无需链上交易即可演示） |
| `X402_DEPLOYER_PRIVATE_KEY` | Facilitator 钱包私钥（付 gas 广播结算） |

## 架构

```
┌─ 前端 AvaKit（钱包/社交登录/burner）─────────────────────────┐
│  ① 发起任务 → 收到 402 挑战                                     │
│  ② 钱包签名 EIP-3009（gasless）                                │
│  ③ 带 PAYMENT-SIGNATURE 重试 → 结果 + PAYMENT-RESPONSE        │
├─ 支付层 lib/x402（V2 协议）─────────────────────────────────┤
│  PaymentRequired / PaymentPayload / SettlementResponse       │
│  server（挑战+验证）· client（签名+重试）· facilitator（结算）   │
├─ API 路由（Next.js App Router）─────────────────────────────┤
│  /api/agent-task（受保护资源）· /api/x402/verify · /api/x402/settle │
└─ 链上结算（Fuji）────────────────────────────────────────────┘
   AgentToken（EIP-3009 ERC-20） → AgentPayments（收款池+审计）
```

## 参考与借鉴

- **x402**：Coinbase 开放支付标准（HTTP 402 复活）— `specs/x402-specification-v2.md`，EIP-3009 exact 方案
- **AvaKit**：`npm create avalanche-app`（本项目骨架），钱包适配器 + 链数据 API
- **Avalanche eERC**：`@avalabs/eerc-sdk`（隐私代币，本底座的可选隐私结算层，保留在第二 Tab）
- **Ava Labs**：HyperSDK Starter Kit / Avalanche Starter Kit / Builder Hub faucet

## 四赛复用

| 比赛 | 状态 | 复用点 |
|---|---|---|
| Avalanche Buildathon（截止 10/1） | 主打 | 完整项目，部署 Fuji |
| BNB Hack Online（长期，双周评审） | 待投 | 换 BSC 网络参数 + 原生 BNB 结算 |
| X-Agent AI MCP Hackathon 2026 | 待投 | 把 402 流程封装为 MCP 支付工具 |
| Binance Agentic AI Challenge | 待投 | 同一底座 + Binance 链部署 |

## 目录结构

```
app/            Next.js App Router（页面 + API 路由）
components/     Agent 支付演示面板 / eERC 面板
contracts/      AgentToken.sol（EIP-3009）+ AgentPayments.sol（收款池）
lib/eerc-config.ts  eERC 电路配置（原模板）
lib/x402/       x402 协议实现（types/encode/server/client/facilitator/config）
scripts/        compile/deploy/mint/smoke 脚本 + artifacts
```
