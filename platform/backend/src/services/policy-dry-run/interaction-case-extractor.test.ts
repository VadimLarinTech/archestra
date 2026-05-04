import { buildArchestraToolRefusalMetadata } from "@shared";
import { describe, expect, test } from "@/test";
import type { Interaction } from "@/types";
import { extractHistoricalPolicyCasesFromInteractions } from "./interaction-case-extractor";

const profileId = crypto.randomUUID();
const toolId = crypto.randomUUID();
const sessionId = crypto.randomUUID();

describe("policy dry-run interaction case extractor", () => {
  test("builds an ordered replayable case from OpenAI tool call and result interactions", () => {
    const callInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    const resultInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:01:00Z"),
      request: {
        model: "gpt-4o",
        messages: [
          { role: "user", content: "send email" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({ to: "external@example.com" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: JSON.stringify({ ok: true }),
          },
        ],
      },
      response: {
        id: "chatcmpl-result",
        object: "chat.completion",
        created: 2,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "done" },
            finish_reason: "stop",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions(
      [resultInteraction, callInteraction],
      {
        teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
        toolIdsByName: new Map([["send_email", toolId]]),
      },
    );

    expect(result.summary.interactionsScanned).toBe(2);
    expect(result.completeCases).toHaveLength(1);
    expect(result.completeCases[0].steps.map((step) => step.type)).toEqual([
      "tool_call",
      "tool_result",
    ]);
    expect(result.completeCases[0].steps[0]).toMatchObject({
      type: "tool_call",
      toolCallId: "call_1",
      toolName: "send_email",
      toolId,
      toolInput: { to: "external@example.com" },
      completeness: "complete",
      confidence: "high_confidence",
    });
    expect(result.completeCases[0].steps[1]).toMatchObject({
      type: "tool_result",
      toolCallId: "call_1",
      toolName: "send_email",
      toolId,
      toolOutput: { ok: true },
      completeness: "complete",
    });
  });

  test("deduplicates tool results replayed in later chat requests", () => {
    const callInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    const firstResultInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:01:00Z"),
      request: {
        model: "gpt-4o",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({ to: "external@example.com" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: JSON.stringify({ ok: true }),
          },
        ],
      },
      response: {
        id: "chatcmpl-result",
        object: "chat.completion",
        created: 2,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "done" },
            finish_reason: "stop",
          },
        ],
      },
    });
    const replayedResultInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:02:00Z"),
      request: {
        model: "gpt-4o",
        messages: [
          { role: "user", content: "send email" },
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({ to: "external@example.com" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: JSON.stringify({ ok: true }),
          },
          { role: "assistant", content: "done" },
          { role: "user", content: "continue" },
        ],
      },
      response: {
        id: "chatcmpl-followup",
        object: "chat.completion",
        created: 3,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "still done" },
            finish_reason: "stop",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions(
      [replayedResultInteraction, firstResultInteraction, callInteraction],
      {
        teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
        toolIdsByName: new Map([["send_email", toolId]]),
      },
    );

    expect(result.completeCases).toHaveLength(1);
    expect(result.completeCases[0].steps).toHaveLength(2);
    expect(result.completeCases[0].steps.map((step) => step.type)).toEqual([
      "tool_call",
      "tool_result",
    ]);
    expect(result.completeCases[0].steps[1]).toMatchObject({
      type: "tool_result",
      toolCallId: "call_1",
      sourceArtifact: { interactionId: firstResultInteraction.id },
      order: 1,
    });
  });

  test("uses raw request for tool-result policy evaluation even when processedRequest carries provider-visible data", () => {
    const callInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    const resultInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:01:00Z"),
      processedRequest: {
        model: "gpt-4o",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({ to: "external@example.com" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: JSON.stringify({ sanitized: true }),
          },
        ],
      },
      request: {
        model: "gpt-4o",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({ to: "external@example.com" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: JSON.stringify({ original: true }),
          },
        ],
      },
      dualLlmAnalyses: [
        {
          toolCallId: "call_1",
          result: { sanitized: true },
          conversations: [],
        },
      ] as never,
    });

    const result = extractHistoricalPolicyCasesFromInteractions(
      [resultInteraction, callInteraction],
      {
        teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
        toolIdsByName: new Map([["send_email", toolId]]),
      },
    );

    expect(result.completeCases).toHaveLength(1);
    expect(result.completeCases[0].steps[1]).toMatchObject({
      type: "tool_result",
      toolOutput: { original: true },
      dualLlmAnalysisPresent: true,
      sourceArtifact: { field: "request" },
    });
  });

  test("falls back to processedRequest for tool results when the raw request has none", () => {
    const callInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });
    const resultInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:01:00Z"),
      request: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "continue" }],
      },
      processedRequest: {
        model: "gpt-4o",
        messages: [
          {
            role: "assistant",
            content: null,
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: {
                  name: "send_email",
                  arguments: JSON.stringify({ to: "external@example.com" }),
                },
              },
            ],
          },
          {
            role: "tool",
            tool_call_id: "call_1",
            content: JSON.stringify({ sanitized: true }),
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions(
      [resultInteraction, callInteraction],
      {
        teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
        toolIdsByName: new Map([["send_email", toolId]]),
      },
    );

    expect(result.completeCases).toHaveLength(1);
    expect(result.completeCases[0].steps[1]).toMatchObject({
      type: "tool_result",
      toolOutput: { sanitized: true },
      sourceArtifact: { field: "processedRequest" },
    });
  });

  test("does not let normal text-only interactions make an otherwise replayable session incomplete", () => {
    const textOnlyInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:30Z"),
      response: {
        id: "chatcmpl-text",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: { role: "assistant", content: "hello" },
            finish_reason: "stop",
          },
        ],
      },
    });
    const callInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:01:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 2,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions(
      [textOnlyInteraction, callInteraction],
      {
        teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
        toolIdsByName: new Map([["send_email", toolId]]),
      },
    );

    expect(result.completeCases).toHaveLength(1);
    expect(result.completeCases[0].steps).toHaveLength(1);
    expect(result.completeCases[0].steps[0]).toMatchObject({
      type: "tool_call",
      completeness: "complete",
    });
  });

  test("marks tool calls outside the historical request tool list as unsupported", () => {
    const interaction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      request: {
        model: "gpt-4o",
        messages: [{ role: "user", content: "send email" }],
        tools: [
          {
            type: "function",
            function: {
              name: "read_issue",
              description: "Read issue",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
      },
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions([interaction], {
      teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
      toolIdsByName: new Map([["send_email", toolId]]),
    });

    expect(result.completeCases).toHaveLength(0);
    expect(result.unsupportedCases[0].steps[0]).toMatchObject({
      type: "tool_call",
      completeness: "unsupported",
      confidence: "unsupported",
      reasons: ["tool_not_enabled_for_interaction"],
    });
  });

  test("marks tool results without a previous matching tool call as incomplete", () => {
    const resultOnlyInteraction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:01:00Z"),
      request: {
        model: "gpt-4o",
        messages: [
          {
            role: "tool",
            tool_call_id: "call_missing",
            content: JSON.stringify({ ok: true }),
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions(
      [resultOnlyInteraction],
      {
        teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
        toolIdsByName: new Map([["unknown", toolId]]),
      },
    );

    expect(result.completeCases).toHaveLength(0);
    expect(result.unsupportedCases[0].reasons).toContain(
      "missing_tool_call_link",
    );
  });

  test("marks cases incomplete instead of replaying with missing policy inputs", () => {
    const interaction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      source: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions([interaction]);

    expect(result.completeCases).toHaveLength(0);
    expect(result.unsupportedCases).toHaveLength(1);
    expect(result.unsupportedCases[0].steps[0]).toMatchObject({
      type: "tool_call",
      completeness: "missing_policy_input",
      reasons: [
        "missing_team_ids",
        "missing_execution_mode",
        "missing_tool_id",
      ],
    });
  });

  test("treats known empty teamIds as complete policy context", () => {
    const interaction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-call",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: null,
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: {
                    name: "send_email",
                    arguments: JSON.stringify({ to: "external@example.com" }),
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions([interaction], {
      teamIdsByProfileId: new Map([[profileId, []]]),
      toolIdsByName: new Map([["send_email", toolId]]),
    });

    expect(result.completeCases).toHaveLength(1);
    expect(result.completeCases[0].steps[0].reasons).toEqual([]);
  });

  test("extracts structured policy refusal evidence when present", () => {
    const refusal = buildArchestraToolRefusalMetadata({
      toolName: "delete_file",
      toolArguments: JSON.stringify({ path: "/tmp/x" }),
      reason: "Delete is blocked",
    });
    const interaction = makeOpenAiInteraction({
      id: crypto.randomUUID(),
      createdAt: new Date("2026-01-01T00:00:00Z"),
      response: {
        id: "chatcmpl-refusal",
        object: "chat.completion",
        created: 1,
        model: "gpt-4o",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "I cannot do that",
              refusal,
            },
            finish_reason: "stop",
          },
        ],
      },
    });

    const result = extractHistoricalPolicyCasesFromInteractions([interaction], {
      teamIdsByProfileId: new Map([[profileId, ["team-1"]]]),
      toolIdsByName: new Map([["delete_file", toolId]]),
    });

    expect(result.completeCases[0].steps[0]).toMatchObject({
      type: "refusal",
      toolName: "delete_file",
      toolId,
      toolInput: { path: "/tmp/x" },
      reason: "Delete is blocked",
      completeness: "complete",
    });
  });
});

function makeOpenAiInteraction(overrides: {
  id: string;
  createdAt: Date;
  source?: Interaction["source"];
  request?: unknown;
  processedRequest?: unknown;
  response?: unknown;
  dualLlmAnalyses?: Interaction["dualLlmAnalyses"];
}): Interaction {
  const base = {
    id: overrides.id,
    profileId,
    externalAgentId: null,
    executionId: "execution-1",
    userId: null,
    sessionId,
    sessionSource: "header",
    source: "chat",
    request: {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hello" }],
      tools: [
        {
          type: "function",
          function: {
            name: "send_email",
            description: "Send email",
            parameters: { type: "object", properties: {} },
          },
        },
      ],
    },
    processedRequest: null,
    response: {
      id: "chatcmpl-empty",
      object: "chat.completion",
      created: 1,
      model: "gpt-4o",
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: "hello" },
          finish_reason: "stop",
        },
      ],
    },
    dualLlmAnalyses: null,
    unsafeContextBoundary: null,
    type: "openai:chatCompletions",
    model: "gpt-4o",
    baselineModel: "gpt-4o",
    inputTokens: 1,
    outputTokens: 1,
    baselineCost: null,
    cost: null,
    toonTokensBefore: null,
    toonTokensAfter: null,
    toonCostSavings: null,
    toonSkipReason: null,
    createdAt: overrides.createdAt,
  };

  return {
    ...base,
    ...overrides,
  } as Interaction;
}
