import { z } from "zod";
import { getGlobalToolPolicy } from "@/guardrails/tool-invocation";
import { ToolInvocationPolicyModel, TrustedDataPolicyModel } from "@/models";
import { ApiError, AutonomyPolicyOperator, UuidIdSchema } from "@/types";
import {
  getHistoricalPolicyCases,
  type HistoricalPolicyCase,
  type HistoricalPolicyCaseExtractionResult,
} from "./interaction-case-extractor";
import {
  type PolicyDryRunFamily,
  type PolicyDryRunResult,
  runPolicyDryRun,
} from "./orchestrator";
import type {
  ToolInvocationPolicyForEvaluation,
  TrustedDataPolicyForEvaluation,
} from "./policy-evaluators";

export const CandidateToolInvocationPolicySchema = z.object({
  id: UuidIdSchema.optional(),
  toolId: UuidIdSchema,
  conditions: z.array(
    z.object({
      key: z.string(),
      operator: AutonomyPolicyOperator.SupportedOperatorSchema,
      value: z.string(),
    }),
  ),
  action: z.enum([
    "allow_when_context_is_untrusted",
    "block_when_context_is_untrusted",
    "block_always",
    "require_approval",
  ]),
  reason: z.string().nullable().optional(),
});

export const CandidateTrustedDataPolicySchema = z.object({
  id: UuidIdSchema.optional(),
  toolId: UuidIdSchema,
  description: z.string().nullable().optional(),
  conditions: z.array(
    z.object({
      key: z.string(),
      operator: AutonomyPolicyOperator.SupportedOperatorSchema,
      value: z.string(),
    }),
  ),
  action: z.enum([
    "block_always",
    "mark_as_trusted",
    "mark_as_untrusted",
    "sanitize_with_dual_llm",
  ]),
});

export const ToolInvocationPolicyReplacementSchema = z.object({
  toolId: UuidIdSchema,
  policies: z.array(CandidateToolInvocationPolicySchema),
});

export const TrustedDataPolicyReplacementSchema = z.object({
  toolId: UuidIdSchema,
  policies: z.array(CandidateTrustedDataPolicySchema),
});

export const ToolInvocationDefaultActionChangeSchema = z.object({
  toolId: UuidIdSchema,
  action: CandidateToolInvocationPolicySchema.shape.action,
});

export const TrustedDataDefaultActionChangeSchema = z.object({
  toolId: UuidIdSchema,
  action: CandidateTrustedDataPolicySchema.shape.action,
});

type PolicyReplacement<
  TPolicy extends { conditions: unknown[]; toolId: string },
> = {
  toolId: string;
  policies: TPolicy[];
};

export type RunHistoricalPolicyDryRunInput = {
  policyFamily: PolicyDryRunFamily;
  profileId?: string;
  profileIds?: string[];
  sessionId?: string;
  interactionId?: string;
  toolName?: string;
  toolNames?: string[];
  toolIds?: string[];
  limit?: number;
  startDate?: Date;
  endDate?: Date;
  toolInvocationPolicyReplacements?: PolicyReplacement<ToolInvocationPolicyForEvaluation>[];
  trustedDataPolicyReplacements?: PolicyReplacement<TrustedDataPolicyForEvaluation>[];
  toolInvocationDefaultActions?: Array<{
    toolId: string;
    action: ToolInvocationPolicyForEvaluation["action"];
  }>;
  trustedDataDefaultActions?: Array<{
    toolId: string;
    action: TrustedDataPolicyForEvaluation["action"];
  }>;
};

export type HistoricalPolicyDryRunResponse = {
  policyFamily: PolicyDryRunFamily;
  filters: {
    profileId?: string;
    sessionId?: string;
    interactionId?: string;
    toolName?: string;
    toolNames?: string[];
    toolIds?: string[];
    limit: number;
    startDate?: string;
    endDate?: string;
  };
  safety: {
    livePoliciesMutated: false;
    liveToolsExecuted: false;
    llmCallsExecuted: false;
    rawPayloadsReturned: false;
  };
  extractionSummary: HistoricalPolicyCaseExtractionResult["summary"];
  result: PolicyDryRunResult;
};

export async function runHistoricalPolicyDryRun(
  input: RunHistoricalPolicyDryRunInput,
): Promise<HistoricalPolicyDryRunResponse> {
  const limit = clampLimit(input.limit ?? 100);
  const historicalProfileIds = input.profileIds;
  const [liveInvocationPolicies, liveTrustedDataPolicies, extracted] =
    await Promise.all([
      ToolInvocationPolicyModel.findAll(),
      TrustedDataPolicyModel.findAll(),
      getHistoricalPolicyCases({
        profileId: historicalProfileIds ? undefined : input.profileId,
        profileIds: historicalProfileIds,
        sessionId: input.sessionId,
        interactionId: input.interactionId,
        toolName: input.toolName,
        toolNames: input.toolNames,
        toolIds: input.toolIds,
        limit,
        startDate: input.startDate,
        endDate: input.endDate,
      }),
    ]);
  const profileIds = collectHistoricalProfileIds(
    input.profileId,
    extracted.cases,
  );
  const globalToolPoliciesByProfileId = new Map(
    await Promise.all(
      profileIds.map(
        async (profileId) =>
          [profileId, await getGlobalToolPolicy(profileId)] as const,
      ),
    ),
  );
  const globalToolPolicy = input.profileId
    ? globalToolPoliciesByProfileId.get(input.profileId)
    : (globalToolPoliciesByProfileId.values().next().value ?? "restrictive");
  if (!globalToolPolicy) {
    throw new ApiError(500, "Could not resolve global tool policy");
  }

  const candidateInvocationPolicies = applyDefaultActionChanges(
    applyPolicyReplacements(
      liveInvocationPolicies,
      input.toolInvocationPolicyReplacements,
    ),
    input.toolInvocationDefaultActions,
    (change) => ({
      toolId: change.toolId,
      conditions: [],
      action: change.action,
      reason: null,
    }),
  );
  const candidateTrustedDataPolicies = applyDefaultActionChanges(
    applyPolicyReplacements(
      liveTrustedDataPolicies,
      input.trustedDataPolicyReplacements,
    ),
    input.trustedDataDefaultActions,
    (change) => ({
      toolId: change.toolId,
      conditions: [],
      action: change.action,
      description: null,
    }),
  );

  const result = runPolicyDryRun({
    policyFamily: input.policyFamily,
    cases: extracted.cases,
    globalToolPolicy,
    globalToolPoliciesByProfileId,
    liveInvocationPolicies,
    candidateInvocationPolicies,
    liveTrustedDataPolicies,
    candidateTrustedDataPolicies,
  });

  return {
    policyFamily: input.policyFamily,
    filters: {
      profileId: input.profileId,
      sessionId: input.sessionId,
      interactionId: input.interactionId,
      toolName: input.toolName,
      toolNames: input.toolNames,
      toolIds: input.toolIds,
      limit,
      startDate: input.startDate?.toISOString(),
      endDate: input.endDate?.toISOString(),
    },
    safety: {
      livePoliciesMutated: false,
      liveToolsExecuted: false,
      llmCallsExecuted: false,
      rawPayloadsReturned: false,
    },
    extractionSummary: extracted.summary,
    result,
  };
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 500);
}

function collectHistoricalProfileIds(
  requestedProfileId: string | undefined,
  cases: HistoricalPolicyCase[],
): string[] {
  return [
    ...new Set([
      ...(requestedProfileId ? [requestedProfileId] : []),
      ...cases.flatMap((policyCase) =>
        policyCase.steps
          .map((step) => step.context.profileId)
          .filter((profileId): profileId is string => Boolean(profileId)),
      ),
    ]),
  ];
}

function applyDefaultActionChanges<
  TPolicy extends { conditions: unknown[]; toolId: string },
  TChange extends { toolId: string },
>(
  policies: TPolicy[],
  changes: TChange[] | undefined,
  makeDefaultPolicy: (change: TChange) => TPolicy,
): TPolicy[] {
  if (!changes || changes.length === 0) {
    return policies;
  }

  const changesByToolId = new Map<string, TChange>();
  for (const change of changes) {
    if (changesByToolId.has(change.toolId)) {
      throw new ApiError(400, "Duplicate default action change for toolId");
    }
    changesByToolId.set(change.toolId, change);
  }

  const seenDefaultToolIds = new Set<string>();
  const nextPolicies = policies.map((policy) => {
    if (policy.conditions.length !== 0) {
      return policy;
    }
    const change = changesByToolId.get(policy.toolId);
    if (!change) {
      return policy;
    }
    seenDefaultToolIds.add(policy.toolId);
    return { ...policy, ...makeDefaultPolicy(change) };
  });

  for (const change of changes) {
    if (!seenDefaultToolIds.has(change.toolId)) {
      nextPolicies.push(makeDefaultPolicy(change));
    }
  }

  return nextPolicies;
}

function applyPolicyReplacements<
  TPolicy extends { conditions: unknown[]; toolId: string },
>(
  livePolicies: TPolicy[],
  replacements?: PolicyReplacement<TPolicy>[],
): TPolicy[] {
  if (!replacements || replacements.length === 0) {
    return livePolicies;
  }

  const replacementsByToolId = new Map<string, TPolicy[]>();
  for (const replacement of replacements) {
    if (replacementsByToolId.has(replacement.toolId)) {
      throw new ApiError(400, "Duplicate policy replacement for toolId");
    }
    if (
      replacement.policies.some(
        (policy) => policy.toolId !== replacement.toolId,
      )
    ) {
      throw new ApiError(
        400,
        "Replacement policy toolId must match replacement toolId",
      );
    }
    if (hasDuplicateDefaultPolicy(replacement.policies)) {
      throw new ApiError(400, "Only one default policy is allowed");
    }
    replacementsByToolId.set(replacement.toolId, replacement.policies);
  }

  return [
    ...livePolicies.filter(
      (policy) => !replacementsByToolId.has(policy.toolId),
    ),
    ...Array.from(replacementsByToolId.values()).flat(),
  ];
}

function hasDuplicateDefaultPolicy(
  policies: Array<{ conditions: unknown[] }>,
): boolean {
  return policies.filter((policy) => policy.conditions.length === 0).length > 1;
}
