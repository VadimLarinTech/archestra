import type { GlobalToolPolicy } from "@/types";
import type {
  HistoricalPolicyCase,
  HistoricalPolicyCaseStep,
  HistoricalRefusalStep,
  HistoricalToolCallStep,
  HistoricalToolResultStep,
  HistoricalUnsupportedStep,
} from "./interaction-case-extractor";
import {
  evaluateToolInvocationPolicy,
  evaluateTrustedDataPolicy,
  type PolicyEvaluationReason,
  type ToolInvocationDryRunOutcome,
  type ToolInvocationDryRunResult,
  type ToolInvocationPolicyForEvaluation,
  type TrustedDataDryRunOutcome,
  type TrustedDataDryRunResult,
  type TrustedDataEvaluationReason,
  type TrustedDataPolicyForEvaluation,
} from "./policy-evaluators";

export type PolicyDryRunFamily = "tool_call" | "tool_result" | "combined";

export type PolicyDryRunDecisionCategory =
  | "unchanged"
  | "newly_blocked"
  | "newly_require_approval"
  | "less_restrictive"
  | "result_newly_blocked"
  | "result_now_available"
  | "result_now_safe"
  | "result_now_sensitive"
  | "result_reclassified"
  | "missing_policy_input"
  | "unsupported";

export type PolicyDryRunSafeStepPreview = {
  title: string;
  toolName?: string;
  toolCallId?: string;
  target?: string;
  safeIdentifiers: Array<{ label: string; value: string }>;
  hiddenInputFields: string[];
  rawResultHidden: boolean;
  note: string;
};

export type PolicyDryRunDecisionRecord = {
  caseId: string;
  stepId: string;
  stepOrder: number;
  stepType: HistoricalPolicyCaseStep["type"];
  policyFamily: PolicyDryRunFamily;
  currentOutcome?: ToolInvocationDryRunOutcome | TrustedDataDryRunOutcome;
  draftOutcome?: ToolInvocationDryRunOutcome | TrustedDataDryRunOutcome;
  changed: boolean;
  category: PolicyDryRunDecisionCategory;
  currentReason?: PolicyEvaluationReason | TrustedDataEvaluationReason;
  draftReason?: PolicyEvaluationReason | TrustedDataEvaluationReason;
  trustBefore: {
    current: boolean;
    draft: boolean;
  };
  trustAfter: {
    current: boolean;
    draft: boolean;
  };
  completeness: HistoricalPolicyCaseStep["completeness"];
  confidence: HistoricalPolicyCaseStep["confidence"];
  reasons: string[];
  sourceArtifact: HistoricalPolicyCaseStep["sourceArtifact"];
  stepPreview: PolicyDryRunSafeStepPreview;
  counterfactual: boolean;
  firstDivergence: boolean;
  firstResultReclassification: boolean;
  firstDownstreamAffectedStep: boolean;
};

type PolicyDryRunEvaluationReason =
  | PolicyEvaluationReason
  | TrustedDataEvaluationReason;

export type PolicyDryRunCaseResult = {
  caseId: string;
  replayability: HistoricalPolicyCase["replayability"];
  records: PolicyDryRunDecisionRecord[];
  firstDivergenceStepId?: string;
  firstResultReclassificationStepId?: string;
  firstDownstreamAffectedStepId?: string;
};

export type PolicyDryRunSummary = {
  evaluatedCases: number;
  skippedCases: number;
  evaluatedSteps: number;
  unsupportedSteps: number;
  missingPolicyInputSteps: number;
  affectedCases: number;
  affectedSessions: number;
  affectedToolCalls: number;
  affectedToolInteractions: number;
  newlyBlocked: number;
  newlyRequireApproval: number;
  lessRestrictive: number;
  resultsNewlyBlocked: number;
  resultsNowAvailable: number;
  resultsNowSafe: number;
  resultsNowSensitive: number;
  resultsReclassified: number;
  trustStateChanged: number;
  firstDownstreamAffected: number;
  counterfactualSteps: number;
};

export type PolicyDryRunResult = {
  policyFamily: PolicyDryRunFamily;
  summary: PolicyDryRunSummary;
  cases: PolicyDryRunCaseResult[];
  representativeExample?: PolicyDryRunDecisionRecord;
};

export type PolicyDryRunOrchestrationInput = {
  policyFamily: PolicyDryRunFamily;
  cases: HistoricalPolicyCase[];
  globalToolPolicy: GlobalToolPolicy;
  globalToolPoliciesByProfileId?: ReadonlyMap<string, GlobalToolPolicy>;
  liveInvocationPolicies: ToolInvocationPolicyForEvaluation[];
  candidateInvocationPolicies: ToolInvocationPolicyForEvaluation[];
  liveTrustedDataPolicies: TrustedDataPolicyForEvaluation[];
  candidateTrustedDataPolicies: TrustedDataPolicyForEvaluation[];
};

export function runPolicyDryRun(
  input: PolicyDryRunOrchestrationInput,
): PolicyDryRunResult {
  const cases = input.cases.map((policyCase) =>
    runPolicyDryRunForCase(policyCase, input),
  );
  const summary = buildDryRunSummary(input.cases, cases);
  const representativeExample = selectRepresentativeExample(
    input.policyFamily,
    cases,
  );

  return {
    policyFamily: input.policyFamily,
    summary,
    cases,
    representativeExample,
  };
}

function runPolicyDryRunForCase(
  policyCase: HistoricalPolicyCase,
  input: PolicyDryRunOrchestrationInput,
): PolicyDryRunCaseResult {
  let currentTrust = getInitialTrustState(policyCase);
  let draftTrust = currentTrust;
  let firstDivergenceStepId: string | undefined;
  let firstResultReclassificationStepId: string | undefined;
  let firstDownstreamAffectedStepId: string | undefined;
  let counterfactualStarted = false;
  const records: PolicyDryRunDecisionRecord[] = [];
  const toolCallStepsById = new Map<
    string,
    HistoricalToolCallStep | HistoricalRefusalStep
  >();
  for (const step of policyCase.steps) {
    if (step.type === "tool_call" && step.toolCallId) {
      toolCallStepsById.set(step.toolCallId, step);
    }
  }

  if (policyCase.replayability !== "complete") {
    return {
      caseId: policyCase.id,
      replayability: policyCase.replayability,
      records: policyCase.steps.map((step) =>
        buildSkippedRecord({
          policyCase,
          step,
          policyFamily: input.policyFamily,
          trustBefore: { current: currentTrust, draft: draftTrust },
          counterfactual: false,
          completeness:
            step.completeness === "complete"
              ? "unsupported"
              : step.completeness,
          extraReasons:
            step.completeness === "complete"
              ? ["case_replayability_not_complete"]
              : [],
        }),
      ),
    };
  }

  for (const step of policyCase.steps) {
    if (input.policyFamily === "tool_call" && step.type === "tool_result") {
      continue;
    }

    const trustBefore =
      input.policyFamily === "tool_call" &&
      (step.type === "tool_call" || step.type === "refusal")
        ? {
            current: step.context.contextIsTrusted,
            draft: step.context.contextIsTrusted,
          }
        : { current: currentTrust, draft: draftTrust };

    if (step.completeness !== "complete") {
      records.push(
        buildSkippedRecord({
          policyCase,
          step,
          policyFamily: input.policyFamily,
          trustBefore,
          counterfactual: counterfactualStarted,
        }),
      );
      continue;
    }

    if (step.type === "tool_result") {
      const resultRecord = evaluateToolResultStep({
        policyCase,
        step,
        relatedToolCallStep: toolCallStepsById.get(step.toolCallId),
        input,
        trustBefore,
        counterfactual: counterfactualStarted,
        firstDivergenceStepId,
        firstResultReclassificationStepId,
      });
      currentTrust = resultRecord.trustAfter.current;
      draftTrust = resultRecord.trustAfter.draft;
      if (resultRecord.changed) {
        firstDivergenceStepId ??= step.id;
        firstResultReclassificationStepId ??= step.id;
      }
      if (isCounterfactualBoundary(resultRecord.draftOutcome)) {
        counterfactualStarted = true;
      }
      records.push(resultRecord);
      continue;
    }

    if (step.type === "tool_call" || step.type === "refusal") {
      const callRecord = evaluateToolCallStep({
        policyCase,
        step,
        relatedToolCallStep: step.type === "tool_call" ? step : undefined,
        input,
        trustBefore,
        counterfactual: counterfactualStarted,
        firstDivergenceStepId,
        firstDownstreamAffectedStepId,
      });
      if (callRecord.changed) {
        firstDivergenceStepId ??= step.id;
        if (callRecord.firstDownstreamAffectedStep) {
          firstDownstreamAffectedStepId ??= step.id;
        }
      }
      if (isCounterfactualBoundary(callRecord.draftOutcome)) {
        counterfactualStarted = true;
      }
      records.push(callRecord);
      continue;
    }

    records.push(
      buildSkippedRecord({
        policyCase,
        step,
        policyFamily: input.policyFamily,
        trustBefore,
        counterfactual: counterfactualStarted,
      }),
    );
  }

  return {
    caseId: policyCase.id,
    replayability: policyCase.replayability,
    records,
    firstDivergenceStepId,
    firstResultReclassificationStepId,
    firstDownstreamAffectedStepId,
  };
}

function evaluateToolCallStep(params: {
  policyCase: HistoricalPolicyCase;
  step: HistoricalToolCallStep | HistoricalRefusalStep;
  relatedToolCallStep?: HistoricalToolCallStep | HistoricalRefusalStep;
  input: PolicyDryRunOrchestrationInput;
  trustBefore: { current: boolean; draft: boolean };
  counterfactual: boolean;
  firstDivergenceStepId?: string;
  firstDownstreamAffectedStepId?: string;
}): PolicyDryRunDecisionRecord {
  const current = evaluateInvocation({
    step: params.step,
    policies: params.input.liveInvocationPolicies,
    globalToolPolicy: getGlobalToolPolicyForStep(params.input, params.step),
    contextIsTrusted: params.trustBefore.current,
  });
  const draft = evaluateInvocation({
    step: params.step,
    policies: params.input.candidateInvocationPolicies,
    globalToolPolicy: getGlobalToolPolicyForStep(params.input, params.step),
    contextIsTrusted: params.trustBefore.draft,
  });
  const policyActionChanged = matchedPolicyActionChanged(
    current.reasonDetails,
    draft.reasonDetails,
  );
  const changed = current.outcome !== draft.outcome || policyActionChanged;
  const firstDivergence = changed && params.firstDivergenceStepId === undefined;
  const firstDownstreamAffectedStep =
    params.input.policyFamily !== "tool_call" &&
    params.trustBefore.current !== params.trustBefore.draft &&
    changed &&
    params.firstDownstreamAffectedStepId === undefined;

  return {
    caseId: params.policyCase.id,
    stepId: params.step.id,
    stepOrder: params.step.order,
    stepType: params.step.type,
    policyFamily: params.input.policyFamily,
    currentOutcome: current.outcome,
    draftOutcome: draft.outcome,
    changed,
    category: categorizeInvocationChange(current.outcome, draft.outcome),
    currentReason: current.reasonDetails,
    draftReason: draft.reasonDetails,
    trustBefore: params.trustBefore,
    trustAfter: params.trustBefore,
    completeness: params.step.completeness,
    confidence: params.step.confidence,
    reasons: params.step.reasons,
    sourceArtifact: params.step.sourceArtifact,
    stepPreview: buildSafeStepPreview(params.step, params.relatedToolCallStep),
    counterfactual: params.counterfactual,
    firstDivergence,
    firstResultReclassification: false,
    firstDownstreamAffectedStep,
  };
}

function evaluateToolResultStep(params: {
  policyCase: HistoricalPolicyCase;
  step: HistoricalToolResultStep;
  relatedToolCallStep?: HistoricalToolCallStep | HistoricalRefusalStep;
  input: PolicyDryRunOrchestrationInput;
  trustBefore: { current: boolean; draft: boolean };
  counterfactual: boolean;
  firstDivergenceStepId?: string;
  firstResultReclassificationStepId?: string;
}): PolicyDryRunDecisionRecord {
  const current = evaluateTrustedData({
    step: params.step,
    policies: params.input.liveTrustedDataPolicies,
    globalToolPolicy: getGlobalToolPolicyForStep(params.input, params.step),
  });
  const draft = evaluateTrustedData({
    step: params.step,
    policies: params.input.candidateTrustedDataPolicies,
    globalToolPolicy: getGlobalToolPolicyForStep(params.input, params.step),
  });
  const currentTrustAfter =
    params.trustBefore.current && isTrustedForDownstream(current.outcome);
  const draftTrustAfter =
    params.trustBefore.draft && isTrustedForDownstream(draft.outcome);
  const policyActionChanged = matchedPolicyActionChanged(
    current.reasonDetails,
    draft.reasonDetails,
  );
  const changed = current.outcome !== draft.outcome || policyActionChanged;
  const firstDivergence = changed && params.firstDivergenceStepId === undefined;
  const firstResultReclassification =
    changed && params.firstResultReclassificationStepId === undefined;

  return {
    caseId: params.policyCase.id,
    stepId: params.step.id,
    stepOrder: params.step.order,
    stepType: params.step.type,
    policyFamily: params.input.policyFamily,
    currentOutcome: current.outcome,
    draftOutcome: draft.outcome,
    changed,
    category: changed
      ? categorizeTrustedDataChange(current.outcome, draft.outcome)
      : "unchanged",
    currentReason: current.reasonDetails,
    draftReason: draft.reasonDetails,
    trustBefore: params.trustBefore,
    trustAfter: {
      current: currentTrustAfter,
      draft: draftTrustAfter,
    },
    completeness: params.step.completeness,
    confidence: params.step.confidence,
    reasons: params.step.reasons,
    sourceArtifact: params.step.sourceArtifact,
    stepPreview: buildSafeStepPreview(params.step, params.relatedToolCallStep),
    counterfactual: params.counterfactual,
    firstDivergence,
    firstResultReclassification,
    firstDownstreamAffectedStep: false,
  };
}

function matchedPolicyActionChanged(
  current: PolicyDryRunEvaluationReason,
  draft: PolicyDryRunEvaluationReason,
) {
  return current.matchedPolicyAction !== draft.matchedPolicyAction;
}

function getGlobalToolPolicyForStep(
  input: PolicyDryRunOrchestrationInput,
  step: HistoricalPolicyCaseStep,
): GlobalToolPolicy {
  if (!step.context.profileId) {
    return input.globalToolPolicy;
  }
  return (
    input.globalToolPoliciesByProfileId?.get(step.context.profileId) ??
    input.globalToolPolicy
  );
}

function evaluateInvocation(params: {
  step: HistoricalToolCallStep | HistoricalRefusalStep;
  policies: ToolInvocationPolicyForEvaluation[];
  globalToolPolicy: GlobalToolPolicy;
  contextIsTrusted: boolean;
}): ToolInvocationDryRunResult {
  return evaluateToolInvocationPolicy({
    toolName: params.step.toolName,
    toolId: params.step.toolId,
    toolInput: params.step.toolInput ?? {},
    context: {
      teamIds: params.step.context.teamIds,
      externalAgentId: params.step.context.externalAgentId ?? undefined,
    },
    contextIsTrusted: params.contextIsTrusted,
    executionMode: params.step.context.executionMode,
    globalToolPolicy: params.globalToolPolicy,
    policies: params.policies,
  });
}

function evaluateTrustedData(params: {
  step: HistoricalToolResultStep;
  policies: TrustedDataPolicyForEvaluation[];
  globalToolPolicy: GlobalToolPolicy;
}): TrustedDataDryRunResult {
  return evaluateTrustedDataPolicy({
    toolName: params.step.toolName,
    toolId: params.step.toolId,
    toolOutput: params.step.toolOutput,
    context: {
      teamIds: params.step.context.teamIds,
      externalAgentId: params.step.context.externalAgentId ?? undefined,
    },
    globalToolPolicy: params.globalToolPolicy,
    policies: params.policies,
  });
}

function buildSkippedRecord(params: {
  policyCase: HistoricalPolicyCase;
  step:
    | HistoricalPolicyCaseStep
    | HistoricalRefusalStep
    | HistoricalUnsupportedStep;
  policyFamily: PolicyDryRunFamily;
  trustBefore: { current: boolean; draft: boolean };
  counterfactual: boolean;
  completeness?: HistoricalPolicyCaseStep["completeness"];
  extraReasons?: string[];
}): PolicyDryRunDecisionRecord {
  const completeness = params.completeness ?? params.step.completeness;
  return {
    caseId: params.policyCase.id,
    stepId: params.step.id,
    stepOrder: params.step.order,
    stepType: params.step.type,
    policyFamily: params.policyFamily,
    changed: false,
    category:
      completeness === "missing_policy_input"
        ? "missing_policy_input"
        : "unsupported",
    trustBefore: params.trustBefore,
    trustAfter: params.trustBefore,
    completeness,
    confidence: params.step.confidence,
    reasons: [...params.step.reasons, ...(params.extraReasons ?? [])],
    sourceArtifact: params.step.sourceArtifact,
    stepPreview: buildSafeStepPreview(params.step),
    counterfactual: params.counterfactual,
    firstDivergence: false,
    firstResultReclassification: false,
    firstDownstreamAffectedStep: false,
  };
}

function selectRepresentativeExample(
  policyFamily: PolicyDryRunFamily,
  cases: PolicyDryRunCaseResult[],
): PolicyDryRunDecisionRecord | undefined {
  const records = cases
    .flatMap((policyCase) => policyCase.records)
    .filter((record) => record.changed && record.completeness === "complete");

  if (policyFamily !== "tool_call") {
    return (
      records.find((record) => record.firstDownstreamAffectedStep) ??
      records.find((record) => record.firstResultReclassification) ??
      records[0]
    );
  }

  return records.find((record) => record.firstDivergence) ?? records[0];
}

function buildSafeStepPreview(
  step: HistoricalPolicyCaseStep,
  relatedToolCallStep?: HistoricalToolCallStep | HistoricalRefusalStep,
): PolicyDryRunSafeStepPreview {
  const toolName = "toolName" in step ? step.toolName : undefined;
  const toolCallId = "toolCallId" in step ? step.toolCallId : undefined;
  const toolInput =
    relatedToolCallStep && "toolInput" in relatedToolCallStep
      ? relatedToolCallStep.toolInput
      : "toolInput" in step
        ? step.toolInput
        : undefined;
  const safeIdentifiers = extractSafeIdentifiers(toolInput);
  const hiddenInputFields = extractHiddenInputFields(toolInput);
  const target = formatTargetFromIdentifiers(safeIdentifiers);
  const title = formatStepPreviewTitle(step.type, toolName);

  return {
    title,
    toolName,
    toolCallId,
    target,
    safeIdentifiers,
    hiddenInputFields,
    rawResultHidden: step.type === "tool_result",
    note:
      step.type === "tool_result"
        ? "Raw tool result is hidden to avoid exposing sensitive data. Preview reuses safe identifiers from the matching historical tool call when available."
        : "Sensitive raw tool arguments are hidden except low-risk identifiers needed to understand the affected action.",
  };
}

function formatStepPreviewTitle(
  type: HistoricalPolicyCaseStep["type"],
  toolName?: string,
): string {
  const displayToolName = toolName ?? "unknown tool";
  switch (type) {
    case "tool_call":
      return `${displayToolName} call`;
    case "tool_result":
      return `${displayToolName} result`;
    case "refusal":
      return `${displayToolName} refused call`;
    case "unsupported":
      return "Unsupported historical step";
  }
}

const SAFE_IDENTIFIER_LABELS: Record<string, string> = {
  owner: "owner",
  org: "org",
  organization: "organization",
  repo: "repo",
  repository: "repository",
  issue_number: "issue",
  issueNumber: "issue",
  pull_number: "pull request",
  pullNumber: "pull request",
  number: "number",
  method: "method",
  project: "project",
  team: "team",
  channel: "channel",
};

const SENSITIVE_INPUT_FIELD_HINTS = [
  "body",
  "content",
  "message",
  "text",
  "query",
  "prompt",
  "description",
  "comment",
  "summary",
  "password",
  "token",
  "secret",
  "key",
];

function extractSafeIdentifiers(
  input: Record<string, unknown> | undefined,
): Array<{ label: string; value: string }> {
  if (!input) return [];

  return Object.entries(input)
    .filter(([key, value]) => key in SAFE_IDENTIFIER_LABELS && isScalar(value))
    .map(([key, value]) => ({
      label: SAFE_IDENTIFIER_LABELS[key] ?? key,
      value: String(value),
    }))
    .slice(0, 8);
}

function extractHiddenInputFields(
  input: Record<string, unknown> | undefined,
): string[] {
  if (!input) return [];

  return Object.keys(input)
    .filter((key) => !(key in SAFE_IDENTIFIER_LABELS))
    .filter((key) =>
      SENSITIVE_INPUT_FIELD_HINTS.some((hint) =>
        key.toLowerCase().includes(hint),
      ),
    )
    .slice(0, 8);
}

function isScalar(value: unknown): value is string | number | boolean {
  return (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function formatTargetFromIdentifiers(
  identifiers: Array<{ label: string; value: string }>,
): string | undefined {
  const byLabel = new Map(
    identifiers.map((identifier) => [identifier.label, identifier.value]),
  );
  const owner = byLabel.get("owner") ?? byLabel.get("org");
  const repo = byLabel.get("repo") ?? byLabel.get("repository");
  const issue = byLabel.get("issue");
  const pullRequest = byLabel.get("pull request");

  const parts: string[] = [];
  if (owner && repo) {
    parts.push(`repo ${owner}/${repo}`);
  } else if (repo) {
    parts.push(`repo ${repo}`);
  }
  if (issue) {
    parts.push(`issue #${issue}`);
  }
  if (pullRequest) {
    parts.push(`pull request #${pullRequest}`);
  }

  return parts.length > 0 ? parts.join(", ") : undefined;
}

function getInitialTrustState(policyCase: HistoricalPolicyCase): boolean {
  const firstStep = policyCase.steps[0];
  if (!firstStep) {
    return true;
  }
  return (
    firstStep.context.unsafeContextBoundary?.kind !== "preexisting_untrusted"
  );
}

function categorizeInvocationChange(
  current: ToolInvocationDryRunOutcome,
  draft: ToolInvocationDryRunOutcome,
): PolicyDryRunDecisionCategory {
  if (current === draft) {
    return "unchanged";
  }
  if (
    current === "block" &&
    (draft === "require_approval" || draft === "allow")
  ) {
    return "less_restrictive";
  }
  if (draft === "block" && current !== "block") {
    return "newly_blocked";
  }
  if (draft === "require_approval" && current === "allow") {
    return "newly_require_approval";
  }
  if (current === "require_approval" && draft === "allow") {
    return "less_restrictive";
  }
  return "unchanged";
}

function categorizeTrustedDataChange(
  current: TrustedDataDryRunOutcome,
  draft: TrustedDataDryRunOutcome,
): PolicyDryRunDecisionCategory {
  if (current === draft) {
    return "unchanged";
  }
  if (draft === "blocked" && current !== "blocked") {
    return "result_newly_blocked";
  }
  if (current === "blocked" && draft !== "blocked") {
    return "result_now_available";
  }
  if (!isTrustedForDownstream(current) && isTrustedForDownstream(draft)) {
    return "result_now_safe";
  }
  if (isTrustedForDownstream(current) && !isTrustedForDownstream(draft)) {
    return "result_now_sensitive";
  }
  return "result_reclassified";
}

function isTrustedForDownstream(outcome: TrustedDataDryRunOutcome): boolean {
  return outcome === "trusted" || outcome === "sanitize_with_dual_llm";
}

function isCounterfactualBoundary(
  outcome: ToolInvocationDryRunOutcome | TrustedDataDryRunOutcome | undefined,
): boolean {
  return (
    outcome === "block" ||
    outcome === "require_approval" ||
    outcome === "blocked"
  );
}

function buildDryRunSummary(
  inputCases: HistoricalPolicyCase[],
  caseResults: PolicyDryRunCaseResult[],
): PolicyDryRunSummary {
  const records = caseResults.flatMap((policyCase) => policyCase.records);
  const changedRecords = records.filter(
    (record) => record.changed && record.completeness === "complete",
  );
  const affectedCaseIds = new Set(
    changedRecords.map((record) => record.caseId),
  );
  const affectedSessionIds = new Set(
    changedRecords
      .map((record) => record.caseId)
      .filter((caseId) => caseId.startsWith("session:")),
  );

  return {
    evaluatedCases: inputCases.filter(
      (policyCase) => policyCase.replayability === "complete",
    ).length,
    skippedCases: inputCases.filter(
      (policyCase) => policyCase.replayability !== "complete",
    ).length,
    evaluatedSteps: records.filter(
      (record) => record.completeness === "complete",
    ).length,
    unsupportedSteps: records.filter(
      (record) => record.completeness === "unsupported",
    ).length,
    missingPolicyInputSteps: records.filter(
      (record) => record.completeness === "missing_policy_input",
    ).length,
    affectedCases: affectedCaseIds.size,
    affectedSessions: affectedSessionIds.size,
    affectedToolCalls: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) =>
          record.stepType === "tool_call" || record.stepType === "refusal",
      ),
    ),
    affectedToolInteractions: getAffectedToolInteractionCount(changedRecords),
    newlyBlocked: getAffectedToolInteractionCount(
      changedRecords.filter((record) => record.category === "newly_blocked"),
    ),
    newlyRequireApproval: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) => record.category === "newly_require_approval",
      ),
    ),
    lessRestrictive: getAffectedToolInteractionCount(
      changedRecords.filter((record) => record.category === "less_restrictive"),
    ),
    resultsNewlyBlocked: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) =>
          isToolResultRecord(record) &&
          record.currentOutcome !== "blocked" &&
          record.draftOutcome === "blocked",
      ),
    ),
    resultsNowAvailable: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) =>
          isToolResultRecord(record) &&
          record.currentOutcome === "blocked" &&
          record.draftOutcome !== "blocked",
      ),
    ),
    resultsNowSafe: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) =>
          isToolResultRecord(record) &&
          !isTrustedForDownstreamOutcome(record.currentOutcome) &&
          isTrustedForDownstreamOutcome(record.draftOutcome),
      ),
    ),
    resultsNowSensitive: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) =>
          isToolResultRecord(record) &&
          isTrustedForDownstreamOutcome(record.currentOutcome) &&
          record.draftOutcome === "untrusted",
      ),
    ),
    resultsReclassified: getAffectedToolInteractionCount(
      changedRecords.filter((record) => isToolResultRecord(record)),
    ),
    trustStateChanged: getAffectedToolInteractionCount(
      changedRecords.filter(
        (record) =>
          isToolResultRecord(record) &&
          record.trustAfter.current !== record.trustAfter.draft,
      ),
    ),
    firstDownstreamAffected: getAffectedToolInteractionCount(
      changedRecords.filter((record) => record.firstDownstreamAffectedStep),
    ),
    counterfactualSteps: records.filter((record) => record.counterfactual)
      .length,
  };
}

function getAffectedToolInteractionCount(
  records: PolicyDryRunDecisionRecord[],
) {
  return new Set(
    records
      .map(getToolInteractionKey)
      .filter((key): key is string => Boolean(key)),
  ).size;
}

function getToolInteractionKey(record: PolicyDryRunDecisionRecord) {
  if (record.stepPreview.toolCallId) {
    return `tool_call:${record.caseId}:${record.stepPreview.toolCallId}`;
  }

  if (record.stepType === "refusal") {
    return `refusal:${record.caseId}:${record.stepId}`;
  }

  return undefined;
}

function isToolResultRecord(record: PolicyDryRunDecisionRecord) {
  return record.stepType === "tool_result";
}

function isTrustedForDownstreamOutcome(
  outcome: PolicyDryRunDecisionRecord["currentOutcome"],
) {
  return outcome === "trusted" || outcome === "sanitize_with_dual_llm";
}
