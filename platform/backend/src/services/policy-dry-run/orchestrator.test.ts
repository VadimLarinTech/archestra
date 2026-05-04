import { describe, expect, test } from "@/test";
import type { HistoricalPolicyCase } from "./interaction-case-extractor";
import { runPolicyDryRun } from "./orchestrator";

const emailToolId = crypto.randomUUID();
const readEmailToolId = crypto.randomUUID();

describe("policy dry-run orchestrator", () => {
  test("reports newly blocked tool calls against candidate call policies", () => {
    const policyCase = makeCase([
      {
        type: "tool_call",
        toolCallId: "call_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "external@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "allow_when_context_is_untrusted",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_always",
          reason: "Email sends are blocked",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.summary.newlyBlocked).toBe(1);
    expect(result.summary.affectedToolCalls).toBe(1);
    expect(result.summary.affectedToolInteractions).toBe(1);
    expect(result.cases[0].firstDivergenceStepId).toBe("case-1:step-0");
    expect(result.representativeExample).toMatchObject({
      category: "newly_blocked",
      currentOutcome: "allow",
      draftOutcome: "block",
      firstDivergence: true,
    });
  });

  test("reports policy action changes when the tool call outcome stays allowed", () => {
    const policyCase = makeCase([
      {
        type: "tool_call",
        toolCallId: "call_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "external@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "allow_when_context_is_untrusted",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_when_context_is_untrusted",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.summary.affectedToolCalls).toBe(1);
    expect(result.summary.affectedToolInteractions).toBe(1);
    expect(result.cases[0].records[0]).toMatchObject({
      stepType: "tool_call",
      currentOutcome: "allow",
      draftOutcome: "allow",
      changed: true,
      currentReason: {
        matchedPolicyAction: "allow_when_context_is_untrusted",
      },
      draftReason: {
        matchedPolicyAction: "block_when_context_is_untrusted",
      },
    });
  });

  test("counts affected refusals as tool calls", () => {
    const policyCase = makeCase([
      {
        type: "refusal",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "external@example.com" },
        reason: "blocked",
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_always",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "allow_when_context_is_untrusted",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.summary.affectedToolCalls).toBe(1);
    expect(result.summary.affectedToolInteractions).toBe(1);
    expect(result.summary.lessRestrictive).toBe(1);
  });

  test("treats block to approval as less restrictive, not newly approval", () => {
    const policyCase = makeCase([
      {
        type: "tool_call",
        toolCallId: "call_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "external@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_always",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "require_approval",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.summary.newlyRequireApproval).toBe(0);
    expect(result.summary.lessRestrictive).toBe(1);
  });

  test("does not evaluate incomplete historical steps as confident impact", () => {
    const policyCase = makeCase(
      [
        {
          type: "tool_call",
          toolCallId: "call_1",
          toolName: "send_email",
          toolInput: { to: "external@example.com" },
          completeness: "missing_policy_input",
          confidence: "partial",
          reasons: ["missing_tool_id"],
        },
      ],
      "unsupported",
    );

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_always",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.summary.evaluatedSteps).toBe(0);
    expect(result.summary.missingPolicyInputSteps).toBe(1);
    expect(result.summary.newlyBlocked).toBe(0);
    expect(result.cases[0].records[0]).toMatchObject({
      category: "missing_policy_input",
    });
    expect("currentOutcome" in result.cases[0].records[0]).toBe(false);
    expect("draftOutcome" in result.cases[0].records[0]).toBe(false);
  });

  test("skips all records for partial cases even when one step looks complete", () => {
    const policyCase = makeCase(
      [
        {
          type: "tool_call",
          toolCallId: "call_1",
          toolName: "send_email",
          toolId: emailToolId,
          toolInput: { to: "external@example.com" },
        },
        {
          type: "tool_result",
          toolCallId: "read_1",
          toolName: "read_email",
          toolOutput: { from: "attacker@external.com" },
          isError: false,
          completeness: "missing_policy_input",
          confidence: "partial",
          reasons: ["missing_tool_id"],
        },
      ],
      "partial",
    );

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_always",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.summary.evaluatedSteps).toBe(0);
    expect(result.summary.skippedCases).toBe(1);
    expect(result.summary.newlyBlocked).toBe(0);
    expect(result.cases[0].records[0]).toMatchObject({
      completeness: "unsupported",
      reasons: ["case_replayability_not_complete"],
    });
  });

  test("does not let result steps alter trust state during call-policy dry run", () => {
    const policyCase = makeCase([
      {
        type: "tool_result",
        toolCallId: "read_1",
        toolName: "read_email",
        toolId: readEmailToolId,
        toolOutput: { from: "attacker@external.com" },
        isError: false,
      },
      {
        type: "tool_call",
        toolCallId: "send_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "customer@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_when_context_is_untrusted",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_when_context_is_untrusted",
        },
      ],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_untrusted",
        },
      ],
    });

    expect(result.cases[0].records).toHaveLength(1);
    expect(result.cases[0].records[0]).toMatchObject({
      stepType: "tool_call",
      currentOutcome: "allow",
      draftOutcome: "allow",
      changed: false,
    });
  });

  test("evaluates each historical step with that step's profile global policy", () => {
    const policyCase = makeCase([
      {
        type: "tool_call",
        toolCallId: "call_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "customer@example.com" },
      },
      {
        type: "tool_call",
        toolCallId: "call_2",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "customer@example.com" },
      },
    ]);
    policyCase.steps[0].context.profileId = "permissive-profile";
    policyCase.steps[0].context.contextIsTrusted = false;
    policyCase.steps[1].context.profileId = "restrictive-profile";
    policyCase.steps[1].context.contextIsTrusted = false;

    const result = runPolicyDryRun({
      policyFamily: "tool_call",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      globalToolPoliciesByProfileId: new Map([
        ["permissive-profile", "permissive"],
        ["restrictive-profile", "restrictive"],
      ]),
      liveInvocationPolicies: [],
      candidateInvocationPolicies: [],
      liveTrustedDataPolicies: [],
      candidateTrustedDataPolicies: [],
    });

    expect(result.cases[0].records).toHaveLength(2);
    expect(result.cases[0].records[0]).toMatchObject({
      currentOutcome: "allow",
      draftOutcome: "allow",
    });
    expect(result.cases[0].records[1]).toMatchObject({
      currentOutcome: "block",
      draftOutcome: "block",
    });
  });

  test("tracks result reclassification and first downstream affected call", () => {
    const policyCase = makeCase([
      {
        type: "tool_result",
        toolCallId: "read_1",
        toolName: "read_email",
        toolId: readEmailToolId,
        toolOutput: { from: "attacker@external.com" },
        isError: false,
      },
      {
        type: "tool_call",
        toolCallId: "send_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "customer@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_result",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_when_context_is_untrusted",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_when_context_is_untrusted",
        },
      ],
      liveTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_trusted",
        },
      ],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_untrusted",
        },
      ],
    });

    expect(result.summary.resultsReclassified).toBe(1);
    expect(result.summary.trustStateChanged).toBe(1);
    expect(result.summary.resultsNowSensitive).toBe(1);
    expect(result.summary.newlyBlocked).toBe(1);
    expect(result.summary.firstDownstreamAffected).toBe(1);
    expect(result.summary.affectedToolInteractions).toBe(2);
    expect(result.cases[0]).toMatchObject({
      firstResultReclassificationStepId: "case-1:step-0",
      firstDownstreamAffectedStepId: "case-1:step-1",
    });
    expect(result.cases[0].records[0]).toMatchObject({
      stepType: "tool_result",
      currentOutcome: "trusted",
      draftOutcome: "untrusted",
      firstResultReclassification: true,
      trustAfter: { current: true, draft: false },
    });
    expect(result.cases[0].records[1]).toMatchObject({
      stepType: "tool_call",
      currentOutcome: "allow",
      draftOutcome: "block",
      firstDownstreamAffectedStep: true,
    });
  });

  test("does not count downstream calls as impacted when only context changes", () => {
    const policyCase = makeCase([
      {
        type: "tool_result",
        toolCallId: "read_1",
        toolName: "read_email",
        toolId: readEmailToolId,
        toolOutput: { from: "attacker@external.com" },
        isError: false,
      },
      {
        type: "tool_call",
        toolCallId: "send_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "customer@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "combined",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "allow_when_context_is_untrusted",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "allow_when_context_is_untrusted",
        },
      ],
      liveTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_trusted",
        },
      ],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_untrusted",
        },
      ],
    });

    expect(result.summary.affectedToolCalls).toBe(0);
    expect(result.summary.affectedToolInteractions).toBe(1);
    expect(result.summary.firstDownstreamAffected).toBe(0);
    expect(result.cases[0]).toMatchObject({
      firstDownstreamAffectedStepId: undefined,
    });
    expect(result.cases[0].records[1]).toMatchObject({
      stepType: "tool_call",
      currentOutcome: "allow",
      draftOutcome: "allow",
      changed: false,
      firstDownstreamAffectedStep: false,
      trustBefore: { current: true, draft: false },
    });
  });

  test("keeps evaluating later counterfactual steps after a draft result block", () => {
    const policyCase = makeCase([
      {
        type: "tool_result",
        toolCallId: "read_1",
        toolName: "read_email",
        toolId: readEmailToolId,
        toolOutput: { from: "attacker@external.com" },
        isError: false,
      },
      {
        type: "tool_call",
        toolCallId: "send_1",
        toolName: "send_email",
        toolId: emailToolId,
        toolInput: { to: "customer@example.com" },
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "combined",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "allow_when_context_is_untrusted",
        },
      ],
      candidateInvocationPolicies: [
        {
          toolId: emailToolId,
          conditions: [],
          action: "block_when_context_is_untrusted",
        },
      ],
      liveTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_trusted",
        },
      ],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "block_always",
        },
      ],
    });

    expect(result.summary.resultsNewlyBlocked).toBe(1);
    expect(result.summary.affectedToolCalls).toBe(1);
    expect(result.summary.affectedToolInteractions).toBe(2);
    expect(result.summary.counterfactualSteps).toBe(1);
    expect(result.cases[0].records[0]).toMatchObject({
      stepType: "tool_result",
      currentOutcome: "trusted",
      draftOutcome: "blocked",
      counterfactual: false,
      trustAfter: { current: true, draft: false },
    });
    expect(result.cases[0].records[1]).toMatchObject({
      stepType: "tool_call",
      currentOutcome: "allow",
      draftOutcome: "block",
      changed: true,
      counterfactual: true,
      firstDownstreamAffectedStep: true,
    });
  });

  test("reports blocked result becoming available and safe separately", () => {
    const policyCase = makeCase([
      {
        type: "tool_result",
        toolCallId: "read_1",
        toolName: "read_email",
        toolId: readEmailToolId,
        toolOutput: { from: "trusted@company.com" },
        isError: false,
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_result",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [],
      candidateInvocationPolicies: [],
      liveTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "block_always",
        },
      ],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_trusted",
        },
      ],
    });

    expect(result.summary.resultsNowAvailable).toBe(1);
    expect(result.summary.resultsNowSafe).toBe(1);
    expect(result.summary.resultsReclassified).toBe(1);
    expect(result.summary.trustStateChanged).toBe(1);
    expect(result.representativeExample).toMatchObject({
      category: "result_now_available",
      currentOutcome: "blocked",
      draftOutcome: "trusted",
      trustAfter: { current: false, draft: true },
    });
  });

  test("counts matching tool call ids in different cases as separate affected interactions", () => {
    const result = runPolicyDryRun({
      policyFamily: "tool_result",
      cases: [
        makeCase(
          [
            {
              type: "tool_result",
              toolCallId: "call_1",
              toolName: "read_email",
              toolId: readEmailToolId,
              toolOutput: { from: "first@example.com" },
              isError: false,
            },
          ],
          "complete",
          "case-1",
        ),
        makeCase(
          [
            {
              type: "tool_result",
              toolCallId: "call_1",
              toolName: "read_email",
              toolId: readEmailToolId,
              toolOutput: { from: "second@example.com" },
              isError: false,
            },
          ],
          "complete",
          "case-2",
        ),
      ],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [],
      candidateInvocationPolicies: [],
      liveTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_trusted",
        },
      ],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_untrusted",
        },
      ],
    });

    expect(result.summary.resultsNowSensitive).toBe(2);
    expect(result.summary.affectedToolInteractions).toBe(2);
  });

  test("reports untrusted result becoming safe separately from newly available", () => {
    const policyCase = makeCase([
      {
        type: "tool_result",
        toolCallId: "read_1",
        toolName: "read_email",
        toolId: readEmailToolId,
        toolOutput: { from: "trusted@company.com" },
        isError: false,
      },
    ]);

    const result = runPolicyDryRun({
      policyFamily: "tool_result",
      cases: [policyCase],
      globalToolPolicy: "restrictive",
      liveInvocationPolicies: [],
      candidateInvocationPolicies: [],
      liveTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_untrusted",
        },
      ],
      candidateTrustedDataPolicies: [
        {
          toolId: readEmailToolId,
          conditions: [],
          action: "mark_as_trusted",
        },
      ],
    });

    expect(result.summary.resultsNowAvailable).toBe(0);
    expect(result.summary.resultsNowSafe).toBe(1);
    expect(result.representativeExample).toMatchObject({
      category: "result_now_safe",
      currentOutcome: "untrusted",
      draftOutcome: "trusted",
    });
  });
});

function makeCase(
  steps: Array<
    | {
        type: "tool_call";
        toolCallId: string;
        toolName: string;
        toolId?: string;
        toolInput: Record<string, unknown>;
        completeness?: "complete" | "missing_policy_input";
        confidence?: "high_confidence" | "partial";
        reasons?: string[];
      }
    | {
        type: "tool_result";
        toolCallId: string;
        toolName: string;
        toolId?: string;
        toolOutput: unknown;
        isError: boolean;
        completeness?: "complete" | "missing_policy_input";
        confidence?: "high_confidence" | "partial";
        reasons?: string[];
      }
    | {
        type: "refusal";
        toolName: string;
        toolId?: string;
        toolInput?: Record<string, unknown>;
        reason?: string;
        completeness?: "complete" | "missing_policy_input";
        confidence?: "high_confidence" | "partial";
        reasons?: string[];
      }
  >,
  replayability: HistoricalPolicyCase["replayability"] = "complete",
  caseId = "case-1",
): HistoricalPolicyCase {
  const createdAt = new Date("2026-01-01T00:00:00Z");
  return {
    id: caseId,
    sessionId: caseId === "case-1" ? "session-1" : `${caseId}-session`,
    executionId: caseId === "case-1" ? "execution-1" : `${caseId}-execution`,
    profileId: "profile-1",
    externalAgentId: null,
    providerTypes: ["openai:chatCompletions"],
    source: "chat",
    executionMode: "chat",
    createdAt,
    updatedAt: createdAt,
    replayability,
    reasons: [],
    steps: steps.map((step, index) => ({
      id: `${caseId}:step-${index}`,
      order: index,
      interactionId:
        caseId === "case-1"
          ? `interaction-${index}`
          : `${caseId}:interaction-${index}`,
      createdAt,
      providerType: "openai:chatCompletions",
      context: {
        profileId: "profile-1",
        externalAgentId: null,
        teamIds: [],
        teamIdsKnown: true,
        source: "chat",
        executionMode: "chat",
        contextIsTrusted: true,
        unsafeContextBoundary: null,
        dualLlmAnalysisCount: 0,
      },
      confidence: step.confidence ?? "high_confidence",
      completeness: step.completeness ?? "complete",
      reasons: step.reasons ?? [],
      sourceArtifact: {
        interactionId:
          caseId === "case-1"
            ? `interaction-${index}`
            : `${caseId}:interaction-${index}`,
        field: step.type === "tool_result" ? "request" : "response",
        providerType: "openai:chatCompletions",
      },
      ...step,
    })),
  } as HistoricalPolicyCase;
}
