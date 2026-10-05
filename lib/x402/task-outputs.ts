/**
 * Shared per-task agent outputs — the visible "what you bought" evidence
 * used by both the HTTP 402 flow (/api/agent-task) and the A2A x402 flow
 * (/api/a2a/task + /api/a2a/message).
 */

export const TASK_OUTPUTS: Record<string, Record<string, unknown>> = {
  "buy-order": {
    order: {
      item: "Pro 分析报告订阅（30 天）",
      qty: 1,
      unitPrice: "0.001 AGT",
      total: "0.001 AGT",
      status: "confirmed",
      fulfillment: "AI 代购完成，凭证已入收款池",
    },
    summary: "AI 代购自动结算：订单已确认，付款进入服务商收款池（可审计、可对账）",
    tokens: 96,
    latencyMs: 410,
  },
  "generate-report": {
    summary: "周报已生成：收入 +12%、流失 -3%、重点跟进华东客户",
    tokens: 128,
    latencyMs: 342,
  },
  "research-summary": {
    summary: "研究摘要已生成：3 源综合，含 Monad 生态支付赛道 5 项关键结论",
    tokens: 144,
    latencyMs: 386,
  },
  "code-review": {
    summary: "代码审查完成：3 处潜在风险，2 处建议优化（详见 diff）",
    tokens: 112,
    latencyMs: 298,
  },
  "data-insight": {
    summary: "数据洞察：MAU 环比 +8.4%，转化率 2.1%（-0.3pp），退货率回升需关注",
    tokens: 118,
    latencyMs: 322,
  },
};
