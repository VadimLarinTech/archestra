import "@testing-library/jest-dom/vitest";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type {
  PolicyDryRunDecisionRecord,
  PolicyDryRunResponse,
} from "@/lib/policy.query";
import MessageThread, { type PartialUIMessage } from "./message-thread";

vi.mock("@/components/ai-elements/conversation", () => ({
  Conversation: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ConversationScrollButton: () => null,
}));

vi.mock("@/components/ai-elements/loader", () => ({
  Loader: () => null,
}));

vi.mock("@/components/ai-elements/message", () => ({
  Message: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  MessageContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ai-elements/reasoning", () => ({
  Reasoning: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ReasoningContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ReasoningTrigger: () => null,
}));

vi.mock("@/components/ai-elements/response", () => ({
  Response: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ai-elements/sources", () => ({
  Source: () => null,
  Sources: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SourcesContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  SourcesTrigger: () => null,
}));

vi.mock("@/components/ai-elements/tool", () => ({
  Tool: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ToolContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ToolHeader: ({ type }: { type: string }) => <div>{type}</div>,
  ToolInput: () => null,
  ToolOutput: () => null,
}));

vi.mock("@/components/chat/knowledge-graph-citations", () => ({
  hasKnowledgeBaseToolCall: () => false,
  KnowledgeGraphCitations: () => null,
}));

vi.mock("@/components/chat/message-actions", () => ({
  MessageActions: () => null,
}));

vi.mock("@/components/chat/policy-denied-tool", () => ({
  PolicyDeniedTool: () => null,
}));

vi.mock("@/components/divider", () => ({
  default: () => null,
}));

function createDryRunRecord(
  overrides: Partial<PolicyDryRunDecisionRecord>,
): PolicyDryRunDecisionRecord {
  return {
    caseId: "case-1",
    stepId: "step-1",
    stepOrder: 0,
    stepType: "tool_result",
    policyFamily: "combined",
    currentOutcome: "trusted",
    draftOutcome: "untrusted",
    changed: true,
    category: "result_now_sensitive",
    currentReason: undefined,
    draftReason: undefined,
    trustBefore: { current: true, draft: true },
    trustAfter: { current: true, draft: false },
    completeness: "complete",
    confidence: "high_confidence",
    reasons: [],
    sourceArtifact: {
      interactionId: "interaction-1",
      field: "response",
      providerType: "anthropic:messages",
    },
    stepPreview: {
      title: "Tool result",
      toolName: "read_email",
      toolCallId: "call-draft",
      safeIdentifiers: [],
      hiddenInputFields: [],
      rawResultHidden: true,
      note: "",
    },
    counterfactual: false,
    firstDivergence: true,
    firstResultReclassification: true,
    firstDownstreamAffectedStep: false,
    ...overrides,
  };
}

function createPolicyImpactResult(
  records: PolicyDryRunDecisionRecord[],
  policyFamily: PolicyDryRunResponse["policyFamily"] = "combined",
): PolicyDryRunResponse {
  return {
    policyFamily,
    filters: { limit: 500 },
    safety: {
      livePoliciesMutated: false,
      liveToolsExecuted: false,
      llmCallsExecuted: false,
      rawPayloadsReturned: false,
    },
    extractionSummary: {
      interactionsScanned: 1,
      casesBuilt: 1,
      completeCases: 1,
      partialCases: 0,
      unsupportedCases: 0,
      completeSteps: records.length,
      missingPolicyInputSteps: 0,
      unsupportedSteps: 0,
    },
    result: {
      policyFamily,
      summary: {
        evaluatedCases: 1,
        skippedCases: 0,
        evaluatedSteps: records.length,
        unsupportedSteps: 0,
        missingPolicyInputSteps: 0,
        affectedCases: 1,
        affectedSessions: 0,
        affectedToolCalls: 1,
        affectedToolInteractions: new Set(
          records
            .map((record) => record.stepPreview.toolCallId)
            .filter(Boolean),
        ).size,
        newlyBlocked: 0,
        newlyRequireApproval: 0,
        lessRestrictive: 0,
        resultsNewlyBlocked: 0,
        resultsNowAvailable: 0,
        resultsNowSafe: 0,
        resultsNowSensitive: records.filter(
          (record) => record.draftOutcome === "untrusted",
        ).length,
        resultsReclassified: records.filter((record) => record.changed).length,
        trustStateChanged: records.filter(
          (record) => record.trustAfter.current !== record.trustAfter.draft,
        ).length,
        firstDownstreamAffected: 0,
        counterfactualSteps: 0,
      },
      cases: [
        {
          caseId: "case-1",
          replayability: "complete",
          records,
          firstDivergenceStepId: records.find(
            (record) => record.firstDivergence,
          )?.stepId,
          firstResultReclassificationStepId: records.find(
            (record) => record.firstResultReclassification,
          )?.stepId,
        },
      ],
      representativeExample: records[0],
    },
  };
}

describe("MessageThread", () => {
  it("renders the swap-agent divider instead of the raw swap tool box", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-swap",
        role: "assistant",
        parts: [
          {
            type: "tool-spark_swap_agent",
            toolCallId: "swap-call",
            state: "output-available",
            input: { agent_name: "child agent" },
            output: { ok: true },
          },
        ],
      },
    ];

    render(<MessageThread messages={messages} />);

    expect(screen.getByText("Switched to child agent")).toBeInTheDocument();
    expect(screen.queryByText("tool-spark_swap_agent")).not.toBeInTheDocument();
  });

  it("renders the unsafe-context divider after the boundary tool result", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
      />,
    );

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
  });

  it("keeps the unsafe-context divider unprefixed when current and dry-run boundaries match", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            changed: false,
            currentOutcome: "untrusted",
            draftOutcome: "untrusted",
            trustAfter: { current: false, draft: false },
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-unsafe",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("keeps the live unsafe-context divider unlabelled when dry-run has no boundary", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            changed: true,
            currentOutcome: "untrusted",
            draftOutcome: "trusted",
            trustAfter: { current: false, draft: true },
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-unsafe",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("does not label the live unsafe-context divider when the live boundary result was not evaluated", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            changed: false,
            currentOutcome: undefined,
            draftOutcome: undefined,
            category: "missing_policy_input",
            completeness: "missing_policy_input",
            confidence: "partial",
            trustAfter: { current: false, draft: false },
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-unsafe",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("renders a single dry-run unsafe-context divider at the first draft boundary", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-draft",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
          {
            type: "tool-read_email",
            toolCallId: "call-later",
            state: "output-available",
            input: { folder: "archive" },
            output: { emails: [{ from: "cto@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            stepId: "draft-boundary",
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-draft",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
          createDryRunRecord({
            stepId: "later-sensitive-result",
            stepOrder: 1,
            trustBefore: { current: true, draft: false },
            trustAfter: { current: true, draft: false },
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-later",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getAllByText("Dry run")).toHaveLength(1);
    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });

  it("renders a dry-run label alongside the live divider when unsafe-context boundary positions differ", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-draft",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
          {
            type: "tool-read_email",
            toolCallId: "call-current",
            state: "output-available",
            input: { folder: "archive" },
            output: { emails: [{ from: "cto@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-current",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            stepId: "draft-boundary",
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-draft",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getByText("Dry run")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
    expect(screen.getAllByText("Sensitive context below")).toHaveLength(2);
  });

  it("deduplicates dry-run boundaries against the legacy tool-name fallback", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "visible-call-id",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "persisted-boundary-id",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "visible-call-id",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getAllByText("Sensitive context below")).toHaveLength(1);
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("does not label current when the dry-run boundary cannot be anchored to the visible thread", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "visible-call-id",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "visible-call-id",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "not-visible-call-id",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.getAllByText("Sensitive context below")).toHaveLength(1);
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("does not label the live unsafe-context divider for call-only dry-runs", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult([], "tool_call")}
      />,
    );

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("does not label the live unsafe-context divider when a call-only dry-run stops before it", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
        policyImpactResult={createPolicyImpactResult(
          [
            createDryRunRecord({
              stepType: "tool_call",
              currentOutcome: "allow",
              draftOutcome: "block",
              category: "newly_blocked",
              trustAfter: { current: true, draft: true },
              firstResultReclassification: false,
              stepPreview: {
                title: "Tool call",
                toolName: "read_email",
                toolCallId: "call-unsafe",
                safeIdentifiers: [],
                hiddenInputFields: [],
                rawResultHidden: false,
                note: "",
              },
            }),
          ],
          "tool_call",
        )}
      />,
    );

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("does not render a dry-run unsafe-context divider from counterfactual result records", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-stop",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
          {
            type: "tool-read_email",
            toolCallId: "call-counterfactual",
            state: "output-available",
            input: { folder: "archive" },
            output: { emails: [{ from: "cto@external.com" }] },
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        policyImpactResult={createPolicyImpactResult([
          createDryRunRecord({
            stepType: "tool_call",
            currentOutcome: "allow",
            draftOutcome: "block",
            category: "newly_blocked",
            trustAfter: { current: true, draft: true },
            firstResultReclassification: false,
            stepPreview: {
              title: "Tool call",
              toolName: "read_email",
              toolCallId: "call-stop",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: false,
              note: "",
            },
          }),
          createDryRunRecord({
            stepId: "counterfactual-result",
            stepOrder: 1,
            counterfactual: true,
            stepPreview: {
              title: "Tool result",
              toolName: "read_email",
              toolCallId: "call-counterfactual",
              safeIdentifiers: [],
              hiddenInputFields: [],
              rawResultHidden: true,
              note: "",
            },
          }),
        ])}
      />,
    );

    expect(screen.queryByText("Dry run")).not.toBeInTheDocument();
  });

  it("renders the preexisting unsafe-context divider for sensitive policy denials", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "\nI tried to invoke the internal-dev-test-server__print_archestra_test tool with the following arguments: {}.\n\nHowever, I was denied by a tool invocation policy:\n\nTool invocation blocked: context contains sensitive data",
          },
        ],
      },
    ];

    render(<MessageThread messages={messages} />);

    expect(screen.getByText("Sensitive context below")).toBeInTheDocument();
  });

  it("renders the unsafe-context divider before the first text after the boundary tool result", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-read_email",
            toolCallId: "call-unsafe",
            state: "output-available",
            input: { folder: "inbox" },
            output: { emails: [{ from: "ceo@external.com" }] },
          },
          {
            type: "text",
            text: "Done.",
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "call-unsafe",
          toolName: "read_email",
        }}
      />,
    );

    const divider = screen.getByText("Sensitive context below");
    const assistantText = screen.getByText("Done.");

    expect(
      divider.compareDocumentPosition(assistantText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("matches persisted unsafe boundaries by tool name when tool call ids differ", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-internal-dev-test-server__print_archestra_test",
            toolCallId: "ai-sdk-tool-call-id",
            state: "output-available",
            input: {},
            output: { content: "ARCHESTRA_TEST = asdfasdfadsf" },
          },
          {
            type: "text",
            text: "Done.",
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "mcp-tool-call-id",
          toolName: "internal-dev-test-server__print_archestra_test",
        }}
      />,
    );

    const divider = screen.getByText("Sensitive context below");
    const assistantText = screen.getByText("Done.");

    expect(
      divider.compareDocumentPosition(assistantText) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("renders the sensitive-context divider only once after the thread becomes unsafe", () => {
    const messages: PartialUIMessage[] = [
      {
        id: "assistant-1",
        role: "assistant",
        parts: [
          {
            type: "tool-internal-dev-test-server__print_archestra_test",
            toolCallId: "ai-sdk-tool-call-id",
            state: "output-available",
            input: {},
            output: { content: "ARCHESTRA_TEST = asdfasdfadsf" },
          },
          {
            type: "text",
            text: '"ARCHESTRA_TEST = asdfasdfadsf"',
          },
        ],
      },
      {
        id: "assistant-2",
        role: "assistant",
        parts: [
          {
            type: "text",
            text: "\nI tried to invoke the internal-dev-test-server__print_archestra_test tool with the following arguments: {}.\n\nHowever, I was denied by a tool invocation policy:\n\nTool invocation blocked: context contains sensitive data",
          },
        ],
      },
    ];

    render(
      <MessageThread
        messages={messages}
        unsafeContextBoundary={{
          kind: "tool_result",
          reason: "tool_result_marked_untrusted",
          toolCallId: "mcp-tool-call-id",
          toolName: "internal-dev-test-server__print_archestra_test",
        }}
      />,
    );

    expect(screen.getAllByText("Sensitive context below")).toHaveLength(1);
  });
});
