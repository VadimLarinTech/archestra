"use client";

import {
  DynamicInteraction,
  type Interaction,
  isAgentTool,
  parseFullToolName,
} from "@shared";
import { Search, TestTube2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { CallPolicyToggle } from "@/app/mcp/tool-guardrails/_parts/call-policy-toggle";
import {
  PolicyDryRunResultPanel,
  type PolicyDryRunScope,
} from "@/app/mcp/tool-guardrails/_parts/policy-dry-run";
import { ToolCallPolicies } from "@/app/mcp/tool-guardrails/_parts/tool-call-policies";
import { ToolResultPolicies } from "@/app/mcp/tool-guardrails/_parts/tool-result-policies";
import { FormDialog } from "@/components/form-dialog";
import { LoadingSpinner } from "@/components/loading";
import { TruncatedText } from "@/components/truncated-text";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DialogBody, DialogStickyFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAllProfileTools } from "@/lib/agent-tools.query";
import { useHasPermissions } from "@/lib/auth/auth.query";
import { useInteractions } from "@/lib/interactions/interaction.query";
import { useInternalMcpCatalog } from "@/lib/mcp/internal-mcp-catalog.query";
import { useOrganization } from "@/lib/organization.query";
import {
  type PolicyDryRunResponse,
  usePolicyDryRunMutation,
  useToolInvocationPolicies,
  useToolResultPolicies,
} from "@/lib/policy.query";
import {
  type CallPolicyAction,
  getCallPolicyActionFromPolicies,
  getResultPolicyActionFromPolicies,
  RESULT_POLICY_ACTION_OPTIONS,
  type ResultPolicyAction,
} from "@/lib/policy.utils";
import {
  type ToolWithAssignmentsData,
  useToolsWithAssignments,
} from "@/lib/tools/tool.query";
import { isMcpToolByProperties } from "@/lib/tools/tool.utils";
import { getToolSourceName } from "@/lib/tools/tool-source";

type PolicyTool = Pick<
  ToolWithAssignmentsData,
  "id" | "name" | "catalogId" | "assignments"
>;

interface EditPolicyDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  toolName?: string;
  toolNames?: string[];
  profileId?: string;
  dryRunScope?: PolicyDryRunScope;
  onDryRunResult?: (
    result: PolicyDryRunResponse | null,
    draftChanges?: ScopedPolicyDraftChanges | null,
  ) => void;
}

export type ScopedPolicyDraftChanges = {
  toolInvocationDefaultActions: Array<{
    toolId: string;
    action: CallPolicyAction;
  }>;
  trustedDataDefaultActions: Array<{
    toolId: string;
    action: ResultPolicyAction;
  }>;
};

export function EditPolicyDialog({
  open,
  onOpenChange,
  toolName,
  toolNames,
  profileId,
  dryRunScope,
  onDryRunResult,
}: EditPolicyDialogProps) {
  const [selectedToolName, setSelectedToolName] = useState<string | undefined>(
    toolName,
  );
  const [activeDryRunResult, setActiveDryRunResult] =
    useState<PolicyDryRunResponse | null>(null);
  const isScopedDryRun = Boolean(dryRunScope);
  const { data: canUpdateToolPolicy, isLoading: isLoadingPermissions } =
    useHasPermissions({
      toolPolicy: ["update"],
    });
  const { data: organization } = useOrganization();
  const { data: agentToolsData, isLoading: isLoadingAgentTools } =
    useAllProfileTools({
      filters: {
        agentId: profileId,
        search: toolName,
      },
      pagination: toolName ? { limit: 50 } : undefined,
      enabled:
        !isScopedDryRun && Boolean(profileId) && canUpdateToolPolicy === true,
    });

  const tools = agentToolsData?.data ?? [];
  const supportMessage = organization?.chatErrorSupportMessage?.trim();

  useEffect(() => {
    if (!open) {
      return;
    }
    setSelectedToolName(toolName);
    setActiveDryRunResult(null);
    onDryRunResult?.(null, null);
  }, [toolName, open, onDryRunResult]);

  useEffect(() => {
    if (isScopedDryRun || selectedToolName || tools.length !== 1) {
      return;
    }
    setSelectedToolName(tools[0]?.tool.name);
  }, [isScopedDryRun, selectedToolName, tools]);

  const agentTool = selectedToolName
    ? tools.find((t) => t.tool.name === selectedToolName)
    : undefined;
  const selectedToolLabel = agentTool?.tool.name ?? selectedToolName;
  const description = isScopedDryRun
    ? "Draft policy changes for tools used in this conversation"
    : selectedToolLabel
      ? `Configure policies for ${selectedToolLabel}`
      : "Configure policies for an assigned tool";
  const showToolSelector = !isScopedDryRun && !toolName && tools.length > 0;
  const selectedToolOptions = useMemo(
    () =>
      tools.map((item) => ({
        id: item.tool.id,
        name: item.tool.name,
      })),
    [tools],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isScopedDryRun ? "Chat policies" : "Edit Policies"}
      description={description}
      size="large"
    >
      <DialogBody>
        {isLoadingPermissions ? (
          <div className="flex items-center justify-center py-6">
            <LoadingSpinner />
          </div>
        ) : canUpdateToolPolicy === false ? (
          <p className="text-muted-foreground text-sm">
            {supportMessage ||
              "You do not have permission to edit tool guardrails. Contact your administrator or support team for help."}
          </p>
        ) : isScopedDryRun ? (
          <ScopedPolicyDraft
            dryRunScope={dryRunScope}
            explicitToolNames={toolNames ?? (toolName ? [toolName] : undefined)}
            onClose={() => onOpenChange(false)}
            dryRunResult={activeDryRunResult}
            closeOnDryRunSuccess={Boolean(onDryRunResult)}
            onDryRunResult={(result, draftChanges) => {
              setActiveDryRunResult(result);
              onDryRunResult?.(result, draftChanges ?? null);
            }}
          />
        ) : (
          <div className="space-y-4">
            {showToolSelector ? (
              <Select
                value={selectedToolName}
                onValueChange={(value) => {
                  setSelectedToolName(value);
                  setActiveDryRunResult(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select tool" />
                </SelectTrigger>
                <SelectContent>
                  {selectedToolOptions.map((tool) => (
                    <SelectItem key={tool.id} value={tool.name}>
                      {tool.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {isLoadingAgentTools ? (
              <div className="flex items-center justify-center py-6">
                <LoadingSpinner />
              </div>
            ) : agentTool ? (
              <>
                <ToolCallPolicies tool={agentTool.tool} />
                <ToolResultPolicies tool={agentTool.tool} />
              </>
            ) : selectedToolName ? (
              <p className="text-muted-foreground text-sm">
                Tool not found or not assigned to this Agent.
              </p>
            ) : tools.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                No assigned tools found for this Agent.
              </p>
            ) : (
              <p className="text-muted-foreground text-sm">
                Select a tool to edit policies.
              </p>
            )}
          </div>
        )}
      </DialogBody>
    </FormDialog>
  );
}

function ScopedPolicyDraft({
  dryRunScope,
  explicitToolNames,
  onClose,
  dryRunResult,
  closeOnDryRunSuccess,
  onDryRunResult,
}: {
  dryRunScope?: PolicyDryRunScope;
  explicitToolNames?: string[];
  onClose: () => void;
  dryRunResult: PolicyDryRunResponse | null;
  closeOnDryRunSuccess: boolean;
  onDryRunResult: (
    result: PolicyDryRunResponse | null,
    draftChanges?: ScopedPolicyDraftChanges | null,
  ) => void;
}) {
  const [selectedToolIds, setSelectedToolIds] = useState<Set<string>>(
    new Set(),
  );
  const [draftCallActions, setDraftCallActions] = useState<
    Record<string, CallPolicyAction>
  >({});
  const [draftResultActions, setDraftResultActions] = useState<
    Record<string, ResultPolicyAction>
  >({});
  const [toolSearch, setToolSearch] = useState("");
  const dryRunMutation = usePolicyDryRunMutation();
  const { data: invocationPolicies } = useToolInvocationPolicies();
  const { data: resultPolicies } = useToolResultPolicies();
  const { data: sessionInteractions, isLoading: isLoadingSessionInteractions } =
    useInteractions({
      sessionId: dryRunScope?.sessionId,
      sortBy: "createdAt",
      sortDirection: "asc",
      enabled: Boolean(dryRunScope?.sessionId),
    });

  const usedToolNames = useMemo(() => {
    if (explicitToolNames?.length) {
      return getPolicyEditableToolNames(explicitToolNames);
    }
    if (!dryRunScope?.sessionId) {
      return [];
    }
    return getScopedPolicyToolNames(sessionInteractions?.data ?? []);
  }, [dryRunScope?.sessionId, explicitToolNames, sessionInteractions?.data]);
  const { data: scopedToolsData, isLoading: isLoadingScopedTools } =
    useToolsWithAssignments({
      sorting: {
        sortBy: "name",
        sortDirection: "asc",
      },
      filters: {
        excludeArchestraTools: true,
        toolNames: usedToolNames.length > 0 ? usedToolNames : undefined,
      },
      enabled:
        usedToolNames.length > 0 &&
        !(dryRunScope?.sessionId && isLoadingSessionInteractions),
    });
  const tools = scopedToolsData?.data ?? [];
  const { data: internalMcpCatalogItems } = useInternalMcpCatalog({
    enabled: usedToolNames.length > 0,
  });

  const scopedTools = useMemo(() => {
    return getScopedPolicyTools(tools, usedToolNames);
  }, [tools, usedToolNames]);

  useEffect(() => {
    setSelectedToolIds(new Set(scopedTools.map((item) => item.id)));
    setDraftCallActions({});
    setDraftResultActions({});
    setToolSearch("");
  }, [scopedTools]);

  const visibleScopedTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase();
    if (!query) {
      return scopedTools;
    }
    return scopedTools.filter((item) => {
      const displayName = getDisplayToolName(item.name);
      return (
        item.name.toLowerCase().includes(query) ||
        displayName.toLowerCase().includes(query)
      );
    });
  }, [scopedTools, toolSearch]);
  const visibleToolIds = useMemo(
    () => visibleScopedTools.map((item) => item.id),
    [visibleScopedTools],
  );
  const selectedCount = selectedToolIds.size;
  const selectedVisibleCount = visibleToolIds.filter((toolId) =>
    selectedToolIds.has(toolId),
  ).length;
  const allVisibleSelected =
    visibleToolIds.length > 0 && selectedVisibleCount === visibleToolIds.length;
  const someVisibleSelected =
    selectedVisibleCount > 0 && selectedVisibleCount < visibleToolIds.length;
  const callActionChanges = scopedTools
    .map((item) => {
      const current = getCurrentCallAction(item, invocationPolicies);
      const draft = draftCallActions[item.id] ?? current;
      return draft !== current ? { toolId: item.id, action: draft } : null;
    })
    .filter((change): change is { toolId: string; action: CallPolicyAction } =>
      Boolean(change),
    );
  const resultActionChanges = scopedTools
    .map((item) => {
      const current = getCurrentResultAction(item, resultPolicies);
      const draft = draftResultActions[item.id] ?? current;
      return draft !== current ? { toolId: item.id, action: draft } : null;
    })
    .filter(
      (change): change is { toolId: string; action: ResultPolicyAction } =>
        Boolean(change),
    );
  const hasDraftChanges =
    callActionChanges.length > 0 || resultActionChanges.length > 0;
  const isLoading = isLoadingScopedTools || isLoadingSessionInteractions;

  const applyBulkCallAction = (action: CallPolicyAction) => {
    setDraftCallActions((current) => {
      const next = { ...current };
      for (const toolId of selectedToolIds) {
        next[toolId] = action;
      }
      return next;
    });
  };

  const applyBulkResultAction = (action: ResultPolicyAction) => {
    setDraftResultActions((current) => {
      const next = { ...current };
      for (const toolId of selectedToolIds) {
        next[toolId] = action;
      }
      return next;
    });
  };

  const toggleVisibleTools = (checked: boolean) => {
    setSelectedToolIds((current) => {
      const next = new Set(current);
      for (const toolId of visibleToolIds) {
        if (checked) {
          next.add(toolId);
        } else {
          next.delete(toolId);
        }
      }
      return next;
    });
  };

  const handleRun = () => {
    if (!hasDraftChanges) return;
    const draftChanges: ScopedPolicyDraftChanges = {
      toolInvocationDefaultActions: callActionChanges,
      trustedDataDefaultActions: resultActionChanges,
    };
    dryRunMutation.mutate(
      {
        policyFamily: "combined",
        ...dryRunScope,
        toolIds: scopedTools.map((item) => item.id),
        toolNames:
          scopedTools.length > 0
            ? scopedTools.map((item) => item.name)
            : undefined,
        limit: dryRunScope?.sessionId || dryRunScope?.interactionId ? 500 : 100,
        toolInvocationDefaultActions: draftChanges.toolInvocationDefaultActions,
        trustedDataDefaultActions: draftChanges.trustedDataDefaultActions,
      },
      {
        onSuccess: (result) => {
          onDryRunResult(result, draftChanges);
          if (closeOnDryRunSuccess) {
            onClose();
          }
        },
      },
    );
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8">
        <LoadingSpinner />
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="space-y-4">
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">
          <div className="flex items-start gap-2">
            <TestTube2 className="mt-0.5 h-4 w-4 text-amber-500" />
            <div className="space-y-1">
              <p className="font-medium text-foreground">
                Draft mode: live policies stay unchanged.
              </p>
              <p className="text-muted-foreground">
                Tools and LLM calls are not executed. The run uses historical
                interactions from this conversation.
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border bg-muted/30 p-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="min-w-0">
              <div className="text-sm font-medium">
                {scopedTools.length} tool{scopedTools.length === 1 ? "" : "s"}{" "}
                used in this conversation
              </div>
              <div className="text-xs text-muted-foreground">
                {selectedCount} selected for bulk draft changes
                {toolSearch.trim()
                  ? ` · ${visibleScopedTools.length} matching`
                  : ""}
              </div>
            </div>
          </div>
          <div className="grid min-w-0 gap-2 sm:grid-cols-[240px_168px_150px] sm:items-end xl:flex-1 xl:justify-end">
            <div className="flex min-w-0 flex-col gap-1">
              <span
                aria-hidden="true"
                className="invisible text-xs font-medium text-muted-foreground"
              >
                Filter
              </span>
              <div className="relative min-w-0">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input
                  value={toolSearch}
                  onChange={(event) => setToolSearch(event.target.value)}
                  placeholder="Filter tools"
                  className="h-8 w-full pl-9 text-sm"
                />
              </div>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Call Policy:
              </span>
              <Select
                disabled={selectedCount === 0}
                onValueChange={(value: CallPolicyAction) =>
                  applyBulkCallAction(value)
                }
              >
                <SelectTrigger className="h-8 w-full text-sm" size="sm">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="allow_when_context_is_untrusted">
                    Allow always
                  </SelectItem>
                  <SelectItem value="block_when_context_is_untrusted">
                    Allow in safe context
                  </SelectItem>
                  <SelectItem value="require_approval">
                    Require approval
                  </SelectItem>
                  <SelectItem value="block_always">Block always</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-xs font-medium text-muted-foreground">
                Results are:
              </span>
              <Select
                disabled={selectedCount === 0}
                onValueChange={(value: ResultPolicyAction) =>
                  applyBulkResultAction(value)
                }
              >
                <SelectTrigger className="h-8 w-full text-sm" size="sm">
                  <SelectValue placeholder="Select action" />
                </SelectTrigger>
                <SelectContent>
                  {RESULT_POLICY_ACTION_OPTIONS.map(({ value, label }) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>

        {scopedTools.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tools from this conversation were found.
          </div>
        ) : visibleScopedTools.length === 0 ? (
          <div className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
            No tools match the current filter.
          </div>
        ) : (
          <div className="max-h-[52vh] overflow-y-auto rounded-lg border">
            <Table className="min-w-[620px]">
              <colgroup>
                <col className="w-[44px]" />
                <col />
                <col className="w-[170px]" />
                <col className="w-[150px]" />
              </colgroup>
              <TableHeader className="sticky top-0 z-10 bg-background">
                <TableRow className="hover:bg-transparent">
                  <TableHead>
                    <Checkbox
                      checked={
                        allVisibleSelected ||
                        (someVisibleSelected && "indeterminate")
                      }
                      disabled={visibleToolIds.length === 0}
                      onCheckedChange={(value) =>
                        toggleVisibleTools(value === true)
                      }
                      aria-label="Select visible conversation tools"
                    />
                  </TableHead>
                  <TableHead>Tool Name</TableHead>
                  <TableHead>Call Policy</TableHead>
                  <TableHead>Results are</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleScopedTools.map((item) => {
                  const toolId = item.id;
                  const currentCall = getCurrentCallAction(
                    item,
                    invocationPolicies,
                  );
                  const currentResult = getCurrentResultAction(
                    item,
                    resultPolicies,
                  );
                  const draftCall = draftCallActions[toolId] ?? currentCall;
                  const draftResult =
                    draftResultActions[toolId] ?? currentResult;
                  const hasCustomCallPolicy = hasCustomPolicies(
                    invocationPolicies?.byProfileToolId[toolId],
                  );
                  const hasCustomResultPolicy = hasCustomPolicies(
                    resultPolicies?.byProfileToolId[toolId],
                  );
                  const checked = selectedToolIds.has(toolId);
                  const sourceName = getToolSourceName(
                    item,
                    internalMcpCatalogItems,
                  );

                  return (
                    <TableRow key={toolId} data-state={checked && "selected"}>
                      <TableCell>
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(value) => {
                            setSelectedToolIds((current) => {
                              const next = new Set(current);
                              if (value) {
                                next.add(toolId);
                              } else {
                                next.delete(toolId);
                              }
                              return next;
                            });
                          }}
                          aria-label={`Select ${item.name}`}
                        />
                      </TableCell>
                      <TableCell>
                        <div className="min-w-0 space-y-1">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="max-w-[260px] truncate md:max-w-none">
                              <TruncatedText
                                message={getDisplayToolName(item.name)}
                                className="break-all text-sm font-medium"
                                maxLength={60}
                              />
                            </div>
                            <Badge
                              variant="outline"
                              className="h-5 shrink-0 px-1.5 text-[10px]"
                            >
                              {sourceName}
                            </Badge>
                          </div>
                          <div className="flex flex-wrap gap-1">
                            {hasCustomCallPolicy || hasCustomResultPolicy ? (
                              <Badge
                                variant="secondary"
                                className="text-[10px]"
                              >
                                Custom policy exists
                              </Badge>
                            ) : null}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="sr-only">Call Policy</span>
                          <CallPolicyToggle
                            value={draftCall}
                            onChange={(action) =>
                              setDraftCallActions((current) => ({
                                ...current,
                                [toolId]: action,
                              }))
                            }
                            size="sm"
                          />
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="sr-only">Results are</span>
                          <Select
                            value={draftResult}
                            onValueChange={(value: ResultPolicyAction) =>
                              setDraftResultActions((current) => ({
                                ...current,
                                [toolId]: value,
                              }))
                            }
                          >
                            <SelectTrigger
                              className="h-8 w-[150px] text-xs"
                              size="sm"
                              aria-label="Results are"
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {RESULT_POLICY_ACTION_OPTIONS.map(
                                ({ value, label }) => (
                                  <SelectItem key={value} value={value}>
                                    {label}
                                  </SelectItem>
                                ),
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
      {!closeOnDryRunSuccess && dryRunResult ? (
        <div className="mt-4">
          <PolicyDryRunResultPanel result={dryRunResult} />
        </div>
      ) : null}
      <DialogStickyFooter className="mt-4 flex-col gap-2 sm:flex-row">
        <Button
          variant="outline"
          onClick={onClose}
          className="w-full sm:w-auto"
        >
          Cancel
        </Button>
        <Button
          onClick={handleRun}
          disabled={
            !hasDraftChanges ||
            scopedTools.length === 0 ||
            dryRunMutation.isPending
          }
          className="w-full sm:w-auto"
        >
          {dryRunMutation.isPending ? "Running..." : "Run"}
        </Button>
      </DialogStickyFooter>
    </div>
  );
}

function getCurrentCallAction(
  item: PolicyTool,
  invocationPolicies: ReturnType<typeof useToolInvocationPolicies>["data"],
) {
  return getCallPolicyActionFromPolicies(
    item.id,
    invocationPolicies ?? { byProfileToolId: {} },
  );
}

function getCurrentResultAction(
  item: PolicyTool,
  resultPolicies: ReturnType<typeof useToolResultPolicies>["data"],
) {
  return getResultPolicyActionFromPolicies(
    item.id,
    resultPolicies ?? { byProfileToolId: {} },
  );
}

function hasCustomPolicies(
  policies: Array<{ conditions: unknown[] }> | undefined,
) {
  return Boolean(policies?.some((policy) => policy.conditions.length > 0));
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function getPolicyEditableToolNames(toolNames: string[]) {
  return uniqueStrings(toolNames).filter((toolName) => !isAgentTool(toolName));
}

export function getScopedPolicyToolNames(interactions: Interaction[]) {
  return getPolicyEditableToolNames(
    interactions.flatMap((interaction) => {
      const dynamicInteraction = new DynamicInteraction(interaction);
      return [
        ...dynamicInteraction.getToolNamesUsed(),
        ...dynamicInteraction.getToolNamesRequested(),
        ...dynamicInteraction.getToolNamesRefused(),
      ];
    }),
  );
}

export function getScopedPolicyTools<
  T extends { name: string; catalogId: string | null },
>(tools: T[], usedToolNames: string[]) {
  if (usedToolNames.length === 0) {
    return [];
  }
  const usedNames = new Set(usedToolNames);
  return tools.filter(
    (item) => usedNames.has(item.name) && isMcpToolByProperties(item),
  );
}

function getDisplayToolName(toolName: string) {
  return parseFullToolName(toolName).toolName || toolName;
}
