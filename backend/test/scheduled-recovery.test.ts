import { describe, expect, it } from "vitest";
import { scheduledWorkflowRecovery } from "../src/coordinator";
import type { AppEnv } from "../src/types";

function recordingQueue() {
  const state = { sendCalls: 0, batches: [] as unknown[][] };
  return {
    state,
    async send() { state.sendCalls += 1; },
    async sendBatch(messages: Iterable<{ body: unknown }>) {
      state.batches.push([...messages].map(message => message.body));
    }
  };
}

// The recovery sweep runs on the two-minute tick and can re-enqueue up to 150 jobs. Sending them
// one at a time cost one queue round trip per row, so these assertions pin the batched behaviour.
function stubEnv(
  rankRows: unknown[],
  renderRows: unknown[],
  rankQueue: unknown,
  renderQueue: unknown
): AppEnv {
  const rowsFor = (sql: string) => {
    if (sql.includes("FROM quote_rank_jobs")) return rankRows;
    if (sql.includes("FROM image_render_jobs")) return renderRows;
    return [];
  };
  // The stub records the SQL on the bound statement so `batch` can answer each one in order, the
  // way D1 does. `batch` is what the sweep uses: one request for both job tables.
  return {
    DB: {
      prepare(sql: string) {
        return {
          bind() {
            return {
              sql,
              async all() { return { results: rowsFor(sql) }; }
            };
          }
        };
      },
      async batch(statements: { sql: string }[]) {
        return statements.map(statement => ({ results: rowsFor(statement.sql) }));
      }
    },
    QUOTE_RANK_QUEUE: rankQueue,
    IMAGE_RENDER_QUEUE: renderQueue
  } as unknown as AppEnv;
}

describe("scheduled workflow recovery", () => {
  it("re-enqueues due jobs as one batch per queue", async () => {
    const rankQueue = recordingQueue();
    const renderQueue = recordingQueue();
    const env = stubEnv(
      [
        { id: "rnkjob_1", rfq_id: "rfq_1", trigger: "DEADLINE", requested_version: 1 },
        { id: "rnkjob_2", rfq_id: "rfq_2", trigger: "ALL_TERMINAL", requested_version: 3 }
      ],
      [{
        id: "imgjob_1",
        artifact_id: "art_1",
        rfq_id: "rfq_1",
        ranking_run_id: "run_1",
        trade_code: "T1",
        quote_id: "quo_1",
        issuer: "BNP"
      }],
      rankQueue,
      renderQueue
    );

    await scheduledWorkflowRecovery(env);

    expect(rankQueue.state.sendCalls).toBe(0);
    expect(renderQueue.state.sendCalls).toBe(0);
    expect(rankQueue.state.batches).toEqual([[
      { jobId: "rnkjob_1", rfqId: "rfq_1", trigger: "DEADLINE", requestedVersion: 1 },
      { jobId: "rnkjob_2", rfqId: "rfq_2", trigger: "ALL_TERMINAL", requestedVersion: 3 }
    ]]);
    expect(renderQueue.state.batches).toEqual([[{
      jobId: "imgjob_1",
      artifactId: "art_1",
      rfqId: "rfq_1",
      rankingRunId: "run_1",
      tradeCode: "T1",
      quoteId: "quo_1",
      issuer: "BNP"
    }]]);
  });

  it("sends nothing when no job is due", async () => {
    const rankQueue = recordingQueue();
    const renderQueue = recordingQueue();
    await scheduledWorkflowRecovery(stubEnv([], [], rankQueue, renderQueue));
    expect(rankQueue.state.batches).toEqual([]);
    expect(renderQueue.state.batches).toEqual([]);
    expect(rankQueue.state.sendCalls).toBe(0);
    expect(renderQueue.state.sendCalls).toBe(0);
  });
});
