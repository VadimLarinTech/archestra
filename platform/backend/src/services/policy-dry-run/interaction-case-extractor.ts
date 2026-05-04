import {
  type InteractionSource,
  parseArchestraToolRefusal,
  type SupportedProviderDiscriminator,
} from "@shared";
import {
  and,
  desc,
  eq,
  gte,
  inArray,
  lte,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { archestraMcpBranding } from "@/archestra-mcp-server/branding";
import db, { schema } from "@/database";
import { AgentTeamModel } from "@/models";
import {
  anthropicAdapterFactory,
  azureAdapterFactory,
  azureResponsesAdapterFactory,
  bedrockAdapterFactory,
  cerebrasAdapterFactory,
  cohereAdapterFactory,
  deepseekAdapterFactory,
  geminiAdapterFactory,
  groqAdapterFactory,
  minimaxAdapterFactory,
  mistralAdapterFactory,
  ollamaAdapterFactory,
  openaiAdapterFactory,
  openrouterAdapterFactory,
  perplexityAdapterFactory,
  vllmAdapterFactory,
  xaiAdapterFactory,
  zhipuaiAdapterFactory,
} from "@/routes/proxy/adapters";
import type {
  CommonMcpToolDefinition,
  CommonToolCall,
  CommonToolResult,
  Interaction,
  UnsafeContextBoundary,
} from "@/types";

export type HistoricalCaseReplayability =
  | "complete"
  | "partial"
  | "unsupported";

export type HistoricalStepCompleteness =
  | "complete"
  | "missing_policy_input"
  | "unsupported";

export type HistoricalStepConfidence =
  | "high_confidence"
  | "partial"
  | "unsupported";

export type HistoricalExecutionMode =
  | "api"
  | "chat"
  | "slack"
  | "ms_teams"
  | "email"
  | "schedule_trigger"
  | "unknown";

export type HistoricalCaseContext = {
  profileId: string | null;
  externalAgentId: string | null;
  teamIds: string[];
  teamIdsKnown: boolean;
  source: InteractionSource | null;
  executionMode: HistoricalExecutionMode;
  contextIsTrusted: boolean;
  unsafeContextBoundary?: UnsafeContextBoundary | null;
  dualLlmAnalysisCount: number;
};

type HistoricalSourceArtifactField =
  | "request"
  | "processedRequest"
  | "response";

export type HistoricalStepBase = {
  id: string;
  order: number;
  interactionId: string;
  createdAt: Date;
  providerType: SupportedProviderDiscriminator;
  context: HistoricalCaseContext;
  confidence: HistoricalStepConfidence;
  completeness: HistoricalStepCompleteness;
  reasons: string[];
  sourceArtifact: {
    interactionId: string;
    field: HistoricalSourceArtifactField;
    providerType: SupportedProviderDiscriminator;
  };
};

export type HistoricalToolCallStep = HistoricalStepBase & {
  type: "tool_call";
  toolCallId: string;
  toolName: string;
  toolId?: string;
  toolInput: Record<string, unknown>;
  enabledToolNames: string[];
};

export type HistoricalToolResultStep = HistoricalStepBase & {
  type: "tool_result";
  toolCallId: string;
  toolName: string;
  toolId?: string;
  toolOutput: unknown;
  isError: boolean;
  dualLlmAnalysisPresent: boolean;
};

export type HistoricalRefusalStep = HistoricalStepBase & {
  type: "refusal";
  toolName: string;
  toolId?: string;
  toolInput?: Record<string, unknown>;
  reason?: string;
};

export type HistoricalUnsupportedStep = HistoricalStepBase & {
  type: "unsupported";
};

export type HistoricalPolicyCaseStep =
  | HistoricalToolCallStep
  | HistoricalToolResultStep
  | HistoricalRefusalStep
  | HistoricalUnsupportedStep;

export type HistoricalPolicyCase = {
  id: string;
  sessionId: string | null;
  executionId: string | null;
  profileId: string | null;
  externalAgentId: string | null;
  providerTypes: SupportedProviderDiscriminator[];
  source: InteractionSource | null;
  executionMode: HistoricalExecutionMode;
  createdAt: Date;
  updatedAt: Date;
  replayability: HistoricalCaseReplayability;
  steps: HistoricalPolicyCaseStep[];
  reasons: string[];
};

export type HistoricalPolicyCaseExtractionResult = {
  cases: HistoricalPolicyCase[];
  completeCases: HistoricalPolicyCase[];
  partialCases: HistoricalPolicyCase[];
  unsupportedCases: HistoricalPolicyCase[];
  summary: {
    interactionsScanned: number;
    casesBuilt: number;
    completeCases: number;
    partialCases: number;
    unsupportedCases: number;
    completeSteps: number;
    missingPolicyInputSteps: number;
    unsupportedSteps: number;
  };
};

export type HistoricalCaseQueryParams = {
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
  sampleMode?: "recent" | "spread";
};

type ProviderFactory = {
  createRequestAdapter(request: never): {
    getToolResults(): CommonToolResult[];
    getTools(): CommonMcpToolDefinition[];
  };
  createResponseAdapter(response: never): {
    getToolCalls(): CommonToolCall[];
  };
};

const providerFactories: Partial<
  Record<SupportedProviderDiscriminator, ProviderFactory>
> = {
  "openai:chatCompletions": openaiAdapterFactory,
  "gemini:generateContent": geminiAdapterFactory,
  "anthropic:messages": anthropicAdapterFactory,
  "bedrock:converse": bedrockAdapterFactory,
  "cohere:chat": cohereAdapterFactory,
  "cerebras:chatCompletions": cerebrasAdapterFactory,
  "mistral:chatCompletions": mistralAdapterFactory,
  "perplexity:chatCompletions": perplexityAdapterFactory,
  "groq:chatCompletions": groqAdapterFactory,
  "xai:chatCompletions": xaiAdapterFactory,
  "openrouter:chatCompletions": openrouterAdapterFactory,
  "vllm:chatCompletions": vllmAdapterFactory,
  "ollama:chatCompletions": ollamaAdapterFactory,
  "zhipuai:chatCompletions": zhipuaiAdapterFactory,
  "deepseek:chatCompletions": deepseekAdapterFactory,
  "minimax:chatCompletions": minimaxAdapterFactory,
  "azure:chatCompletions": azureAdapterFactory,
  "azure:responses": azureResponsesAdapterFactory,
};

export async function getHistoricalPolicyCases(
  params: HistoricalCaseQueryParams,
): Promise<HistoricalPolicyCaseExtractionResult> {
  const limit = clampLimit(params.limit ?? 100);
  const whereClauses: SQL[] = [];

  if (params.profileIds) {
    if (params.profileIds.length === 0) {
      return buildExtractionResult([], 0);
    }
    whereClauses.push(
      inArray(schema.interactionsTable.profileId, params.profileIds),
    );
  } else if (params.profileId) {
    whereClauses.push(eq(schema.interactionsTable.profileId, params.profileId));
  }
  if (params.sessionId) {
    whereClauses.push(eq(schema.interactionsTable.sessionId, params.sessionId));
  }
  if (params.interactionId) {
    whereClauses.push(eq(schema.interactionsTable.id, params.interactionId));
  }
  if (params.startDate) {
    whereClauses.push(
      gte(schema.interactionsTable.createdAt, params.startDate),
    );
  }
  if (params.endDate) {
    whereClauses.push(lte(schema.interactionsTable.createdAt, params.endDate));
  }

  const candidateInteractions = await db
    .select()
    .from(schema.interactionsTable)
    .where(whereClauses.length > 0 ? and(...whereClauses) : undefined)
    .orderBy(
      params.sampleMode === "spread"
        ? sql`md5(${schema.interactionsTable.id}::text)`
        : desc(schema.interactionsTable.createdAt),
    )
    .limit(Math.min(limit * 25, 2500));

  const interactions = await loadCompleteInteractionGroups(
    candidateInteractions as Interaction[],
  );

  const profileIds = [
    ...new Set(
      interactions
        .map((interaction) => interaction.profileId)
        .filter((profileId): profileId is string => Boolean(profileId)),
    ),
  ];
  const teamIdsByProfileId = new Map<string, string[]>();
  await Promise.all(
    profileIds.map(async (profileId) => {
      teamIdsByProfileId.set(
        profileId,
        await AgentTeamModel.getTeamsForAgent(profileId),
      );
    }),
  );

  const initialExtraction = extractHistoricalPolicyCasesFromInteractions(
    interactions as Interaction[],
    {
      teamIdsByProfileId,
    },
  );

  const toolNames = [
    ...new Set(
      initialExtraction.cases.flatMap((policyCase) =>
        policyCase.steps.flatMap((step) =>
          "toolName" in step ? [step.toolName] : [],
        ),
      ),
    ),
  ];
  const toolIdsByName = new Map<string, string>();
  if (toolNames.length > 0) {
    const tools = await db
      .select({ id: schema.toolsTable.id, name: schema.toolsTable.name })
      .from(schema.toolsTable)
      .where(inArray(schema.toolsTable.name, toolNames));
    for (const tool of tools) {
      toolIdsByName.set(tool.name, tool.id);
    }
  }

  return extractHistoricalPolicyCasesFromInteractions(
    interactions as Interaction[],
    {
      teamIdsByProfileId,
      toolIdsByName,
      toolName: params.toolName,
      toolNames: params.toolNames,
      toolIds: params.toolIds,
      limit,
    },
  );
}

async function loadCompleteInteractionGroups(
  candidateInteractions: Interaction[],
): Promise<Interaction[]> {
  if (candidateInteractions.length === 0) {
    return [];
  }

  const sessionIds = [
    ...new Set(
      candidateInteractions
        .map((interaction) => interaction.sessionId)
        .filter((sessionId): sessionId is string => Boolean(sessionId)),
    ),
  ];
  const executionIds = [
    ...new Set(
      candidateInteractions
        .map((interaction) => interaction.executionId)
        .filter((executionId): executionId is string => Boolean(executionId)),
    ),
  ];
  const singletonInteractionIds = candidateInteractions
    .filter((interaction) => !interaction.sessionId && !interaction.executionId)
    .map((interaction) => interaction.id);
  const profileIds = [
    ...new Set(
      candidateInteractions
        .map((interaction) => interaction.profileId)
        .filter((profileId): profileId is string => Boolean(profileId)),
    ),
  ];

  const identityClauses: SQL[] = [];
  if (sessionIds.length > 0) {
    identityClauses.push(
      inArray(schema.interactionsTable.sessionId, sessionIds),
    );
  }
  if (executionIds.length > 0) {
    identityClauses.push(
      inArray(schema.interactionsTable.executionId, executionIds),
    );
  }
  if (singletonInteractionIds.length > 0) {
    identityClauses.push(
      inArray(schema.interactionsTable.id, singletonInteractionIds),
    );
  }
  if (identityClauses.length === 0) {
    return candidateInteractions;
  }

  const identityClause =
    identityClauses.length === 1 ? identityClauses[0] : or(...identityClauses);
  const profileClause =
    profileIds.length > 0
      ? inArray(schema.interactionsTable.profileId, profileIds)
      : undefined;

  return (await db
    .select()
    .from(schema.interactionsTable)
    .where(
      profileClause && identityClause
        ? and(profileClause, identityClause)
        : identityClause,
    )
    .orderBy(desc(schema.interactionsTable.createdAt))) as Interaction[];
}

export function extractHistoricalPolicyCasesFromInteractions(
  interactions: Interaction[],
  options: {
    teamIdsByProfileId?: Map<string, string[]>;
    toolIdsByName?: Map<string, string>;
    toolName?: string;
    toolNames?: string[];
    toolIds?: string[];
    limit?: number;
  } = {},
): HistoricalPolicyCaseExtractionResult {
  const sortedInteractions = [...interactions].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
  );
  const groups = new Map<string, Interaction[]>();

  for (const interaction of sortedInteractions) {
    const key = getCaseGroupKey(interaction);
    const existing = groups.get(key) ?? [];
    existing.push(interaction);
    groups.set(key, existing);
  }

  const filteredToolNames = new Set([
    ...(options.toolName ? [options.toolName] : []),
    ...(options.toolNames ?? []),
  ]);
  const filteredToolIds = new Set(options.toolIds ?? []);

  const cases = [...groups.entries()]
    .map(([groupKey, groupInteractions]) =>
      buildHistoricalCase(groupKey, groupInteractions, options),
    )
    .filter((policyCase) => {
      if (filteredToolNames.size === 0 && filteredToolIds.size === 0)
        return true;
      return policyCase.steps.some(
        (step) =>
          ("toolName" in step && filteredToolNames.has(step.toolName)) ||
          ("toolId" in step &&
            typeof step.toolId === "string" &&
            filteredToolIds.has(step.toolId)),
      );
    })
    .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
    .slice(0, options.limit ?? Number.POSITIVE_INFINITY);

  return buildExtractionResult(cases, interactions.length);
}

function buildHistoricalCase(
  groupKey: string,
  interactions: Interaction[],
  options: {
    teamIdsByProfileId?: Map<string, string[]>;
    toolIdsByName?: Map<string, string>;
  },
): HistoricalPolicyCase {
  let order = 0;
  const rawSteps = interactions.flatMap((interaction) => {
    const extracted = extractStepsFromInteraction(interaction, {
      orderStart: order,
      teamIds: interaction.profileId
        ? (options.teamIdsByProfileId?.get(interaction.profileId) ?? [])
        : [],
      teamIdsKnown: Boolean(
        interaction.profileId &&
          options.teamIdsByProfileId?.has(interaction.profileId),
      ),
      toolIdsByName: options.toolIdsByName,
    });
    order += extracted.length;
    return extracted;
  });
  const stepsForReplay = normalizeStepOrder(
    dedupeReplayedToolResults(dropNonPolicyRelevantUnsupportedSteps(rawSteps)),
  );
  const steps = applySequenceCompleteness(stepsForReplay);

  const providerTypes = [
    ...new Set(interactions.map((interaction) => interaction.type)),
  ];
  const reasons = getCaseReasons(interactions, steps);
  const replayability = getCaseReplayability(steps);
  const first = interactions[0];
  const last = interactions[interactions.length - 1];

  return {
    id: groupKey,
    sessionId: first.sessionId ?? null,
    executionId: first.executionId ?? null,
    profileId: first.profileId ?? null,
    externalAgentId: first.externalAgentId ?? null,
    providerTypes,
    source: first.source ?? null,
    executionMode: inferExecutionMode(first.source ?? null),
    createdAt: first.createdAt,
    updatedAt: last.createdAt,
    replayability,
    steps,
    reasons,
  };
}

function dropNonPolicyRelevantUnsupportedSteps(
  steps: HistoricalPolicyCaseStep[],
): HistoricalPolicyCaseStep[] {
  const hasPolicyRelevantStep = steps.some(
    (step) =>
      step.type !== "unsupported" ||
      !step.reasons.includes("no_tool_calls_or_results"),
  );

  if (!hasPolicyRelevantStep) {
    return steps;
  }

  return steps.filter(
    (step) =>
      step.type !== "unsupported" ||
      !step.reasons.includes("no_tool_calls_or_results"),
  );
}

function dedupeReplayedToolResults(
  steps: HistoricalPolicyCaseStep[],
): HistoricalPolicyCaseStep[] {
  const seenResultKeys = new Set<string>();

  return steps.filter((step) => {
    if (step.type !== "tool_result") {
      return true;
    }

    const resultKey = `${step.toolCallId}:${step.toolName}`;
    if (seenResultKeys.has(resultKey)) {
      return false;
    }

    seenResultKeys.add(resultKey);
    return true;
  });
}

function normalizeStepOrder(
  steps: HistoricalPolicyCaseStep[],
): HistoricalPolicyCaseStep[] {
  return steps.map((step, order) =>
    step.order === order ? step : { ...step, order },
  );
}

function extractStepsFromInteraction(
  interaction: Interaction,
  params: {
    orderStart: number;
    teamIds: string[];
    teamIdsKnown: boolean;
    toolIdsByName?: Map<string, string>;
  },
): HistoricalPolicyCaseStep[] {
  const factory = providerFactories[interaction.type];
  const baseContext = buildContext(
    interaction,
    params.teamIds,
    params.teamIdsKnown,
  );
  const base = {
    interactionId: interaction.id,
    createdAt: interaction.createdAt,
    providerType: interaction.type,
    context: baseContext,
  };

  if (!factory) {
    return [
      {
        ...base,
        id: `${interaction.id}:unsupported-provider`,
        order: params.orderStart,
        type: "unsupported",
        confidence: "unsupported",
        completeness: "unsupported",
        reasons: [`unsupported_provider:${interaction.type}`],
        sourceArtifact: {
          interactionId: interaction.id,
          field: "request",
          providerType: interaction.type,
        },
      },
    ];
  }

  const steps: HistoricalPolicyCaseStep[] = [];
  const enabledToolNames = extractEnabledToolNames(
    factory,
    interaction.processedRequest ?? interaction.request,
  );
  const toolResultSource = getToolResultSource(factory, interaction);

  for (const toolResult of toolResultSource.toolResults) {
    const step = buildToolResultStep({
      toolResult,
      base,
      order: params.orderStart + steps.length,
      toolIdsByName: params.toolIdsByName,
      sourceField: toolResultSource.field,
      dualLlmAnalysisPresent: hasDualLlmAnalysisForToolCall(
        interaction,
        toolResult.id,
      ),
    });
    steps.push(step);
  }

  for (const refusal of extractRefusals(interaction.response)) {
    const step = buildRefusalStep({
      refusal,
      base,
      order: params.orderStart + steps.length,
      toolIdsByName: params.toolIdsByName,
    });
    steps.push(step);
  }

  for (const toolCall of safeGetToolCalls(factory, interaction.response)) {
    const step = buildToolCallStep({
      toolCall,
      base,
      order: params.orderStart + steps.length,
      enabledToolNames,
      toolIdsByName: params.toolIdsByName,
    });
    steps.push(step);
  }

  if (steps.length === 0) {
    return [
      {
        ...base,
        id: `${interaction.id}:no-policy-relevant-steps`,
        order: params.orderStart,
        type: "unsupported",
        confidence: "unsupported",
        completeness: "unsupported",
        reasons: ["no_tool_calls_or_results"],
        sourceArtifact: {
          interactionId: interaction.id,
          field: "response",
          providerType: interaction.type,
        },
      },
    ];
  }

  return steps;
}

function buildToolCallStep(params: {
  toolCall: CommonToolCall;
  base: Pick<
    HistoricalStepBase,
    "interactionId" | "createdAt" | "providerType" | "context"
  >;
  order: number;
  enabledToolNames: string[];
  toolIdsByName?: Map<string, string>;
}): HistoricalToolCallStep {
  const toolId = params.toolIdsByName?.get(params.toolCall.name);
  const reasons = getCommonStepMissingReasons(params.base.context, toolId);
  if (
    params.enabledToolNames.length > 0 &&
    !params.enabledToolNames.includes(params.toolCall.name) &&
    !archestraMcpBranding.isToolName(params.toolCall.name)
  ) {
    reasons.push("tool_not_enabled_for_interaction");
  }
  const isUnsupported = reasons.includes("tool_not_enabled_for_interaction");

  return {
    ...params.base,
    id: `${params.base.interactionId}:call:${params.toolCall.id}`,
    order: params.order,
    type: "tool_call",
    toolCallId: params.toolCall.id,
    toolName: params.toolCall.name,
    toolId,
    toolInput: params.toolCall.arguments,
    enabledToolNames: params.enabledToolNames,
    confidence: isUnsupported
      ? "unsupported"
      : reasons.length > 0
        ? "partial"
        : "high_confidence",
    completeness: isUnsupported
      ? "unsupported"
      : reasons.length > 0
        ? "missing_policy_input"
        : "complete",
    reasons,
    sourceArtifact: {
      interactionId: params.base.interactionId,
      field: "response",
      providerType: params.base.providerType,
    },
  };
}

function buildToolResultStep(params: {
  toolResult: CommonToolResult;
  base: Pick<
    HistoricalStepBase,
    "interactionId" | "createdAt" | "providerType" | "context"
  >;
  order: number;
  toolIdsByName?: Map<string, string>;
  sourceField: Extract<
    HistoricalSourceArtifactField,
    "request" | "processedRequest"
  >;
  dualLlmAnalysisPresent: boolean;
}): HistoricalToolResultStep {
  const toolId = params.toolIdsByName?.get(params.toolResult.name);
  const reasons = getCommonStepMissingReasons(params.base.context, toolId);
  if (params.toolResult.name === "unknown") {
    reasons.push("missing_tool_name");
  }

  return {
    ...params.base,
    id: `${params.base.interactionId}:result:${params.toolResult.id}`,
    order: params.order,
    type: "tool_result",
    toolCallId: params.toolResult.id,
    toolName: params.toolResult.name,
    toolId,
    toolOutput: params.toolResult.content,
    isError: params.toolResult.isError,
    dualLlmAnalysisPresent: params.dualLlmAnalysisPresent,
    confidence: reasons.length > 0 ? "partial" : "high_confidence",
    completeness: reasons.length > 0 ? "missing_policy_input" : "complete",
    reasons,
    sourceArtifact: {
      interactionId: params.base.interactionId,
      field: params.sourceField,
      providerType: params.base.providerType,
    },
  };
}

function buildRefusalStep(params: {
  refusal: {
    toolName: string;
    toolInput?: Record<string, unknown>;
    reason?: string;
  };
  base: Pick<
    HistoricalStepBase,
    "interactionId" | "createdAt" | "providerType" | "context"
  >;
  order: number;
  toolIdsByName?: Map<string, string>;
}): HistoricalRefusalStep {
  const toolId = params.toolIdsByName?.get(params.refusal.toolName);
  const reasons = getCommonStepMissingReasons(params.base.context, toolId);
  if (!params.refusal.toolInput) {
    reasons.push("missing_tool_arguments");
  }

  return {
    ...params.base,
    id: `${params.base.interactionId}:refusal:${params.refusal.toolName}`,
    order: params.order,
    type: "refusal",
    toolName: params.refusal.toolName,
    toolId,
    toolInput: params.refusal.toolInput,
    reason: params.refusal.reason,
    confidence: reasons.length > 0 ? "partial" : "high_confidence",
    completeness: reasons.length > 0 ? "missing_policy_input" : "complete",
    reasons,
    sourceArtifact: {
      interactionId: params.base.interactionId,
      field: "response",
      providerType: params.base.providerType,
    },
  };
}

function applySequenceCompleteness(
  steps: HistoricalPolicyCaseStep[],
): HistoricalPolicyCaseStep[] {
  const seenToolCallsById = new Map<string, HistoricalToolCallStep>();

  return steps.map((step) => {
    if (step.type === "tool_call") {
      seenToolCallsById.set(step.toolCallId, step);
      return step;
    }
    if (step.type !== "tool_result") {
      return step;
    }

    const matchingCall = seenToolCallsById.get(step.toolCallId);
    if (!matchingCall) {
      return markMissingPolicyInput(step, "missing_tool_call_link");
    }
    if (matchingCall.toolName !== step.toolName) {
      return markMissingPolicyInput(step, "tool_result_call_mismatch");
    }
    return step;
  });
}

function markMissingPolicyInput<T extends HistoricalPolicyCaseStep>(
  step: T,
  reason: string,
): T {
  if (step.reasons.includes(reason)) {
    return step;
  }

  return {
    ...step,
    completeness: "missing_policy_input",
    confidence: step.confidence === "unsupported" ? "unsupported" : "partial",
    reasons: [...step.reasons, reason],
  };
}

function buildContext(
  interaction: Interaction,
  teamIds: string[],
  teamIdsKnown: boolean,
): HistoricalCaseContext {
  return {
    profileId: interaction.profileId ?? null,
    externalAgentId: interaction.externalAgentId ?? null,
    teamIds,
    teamIdsKnown,
    source: interaction.source ?? null,
    executionMode: inferExecutionMode(interaction.source ?? null),
    contextIsTrusted: !interaction.unsafeContextBoundary,
    unsafeContextBoundary: interaction.unsafeContextBoundary ?? null,
    dualLlmAnalysisCount: Array.isArray(interaction.dualLlmAnalyses)
      ? interaction.dualLlmAnalyses.length
      : 0,
  };
}

function inferExecutionMode(
  source: InteractionSource | null,
): HistoricalExecutionMode {
  switch (source) {
    case "api":
      return "api";
    case "chat":
      return "chat";
    case "chatops:slack":
      return "slack";
    case "chatops:ms-teams":
      return "ms_teams";
    case "email":
      return "email";
    case "schedule-trigger":
      return "schedule_trigger";
    default:
      return "unknown";
  }
}

function getCommonStepMissingReasons(
  context: HistoricalCaseContext,
  toolId?: string,
): string[] {
  const reasons: string[] = [];
  if (!context.profileId) {
    reasons.push("missing_profile_id");
  }
  if (!context.teamIdsKnown) {
    reasons.push("missing_team_ids");
  }
  if (context.executionMode === "unknown") {
    reasons.push("missing_execution_mode");
  }
  if (!toolId) {
    reasons.push("missing_tool_id");
  }
  return reasons;
}

function getCaseReplayability(
  steps: HistoricalPolicyCaseStep[],
): HistoricalCaseReplayability {
  if (steps.length === 0) {
    return "unsupported";
  }
  if (steps.every((step) => step.completeness === "complete")) {
    return "complete";
  }
  if (steps.some((step) => step.completeness === "complete")) {
    return "partial";
  }
  return "unsupported";
}

function getCaseReasons(
  interactions: Interaction[],
  steps: HistoricalPolicyCaseStep[],
): string[] {
  const reasons = new Set<string>();
  if (interactions.every((interaction) => !interaction.sessionId)) {
    reasons.add("missing_session_id");
  }
  if (interactions.every((interaction) => !interaction.executionId)) {
    reasons.add("missing_execution_id");
  }
  for (const step of steps) {
    for (const reason of step.reasons) {
      reasons.add(reason);
    }
  }
  return [...reasons];
}

function getCaseGroupKey(interaction: Interaction): string {
  if (interaction.sessionId) {
    return `session:${interaction.sessionId}`;
  }
  if (interaction.executionId) {
    return `execution:${interaction.executionId}`;
  }
  return `interaction:${interaction.id}`;
}

function buildExtractionResult(
  cases: HistoricalPolicyCase[],
  interactionsScanned: number,
): HistoricalPolicyCaseExtractionResult {
  const completeCases = cases.filter(
    (policyCase) => policyCase.replayability === "complete",
  );
  const partialCases = cases.filter(
    (policyCase) => policyCase.replayability === "partial",
  );
  const unsupportedCases = cases.filter(
    (policyCase) => policyCase.replayability === "unsupported",
  );
  const steps = cases.flatMap((policyCase) => policyCase.steps);

  return {
    cases,
    completeCases,
    partialCases,
    unsupportedCases,
    summary: {
      interactionsScanned,
      casesBuilt: cases.length,
      completeCases: completeCases.length,
      partialCases: partialCases.length,
      unsupportedCases: unsupportedCases.length,
      completeSteps: steps.filter((step) => step.completeness === "complete")
        .length,
      missingPolicyInputSteps: steps.filter(
        (step) => step.completeness === "missing_policy_input",
      ).length,
      unsupportedSteps: steps.filter(
        (step) => step.completeness === "unsupported",
      ).length,
    },
  };
}

function safeGetToolCalls(
  factory: ProviderFactory,
  response: unknown,
): CommonToolCall[] {
  try {
    return factory.createResponseAdapter(response as never).getToolCalls();
  } catch {
    return [];
  }
}

function safeGetToolResults(
  factory: ProviderFactory,
  request: unknown,
): CommonToolResult[] {
  try {
    return factory.createRequestAdapter(request as never).getToolResults();
  } catch {
    return [];
  }
}

function getToolResultSource(
  factory: ProviderFactory,
  interaction: Interaction,
): {
  field: Extract<HistoricalSourceArtifactField, "request" | "processedRequest">;
  toolResults: CommonToolResult[];
} {
  const rawResults = safeGetToolResults(factory, interaction.request);
  if (rawResults.length > 0) {
    return { field: "request", toolResults: rawResults };
  }

  if (interaction.processedRequest) {
    const processedResults = safeGetToolResults(
      factory,
      interaction.processedRequest,
    );
    if (processedResults.length > 0) {
      return { field: "processedRequest", toolResults: processedResults };
    }
  }

  return {
    field: "request",
    toolResults: rawResults,
  };
}

function hasDualLlmAnalysisForToolCall(
  interaction: Interaction,
  toolCallId: string,
): boolean {
  return Boolean(
    interaction.dualLlmAnalyses?.some(
      (analysis) => analysis.toolCallId === toolCallId,
    ),
  );
}

function extractEnabledToolNames(
  factory: ProviderFactory,
  request: unknown,
): string[] {
  try {
    return factory
      .createRequestAdapter(request as never)
      .getTools()
      .map((tool) => tool.name);
  } catch {
    return [];
  }
}

function extractRefusals(response: unknown): Array<{
  toolName: string;
  toolInput?: Record<string, unknown>;
  reason?: string;
}> {
  return collectStrings(response).flatMap((value) => {
    const parsed = parseArchestraToolRefusal(value);
    if (!parsed.toolName) {
      return [];
    }

    return [
      {
        toolName: parsed.toolName,
        toolInput: parseToolArguments(parsed.toolArguments),
        reason: parsed.reason,
      },
    ];
  });
}

function collectStrings(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap(collectStrings);
  }
  if (value && typeof value === "object") {
    return Object.values(value).flatMap(collectStrings);
  }
  return [];
}

function parseToolArguments(
  toolArguments: string | undefined,
): Record<string, unknown> | undefined {
  if (!toolArguments) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(toolArguments);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

function clampLimit(limit: number): number {
  if (!Number.isFinite(limit)) {
    return 100;
  }
  return Math.min(Math.max(Math.floor(limit), 1), 500);
}
