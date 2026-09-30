# Colosseum Crypto World's Fair — 投递 Scope（winner-factory）

## 下注
- 档位：Conviction（ledger id=1，EV ≈ $16,800）
- 赛道：Base 生态赛道（$2.5 万）+ 总奖资格（Grand $30k / 20×$15k / $2.5M 种子）
- 截止：2026-10-12（线上异步 arena：live demo + 源码 + demo video）

## Assumptions（遇歧义自行假设，记录于此）
1. 主线 = B（AI 代购自动结算）为 Demo 画面，C（收款池即服务）为产品定位，A（按次付费）为附加场景
2. 评审四维 Impact / Novelty / UX / Open-source，视频占比高，2-3min demo video 必须
3. Base Sepolia 部署优先；若测试币不可得，demo 模式 + 展示合约地址兜底
4. Avalanche 版 master 冻结（评限期 10.1-10.8），Colosseum 版全部在 colosseum 分支开发

## Core Claim（评委最终相信什么）
x402 不只是一次性转账协议——它是「AI 经济」的收款管道：**Agent 完成工作即自动向服务商收款池结算，逐笔可审计、可对账、可退款，无需账号/API key/订阅**。

## Winning Evidence（评委看到什么才相信）
1. **30 秒现场画面**：输入"帮我买 10 个 X"→ agent 执行 → 402 挑战 → 钱包签名（gasless EIP-3009）→ 链上结算 → 收款池出现该笔记录，金额/付款方/代币逐项可查
2. **换输入可复现**：现场改数量/商品，结果不可预知且链上可验证（非 mock）
3. **开源**：GitHub 公开仓库 + 固定 commit + README 可复现 + 部署证明端点
4. **Base 主场**：合约部署在 Base（chainId 8453），Coinbase 系工具链显性使用

## Golden Demo 脚本（0-30 秒，先行）
| 秒 | 画面 | 评委反应 |
|---|---|---|
| 0-3 | 首页 hero：「AI 替你下单，自动结算」+ 收款池余额 | 10 秒懂 |
| 3-10 | 输入任务"买 10 个分析报告"→ agent 逐项执行 → 弹 402 挑战（金额/收款方/超时） | 看到协议发生 |
| 10-18 | 点击签名（EIP-3009 无 gas）→ 链上结算 tx 出现 → 任务解锁 | 真上链证据 |
| 18-25 | 切到收款池页：该笔入池 + 历史多笔逐条（payer/amount/token/状态）| 差异化（账本层）|
| 25-30 | 一行字收尾：「没有 API key，没有订阅——机器自己付钱」 | 记忆钩子 |

## 功能分级（冻结功能：10/8 后只修 bug 与包装）
- Critical：任务发起 → 402 → EIP-3009 签名 → 结算 → 收款池记录页；换输入可复现
- Support：代购商品目录（mock 数据但真实结算）、对账/退款按钮、部署证明端点
- Optional：数据分析按次付费第二场景、多币种
- Cut：隐私币/子网叙事（留给 Avalanche 版）、Solana 迁移

## 命名（换皮，不直接用 Avalanche 版名字）
候选：AgentTill / Paymesh / SettleFlow / AgentPay。G1 时人改钩子句。
