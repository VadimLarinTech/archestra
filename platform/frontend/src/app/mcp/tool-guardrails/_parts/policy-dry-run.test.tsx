import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  PolicyDryRunDecisionRecord,
  PolicyDryRunResponse,
} from "@/lib/policy.query";
import {
  getChangedDryRunRecords,
  PolicyDryRunResultPanel,
  PolicyImpactAnnotation,
  PolicyImpactSummaryCard,
} from "./policy-dry-run";

const mockUseInternalMcpCatalog = vi.fn((_params?: unknown) => ({ data: [] }));
const mockUseToolsWithAssignments = vi.fn((_params?: unknown) => ({
  data: { data: [] },
}));

vi.mock("@/lib/mcp/internal-mcp-catalog.query", () => ({
  useInternalMcpCatalog: (...args: unknown[]) =>
    mockUseInternalMcpCatalog(args[0]),
}));

vi.mock("@/lib/tools/tool.query", () => ({
  useToolsWithAssignments: (...args: unknown[]) =>
    mockUseToolsWithAssignments(args[0]),
}));

function createRecord(
  overrides: Partial<PolicyDryRunDecisionRecord>,
): PolicyDryRunDecisionRecord {
  return {
    caseId: "case-1",
    stepId: "step-1",
    stepOrder: 0,
    stepType: "tool_call",
    policyFamily: "combined",
    currentOutcome: "allow",
    draftOutcome: "block",
    changed: true,
    category: "newly_blocked",
    currentReason: undefined,
    draftReason: {
      code: "matched_policy",
      message: "Draft policy blocks this step.",
      fallbackDecision: false,
    },
    trustBefore: { current: true, draft: true },
    trustAfter: { current: true, draft: true },
    completeness: "complete",
    confidence: "high_confidence",
    reasons: [],
    sourceArtifact: {
      interactionId: "interaction-1",
      field: "response",
      providerType: "anthropic:messages",
    },
    stepPreview: {
      title: "Tool call",
      toolName: "github__search",
      toolCallId: "tool-call-1",
      safeIdentifiers: [],
      hiddenInputFields: [],
      rawResultHidden: false,
      note: "",
    },
    counterfactual: false,
    firstDivergence: false,
    firstResultReclassification: false,
    firstDownstreamAffectedStep: false,
    ...overrides,
  };
}

function createCombinedDryRunResponse(): PolicyDryRunResponse {
  const callRecord = createRecord({
    stepId: "call-step",
    stepOrder: 0,
    firstDivergence: true,
  });
  const resultRecord = createRecord({
    stepId: "result-step",
    stepOrder: 1,
    stepType: "tool_result",
    currentOutcome: "trusted",
    draftOutcome: "untrusted",
    category: "result_now_sensitive",
    firstResultReclassification: true,
    trustAfter: { current: true, draft: false },
    stepPreview: {
      title: "Tool result",
      toolName: "github__search",
      toolCallId: "tool-call-1",
      safeIdentifiers: [],
      hiddenInputFields: [],
      rawResultHidden: true,
      note: "",
    },
  });

  return {
    policyFamily: "combined",
    filters: {
      limit: 500,
    },
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
      completeSteps: 2,
      missingPolicyInputSteps: 0,
      unsupportedSteps: 0,
    },
    result: {
      policyFamily: "combined",
      summary: {
        evaluatedCases: 1,
        skippedCases: 0,
        evaluatedSteps: 2,
        unsupportedSteps: 0,
        missingPolicyInputSteps: 0,
        affectedCases: 1,
        affectedSessions: 0,
        affectedToolCalls: 1,
        affectedToolInteractions: 1,
        newlyBlocked: 1,
        newlyRequireApproval: 0,
        lessRestrictive: 0,
        resultsNewlyBlocked: 0,
        resultsNowAvailable: 0,
        resultsNowSafe: 0,
        resultsNowSensitive: 1,
        resultsReclassified: 1,
        trustStateChanged: 1,
        firstDownstreamAffected: 0,
        counterfactualSteps: 0,
      },
      cases: [
        {
          caseId: "case-1",
          replayability: "complete",
          records: [callRecord, resultRecord],
          firstDivergenceStepId: "call-step",
          firstResultReclassificationStepId: "result-step",
        },
      ],
      representativeExample: callRecord,
    },
  };
}

describe("PolicyDryRunResultPanel", () => {
  beforeEach(() => {
    window.requestAnimationFrame = (callback: FrameRequestCallback) => {
      callback(0);
      return 0;
    };
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("shows call and result impact metrics for combined dry-runs", () => {
    render(<PolicyDryRunResultPanel result={createCombinedDryRunResponse()} />);

    expect(screen.getByText("Affected tool interactions")).toBeInTheDocument();
    expect(screen.getByText("Calls would be blocked")).toBeInTheDocument();
    expect(
      screen.getByText("Safe outputs would become sensitive context"),
    ).toBeInTheDocument();
  });

  it("deduplicates result transition metrics by affected tool interaction", () => {
    const response = createCombinedDryRunResponse();
    const duplicateResultRecord = {
      ...response.result.cases[0].records[1],
      stepId: "duplicate-result-step",
      stepOrder: 2,
    };
    response.result.cases[0].records.push(duplicateResultRecord);
    response.result.summary.resultsReclassified = 1;
    response.result.summary.affectedToolInteractions = 1;

    render(<PolicyDryRunResultPanel result={response} />);

    const metric = screen
      .getByText("Safe outputs would become sensitive context")
      .closest(".rounded-md");
    expect(metric).not.toBeNull();
    expect(within(metric as HTMLElement).getByText("1")).toBeInTheDocument();
    expect(
      within(metric as HTMLElement).queryByText("2"),
    ).not.toBeInTheDocument();
  });

  it("does not duplicate result reclassification as downstream context", () => {
    render(<PolicyDryRunResultPanel result={createCombinedDryRunResponse()} />);

    fireEvent.click(screen.getByRole("button", { name: "Show example" }));

    expect(screen.getByText("Result impact")).toBeInTheDocument();
    expect(screen.queryByText("Downstream context")).not.toBeInTheDocument();
  });
});

describe("PolicyImpactSummaryCard", () => {
  it("counts unique affected tool interactions instead of raw changed steps", () => {
    render(<PolicyImpactSummaryCard result={createCombinedDryRunResponse()} />);

    expect(screen.getByText("1 affected tool interaction")).toBeInTheDocument();
    expect(screen.queryByText("2 changed steps")).not.toBeInTheDocument();
  });
});

describe("getChangedDryRunRecords", () => {
  it("deduplicates replayed result records without merging call and result impact", () => {
    const response = createCombinedDryRunResponse();
    response.result.cases[0].records.push({
      ...response.result.cases[0].records[1],
      stepId: "replayed-result-step",
      stepOrder: 2,
      sourceArtifact: {
        ...response.result.cases[0].records[1].sourceArtifact,
        interactionId: "later-interaction",
      },
    });

    const records = getChangedDryRunRecords(response);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.stepType)).toEqual([
      "tool_call",
      "tool_result",
    ]);
  });
});

describe("PolicyImpactAnnotation", () => {
  it("shows call and result changes for the same rendered tool call", () => {
    render(
      <PolicyImpactAnnotation
        records={[
          createRecord({
            stepId: "call-step",
            stepType: "tool_call",
            currentOutcome: "allow",
            draftOutcome: "block",
          }),
          createRecord({
            stepId: "result-step",
            stepType: "tool_result",
            currentOutcome: "trusted",
            draftOutcome: "untrusted",
          }),
        ]}
      />,
    );

    expect(screen.getByText("Call: Allow to Block")).toBeInTheDocument();
    expect(screen.getByText("Result: Safe to Sensitive")).toBeInTheDocument();
  });

  it("deduplicates repeated badges and omits the tool name", () => {
    render(
      <PolicyImpactAnnotation
        records={[
          createRecord({
            stepId: "result-step-1",
            stepType: "tool_result",
            currentOutcome: "trusted",
            draftOutcome: "untrusted",
          }),
          createRecord({
            stepId: "result-step-2",
            stepType: "tool_result",
            currentOutcome: "trusted",
            draftOutcome: "untrusted",
          }),
        ]}
      />,
    );

    expect(screen.getAllByText("Result: Safe to Sensitive")).toHaveLength(1);
    expect(screen.queryByText("github__search")).not.toBeInTheDocument();
  });

  it("shows policy action changes when the outcome stays the same", () => {
    render(
      <PolicyImpactAnnotation
        records={[
          createRecord({
            stepId: "call-step",
            stepType: "tool_call",
            currentOutcome: "allow",
            draftOutcome: "allow",
            category: "unchanged",
            currentReason: {
              code: "matched_default_policy",
              message: "Current policy allows this step.",
              matchedPolicyAction: "allow_when_context_is_untrusted",
              fallbackDecision: false,
            },
            draftReason: {
              code: "matched_default_policy",
              message: "Draft policy allows only in safe context.",
              matchedPolicyAction: "block_when_context_is_untrusted",
              fallbackDecision: false,
            },
          }),
        ]}
      />,
    );

    expect(screen.getByText("Call: Always to Safe only")).toBeInTheDocument();
    expect(screen.getByText("Always")).toBeInTheDocument();
    expect(screen.getByText("Safe only")).toBeInTheDocument();
    expect(screen.queryByText(/Context/)).not.toBeInTheDocument();
  });
});
