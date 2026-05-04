"use client";

import {
  type archestraApiTypes,
  type BlockedToolPart,
  type DualLlmPart,
  type PartialUIMessage,
  type PolicyDeniedPart,
  TOOL_SWAP_AGENT_SHORT_NAME,
  TOOL_SWAP_TO_DEFAULT_AGENT_SHORT_NAME,
} from "@shared";
import type { ChatStatus } from "ai";
import {
  Check,
  Paperclip,
  RefreshCcwIcon,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ReactNode } from "react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  getChangedDryRunRecords,
  PolicyImpactAnnotation,
  PolicyImpactSummaryCard,
} from "@/app/mcp/tool-guardrails/_parts/policy-dry-run";
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import { Loader } from "@/components/ai-elements/loader";
import { Message, MessageContent } from "@/components/ai-elements/message";
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import {
  Source,
  Sources,
  SourcesContent,
  SourcesTrigger,
} from "@/components/ai-elements/sources";
import {
  Tool,
  ToolContent,
  ToolHeader,
  ToolInput,
  ToolOutput,
} from "@/components/ai-elements/tool";
import {
  hasKnowledgeBaseToolCall,
  KnowledgeGraphCitations,
} from "@/components/chat/knowledge-graph-citations";
import { MessageActions } from "@/components/chat/message-actions";
import {
  findScrollContainer,
  PreexistingUnsafeContextDivider,
  SensitiveContextStickyIndicator,
  shouldShowStickyBoundaryIndicator,
  UnsafeContextStartsHereDivider,
} from "@/components/chat/message-boundary-divider";
import { PolicyDeniedTool } from "@/components/chat/policy-denied-tool";
import { SwapAgentBoundaryDivider } from "@/components/chat/swap-agent-boundary";
import { UserMessageText } from "@/components/chat/user-message-text";
import Divider from "@/components/divider";
import { Button } from "@/components/ui/button";
import { getToolNameFromPart } from "@/lib/chat/chat-tools-display.utils";
import { parsePolicyDenied } from "@/lib/chat/mcp-error-ui";
import {
  getRenderedToolName,
  getSwapToolShortName,
} from "@/lib/chat/swap-agent.utils";
import type {
  PolicyDryRunDecisionRecord,
  PolicyDryRunResponse,
} from "@/lib/policy.query";
import { cn } from "@/lib/utils";

const MessageThread = ({
  messages,
  reload,
  isEnded,
  containerClassName,
  topPart,
  hideDivider,
  profileId,
  unsafeContextBoundary,
  policyImpactResult,
  onClearPolicyImpact,
}: {
  messages: PartialUIMessage[];
  reload?: () => void;
  isEnded?: boolean;
  containerClassName?: string;
  topPart?: React.ReactNode;
  hideDivider?: boolean;
  profileId?: string;
  unsafeContextBoundary?: archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"];
  policyImpactResult?: PolicyDryRunResponse | null;
  onClearPolicyImpact?: () => void;
}) => {
  const status: ChatStatus = "streaming" as ChatStatus;

  const lastAssistantMessageIndex = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") return i;
    }
    return -1;
  }, [messages]);
  const unsafeBoundaryRef = useRef<HTMLDivElement>(null);
  const [showStickyUnsafeIndicator, setShowStickyUnsafeIndicator] =
    useState(false);
  const policyImpactRecordsByToolCallId = useMemo(() => {
    const recordsByToolCallId = new Map<string, PolicyDryRunDecisionRecord[]>();
    if (!policyImpactResult) {
      return recordsByToolCallId;
    }
    for (const record of getChangedDryRunRecords(policyImpactResult)) {
      const toolCallId = record.stepPreview.toolCallId;
      if (toolCallId) {
        const records = recordsByToolCallId.get(toolCallId) ?? [];
        records.push(record);
        recordsByToolCallId.set(toolCallId, records);
      }
    }
    return recordsByToolCallId;
  }, [policyImpactResult]);
  const policyImpactSummaryAnchor = useMemo(
    () => getPolicyImpactSummaryAnchor(messages),
    [messages],
  );
  const draftUnsafeContextBoundary = useMemo(
    () => getDraftUnsafeContextBoundary(policyImpactResult),
    [policyImpactResult],
  );
  const currentUnsafeContextBoundaryAnchor = useMemo(
    () =>
      getCurrentUnsafeContextBoundaryAnchor({
        messages,
        unsafeContextBoundary,
      }),
    [messages, unsafeContextBoundary],
  );
  const draftUnsafeContextBoundaryAnchor = useMemo(
    () =>
      getDraftUnsafeContextBoundaryAnchor({
        messages,
        draftUnsafeContextBoundary,
      }),
    [messages, draftUnsafeContextBoundary],
  );
  const currentUnsafeContextLabelPrefix =
    currentUnsafeContextBoundaryAnchor &&
    draftUnsafeContextBoundaryAnchor &&
    !sameUnsafeContextBoundaryAnchor(
      currentUnsafeContextBoundaryAnchor,
      draftUnsafeContextBoundaryAnchor,
    )
      ? "Current"
      : undefined;

  useEffect(() => {
    const boundaryElement = unsafeBoundaryRef.current;
    if (!boundaryElement) {
      setShowStickyUnsafeIndicator(false);
      return;
    }

    const scrollContainer = findScrollContainer(boundaryElement);
    if (!scrollContainer) {
      setShowStickyUnsafeIndicator(false);
      return;
    }

    const updateStickyState = () => {
      const boundaryRect = boundaryElement.getBoundingClientRect();
      const containerRect = scrollContainer.getBoundingClientRect();
      setShowStickyUnsafeIndicator(
        shouldShowStickyBoundaryIndicator({
          boundaryTop: boundaryRect.top,
          boundaryBottom: boundaryRect.bottom,
          containerTop: containerRect.top,
        }),
      );
    };

    updateStickyState();
    scrollContainer.addEventListener("scroll", updateStickyState, {
      passive: true,
    });
    window.addEventListener("resize", updateStickyState);

    return () => {
      scrollContainer.removeEventListener("scroll", updateStickyState);
      window.removeEventListener("resize", updateStickyState);
    };
  });

  return (
    <div
      className={cn(
        "mx-auto relative size-full h-[calc(100vh-3rem)]",
        containerClassName,
      )}
    >
      <div className="flex flex-col h-full">
        <Conversation className="h-full">
          <ConversationContent>
            {topPart}
            <SensitiveContextStickyIndicator
              visible={showStickyUnsafeIndicator}
            />
            {unsafeContextBoundary?.kind === "preexisting_untrusted" && (
              <PreexistingUnsafeContextDivider dividerRef={unsafeBoundaryRef} />
            )}
            {!hideDivider && <Divider className="my-4" />}
            <div className="max-w-4xl mx-auto">
              {messages.map((message, idx) => (
                <div key={message.id || idx}>
                  {message.role === "assistant" &&
                    message.parts.filter((part) => part.type === "source-url")
                      .length > 0 && (
                      <Sources>
                        <SourcesTrigger
                          count={
                            message.parts.filter(
                              (part) => part.type === "source-url",
                            ).length
                          }
                        />
                        {message.parts
                          .filter((part) => part.type === "source-url")
                          .map((part) => (
                            <SourcesContent key={part.url}>
                              <Source href={part.url} title={part.url} />
                            </SourcesContent>
                          ))}
                      </Sources>
                    )}

                  {(() => {
                    const partKeyTracker = new Map<string, number>();
                    return message.parts.map((part, i) => {
                      const partKey = getPartKey(
                        message.id,
                        part,
                        partKeyTracker,
                      );
                      // Skip tool result parts that immediately follow a tool invocation with same toolCallId
                      if (
                        (part.type === "dynamic-tool" ||
                          part.type === "tool-invocation" ||
                          _isToolPrefixedPart(part)) &&
                        (part as { state?: string }).state ===
                          "output-available" &&
                        i > 0
                      ) {
                        const prevPart = message.parts[i - 1];
                        if (
                          (prevPart.type === "dynamic-tool" ||
                            prevPart.type === "tool-invocation" ||
                            _isToolPrefixedPart(prevPart)) &&
                          (prevPart as { state?: string }).state ===
                            "input-available" &&
                          (prevPart as { toolCallId?: string }).toolCallId ===
                            (part as { toolCallId?: string }).toolCallId
                        ) {
                          return null;
                        }
                      }

                      // Skip dual-llm-analysis parts that follow a tool (invocation or result)
                      // They will be rendered together with the tool
                      if (_isDualLlmPart(part) && i > 0) {
                        const prevPart = message.parts[i - 1];
                        if (
                          prevPart.type === "dynamic-tool" ||
                          ("type" in prevPart &&
                            prevPart.type === "tool-invocation") ||
                          _isToolPrefixedPart(prevPart)
                        ) {
                          return null;
                        }
                      }

                      switch (part.type) {
                        case "text": {
                          const policyDenied = parsePolicyDenied(part.text);
                          const shouldRenderUnsafeContextDivider =
                            message.role === "assistant" &&
                            shouldRenderToolResultUnsafeBoundary({
                              message,
                              partIndex: i,
                              unsafeContextBoundary,
                            });
                          const shouldRenderPolicyDeniedUnsafeBoundary =
                            policyDenied?.unsafeContextActiveAtRequestStart &&
                            !hasUnsafeBoundaryBefore({
                              messages,
                              beforeMessageIndex: idx,
                              beforePartIndex: i,
                              unsafeContextBoundary,
                            });
                          if (policyDenied) {
                            return (
                              <Fragment key={partKey}>
                                {shouldRenderPolicyDeniedUnsafeBoundary && (
                                  <PreexistingUnsafeContextDivider
                                    dividerRef={unsafeBoundaryRef}
                                  />
                                )}
                                <PolicyDeniedTool
                                  policyDenied={policyDenied}
                                  {...(profileId
                                    ? { editable: true, profileId }
                                    : { editable: false })}
                                />
                              </Fragment>
                            );
                          }
                          const isLastAssistantMessage =
                            message.role === "assistant" &&
                            idx === lastAssistantMessageIndex;
                          const isLastTextPartInMessage =
                            isLastAssistantMessage &&
                            message.parts
                              .slice(i + 1)
                              .every((p) => p.type !== "text");
                          // Show citations on the last text part of the last
                          // assistant message, scoped to the current assistant turn
                          // (stop at the next user message to avoid stale citations).
                          let citationParts: typeof message.parts | undefined;
                          if (isLastTextPartInMessage) {
                            if (hasKnowledgeBaseToolCall(message.parts ?? [])) {
                              citationParts = message.parts;
                            } else {
                              for (
                                let prevIdx = idx - 1;
                                prevIdx >= 0;
                                prevIdx--
                              ) {
                                const prev = messages[prevIdx];
                                if (prev.role === "user") break;
                                if (
                                  prev.role === "assistant" &&
                                  hasKnowledgeBaseToolCall(prev.parts ?? [])
                                ) {
                                  citationParts = prev.parts;
                                  break;
                                }
                              }
                            }
                          }

                          const textMessage = (
                            <Message from={message.role}>
                              <MessageContent>
                                {message.role === "system" && (
                                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                                    System Prompt
                                  </div>
                                )}
                                {message.role === "user" ? (
                                  <UserMessageText text={part.text} />
                                ) : (
                                  <Response>{part.text}</Response>
                                )}
                                {citationParts && (
                                  <KnowledgeGraphCitations
                                    parts={citationParts}
                                  />
                                )}
                              </MessageContent>
                            </Message>
                          );
                          const shouldRenderPolicyImpactSummary =
                            policyImpactResult &&
                            policyImpactSummaryAnchor?.messageIndex === idx &&
                            policyImpactSummaryAnchor?.partIndex === i;

                          return (
                            <Fragment key={partKey}>
                              {shouldRenderUnsafeContextDivider && (
                                <UnsafeContextStartsHereDivider
                                  labelPrefix={currentUnsafeContextLabelPrefix}
                                  dividerRef={unsafeBoundaryRef}
                                />
                              )}
                              {shouldRenderPolicyImpactSummary ? (
                                <div className="relative">
                                  {textMessage}
                                  <div className="mt-2 xl:absolute xl:left-full xl:top-2 xl:ml-3 xl:mt-0 xl:w-[220px]">
                                    <PolicyImpactSummaryCard
                                      result={policyImpactResult}
                                      onClear={onClearPolicyImpact}
                                    />
                                  </div>
                                </div>
                              ) : (
                                textMessage
                              )}
                              {message.role === "assistant" &&
                                i === messages.length - 1 && (
                                  <MessageActions
                                    textToCopy={part.text}
                                    className="-mt-1 w-fit"
                                  />
                                )}
                            </Fragment>
                          );
                        }
                        case "file": {
                          const filePart = part as {
                            type: "file";
                            url: string;
                            mediaType: string;
                            filename?: string;
                          };
                          if (filePart.mediaType?.startsWith("image/")) {
                            return (
                              <div
                                key={partKey}
                                className="py-1 flex justify-start"
                              >
                                <img
                                  src={filePart.url}
                                  alt={filePart.filename || "Image"}
                                  className="max-h-32 rounded-lg object-cover"
                                />
                              </div>
                            );
                          }
                          return (
                            <div
                              key={partKey}
                              className="py-1 flex justify-start"
                            >
                              <div className="flex items-center gap-2 text-sm rounded-lg border bg-muted/50 p-2">
                                <Paperclip className="size-4 text-muted-foreground" />
                                <span className="truncate">
                                  {filePart.filename || "Attached file"}
                                </span>
                              </div>
                            </div>
                          );
                        }
                        case "tool-invocation":
                        case "dynamic-tool": {
                          const toolName =
                            part.type === "dynamic-tool"
                              ? part.toolName
                              : part.toolCallId;
                          const swapToolShortName = getSwapToolShortName({
                            toolName,
                          });
                          if (
                            swapToolShortName === TOOL_SWAP_AGENT_SHORT_NAME ||
                            swapToolShortName ===
                              TOOL_SWAP_TO_DEFAULT_AGENT_SHORT_NAME
                          ) {
                            return null;
                          }
                          const isDanger = [
                            "gather_sensitive_data",
                            "send_email",
                            "analyze_email_blocked",
                          ].includes(part.toolCallId);
                          const isShield =
                            part.toolCallId === "dual_llm_activated";
                          const isSuccess =
                            part.toolCallId === "attack_blocked";
                          const getIcon = () => {
                            if (isDanger)
                              return (
                                <TriangleAlert className="size-4 text-muted-foreground" />
                              );
                            if (isShield)
                              return (
                                <ShieldCheck className="size-4 text-muted-foreground" />
                              );
                            if (isSuccess)
                              return (
                                <Check className="size-4 text-muted-foreground" />
                              );
                            return undefined;
                          };
                          const getColorClass = () => {
                            if (isDanger) return "bg-red-500/30";
                            if (isShield) return "bg-sky-400/60";
                            if (isSuccess) return "bg-emerald-700/60";
                            return "";
                          };

                          // Look ahead for tool result and dual LLM analysis
                          let toolResultPart = null;
                          let dualLlmPart: DualLlmPart | null = null;

                          // Check if next part is a tool result (same tool call ID)
                          const nextPart = message.parts[i + 1];
                          if (
                            nextPart &&
                            (nextPart.type === "dynamic-tool" ||
                              nextPart.type === "tool-invocation") &&
                            nextPart.state === "output-available" &&
                            nextPart.toolCallId === part.toolCallId
                          ) {
                            toolResultPart = nextPart;

                            // Check if there's a dual LLM part after the tool result
                            const dualLlmPartCandidate = message.parts[i + 2];
                            if (_isDualLlmPart(dualLlmPartCandidate)) {
                              dualLlmPart = dualLlmPartCandidate;
                            }
                          } else {
                            // Check if the next part is directly a dual LLM analysis
                            if (_isDualLlmPart(nextPart)) {
                              dualLlmPart = nextPart;
                            }
                          }

                          const renderedTool = (
                            <Tool className={getColorClass()}>
                              <ToolHeader
                                type={`tool-${toolName}`}
                                state={
                                  dualLlmPart
                                    ? "output-available-dual-llm"
                                    : toolResultPart
                                      ? "output-available"
                                      : part.state
                                }
                                icon={getIcon()}
                              />
                              <ToolContent>
                                {part.input &&
                                Object.keys(part.input).length > 0 ? (
                                  <ToolInput input={part.input} />
                                ) : null}
                                {toolResultPart && (
                                  <ToolOutput
                                    label={
                                      toolResultPart.errorText
                                        ? "Error"
                                        : dualLlmPart
                                          ? "Unsafe result"
                                          : "Result"
                                    }
                                    output={toolResultPart.output as unknown}
                                    errorText={toolResultPart.errorText}
                                  />
                                )}
                                {!toolResultPart && Boolean(part.output) && (
                                  <ToolOutput
                                    label={
                                      part.errorText
                                        ? "Error"
                                        : dualLlmPart
                                          ? "Unsafe result"
                                          : "Result"
                                    }
                                    output={part.output as unknown}
                                    errorText={part.errorText}
                                  />
                                )}
                                {dualLlmPart && (
                                  <>
                                    <ToolOutput
                                      label="Safe result"
                                      output={dualLlmPart.safeResult}
                                    />
                                    <ToolOutput
                                      label="Questions and Answers"
                                      output={undefined}
                                      conversations={dualLlmPart.conversations.slice(
                                        1,
                                      )}
                                    />
                                  </>
                                )}
                              </ToolContent>
                            </Tool>
                          );
                          return (
                            <ToolPolicyImpactBlock
                              key={part.toolCallId ?? partKey}
                              records={policyImpactRecordsByToolCallId.get(
                                part.toolCallId,
                              )}
                              showDraftBoundary={shouldRenderDraftUnsafeContextBoundaryAfterToolPart(
                                {
                                  messageIndex: idx,
                                  partIndex: i,
                                  currentUnsafeContextBoundaryAnchor,
                                  draftUnsafeContextBoundaryAnchor,
                                },
                              )}
                            >
                              {renderedTool}
                            </ToolPolicyImpactBlock>
                          );
                        }
                        case "reasoning":
                          return (
                            <Reasoning
                              key={partKey}
                              className="w-full"
                              isStreaming={
                                status === "streaming" &&
                                i === message.parts.length - 1 &&
                                message.id === messages.at(-1)?.id
                              }
                            >
                              <ReasoningTrigger />
                              <ReasoningContent>{part.text}</ReasoningContent>
                            </Reasoning>
                          );
                        default: {
                          // Handle custom blocked-tool type
                          if (_isBlockedToolPart(part)) {
                            const blockedPart = part as BlockedToolPart;
                            return (
                              <div
                                key={partKey}
                                className="my-2 p-4 bg-red-50 dark:bg-red-950/30 border border-red-300 dark:border-red-800 rounded-lg"
                              >
                                <div className="flex items-start gap-3">
                                  <TriangleAlert className="size-5 text-destructive dark:text-red-400 mt-0.5 flex-shrink-0" />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2">
                                      <p className="text-sm font-semibold text-red-900 dark:text-red-100">
                                        {blockedPart.reason}
                                      </p>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="flex items-center gap-2 text-xs">
                                        <span className="font-medium text-red-800 dark:text-red-200">
                                          Tool:
                                        </span>
                                        <code className="px-2 py-1 bg-red-100 dark:bg-red-900/50 rounded text-red-900 dark:text-red-100">
                                          {blockedPart.toolName}
                                        </code>
                                      </div>
                                      {blockedPart.toolArguments && (
                                        <div className="flex items-center gap-2 text-xs">
                                          <span className="font-medium text-red-800 dark:text-red-200 flex-shrink-0">
                                            Arguments:
                                          </span>
                                          <code className="px-2 py-1 bg-red-100 dark:bg-red-900/50 rounded text-red-900 dark:text-red-100 break-all">
                                            {blockedPart.toolArguments}
                                          </code>
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>
                            );
                          }

                          // Handle tool-* prefixed parts (persisted tool calls from DB)
                          if (_isToolPrefixedPart(part)) {
                            const toolName = getRenderedToolName(part);
                            const swapToolShortName = toolName
                              ? getSwapToolShortName({ toolName })
                              : null;
                            if (
                              swapToolShortName ===
                                TOOL_SWAP_AGENT_SHORT_NAME ||
                              swapToolShortName ===
                                TOOL_SWAP_TO_DEFAULT_AGENT_SHORT_NAME
                            ) {
                              return null;
                            }
                            // Look ahead for tool result and dual LLM analysis
                            let toolResultPart = null;
                            let dualLlmPart: DualLlmPart | null = null;

                            const nextPart = message.parts[i + 1];
                            if (
                              nextPart &&
                              _isToolPrefixedPart(nextPart) &&
                              nextPart.state === "output-available" &&
                              nextPart.toolCallId === part.toolCallId
                            ) {
                              toolResultPart = nextPart;
                              const dualLlmCandidate = message.parts[i + 2];
                              if (_isDualLlmPart(dualLlmCandidate)) {
                                dualLlmPart = dualLlmCandidate;
                              }
                            } else if (_isDualLlmPart(nextPart)) {
                              dualLlmPart = nextPart;
                            }

                            const renderedTool = (
                              <Tool>
                                <ToolHeader
                                  type={part.type}
                                  state={
                                    dualLlmPart
                                      ? "output-available-dual-llm"
                                      : toolResultPart
                                        ? "output-available"
                                        : part.state
                                  }
                                />
                                <ToolContent>
                                  {part.input &&
                                  typeof part.input === "object" &&
                                  Object.keys(
                                    part.input as Record<string, unknown>,
                                  ).length > 0 ? (
                                    <ToolInput input={part.input} />
                                  ) : null}
                                  {toolResultPart && (
                                    <ToolOutput
                                      label={
                                        toolResultPart.errorText
                                          ? "Error"
                                          : dualLlmPart
                                            ? "Unsafe result"
                                            : "Result"
                                      }
                                      output={toolResultPart.output as unknown}
                                      errorText={
                                        toolResultPart.errorText as
                                          | string
                                          | undefined
                                      }
                                    />
                                  )}
                                  {!toolResultPart && Boolean(part.output) && (
                                    <ToolOutput
                                      label={
                                        part.errorText
                                          ? "Error"
                                          : dualLlmPart
                                            ? "Unsafe result"
                                            : "Result"
                                      }
                                      output={part.output as unknown}
                                      errorText={
                                        part.errorText as string | undefined
                                      }
                                    />
                                  )}
                                  {dualLlmPart && (
                                    <>
                                      <ToolOutput
                                        label="Safe result"
                                        output={dualLlmPart.safeResult}
                                      />
                                      <ToolOutput
                                        label="Questions and Answers"
                                        output={undefined}
                                        conversations={dualLlmPart.conversations.slice(
                                          1,
                                        )}
                                      />
                                    </>
                                  )}
                                </ToolContent>
                              </Tool>
                            );
                            return (
                              <ToolPolicyImpactBlock
                                key={`${message.id}-${part.toolCallId}`}
                                records={policyImpactRecordsByToolCallId.get(
                                  part.toolCallId,
                                )}
                                showDraftBoundary={shouldRenderDraftUnsafeContextBoundaryAfterToolPart(
                                  {
                                    messageIndex: idx,
                                    partIndex: i,
                                    currentUnsafeContextBoundaryAnchor,
                                    draftUnsafeContextBoundaryAnchor,
                                  },
                                )}
                              >
                                {renderedTool}
                              </ToolPolicyImpactBlock>
                            );
                          }

                          // Handle custom dual-llm-analysis type (standalone, not following a tool)
                          if (_isDualLlmPart(part)) {
                            const dualLlmPart = part as DualLlmPart;

                            return (
                              <Tool key={partKey} className="bg-sky-400/20">
                                <ToolHeader
                                  type="tool-dual-llm-action"
                                  state="output-available-dual-llm"
                                  icon={
                                    <ShieldCheck className="size-4 text-muted-foreground" />
                                  }
                                />
                                <ToolContent>
                                  <ToolOutput
                                    label="Safe result"
                                    output={dualLlmPart.safeResult}
                                  />
                                  <ToolOutput
                                    label="Questions and answers"
                                    output={undefined}
                                    conversations={dualLlmPart.conversations.slice(
                                      1,
                                    )}
                                  />
                                </ToolContent>
                              </Tool>
                            );
                          }
                          return null;
                        }
                      }
                    });
                  })()}
                  {shouldRenderUnsafeContextDividerAfterMessage({
                    message,
                    unsafeContextBoundary,
                  }) && (
                    <UnsafeContextStartsHereDivider
                      labelPrefix={currentUnsafeContextLabelPrefix}
                      dividerRef={unsafeBoundaryRef}
                    />
                  )}
                  {message.role === "assistant" && (
                    <SwapAgentBoundaryDivider
                      parts={message.parts ?? []}
                      hasToolError={hasSwapToolErrorInMessageThread}
                    />
                  )}
                </div>
              ))}
              {status === "submitted" && <Loader />}
            </div>
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
        {isEnded && reload && (
          <Button
            onClick={reload}
            variant="ghost"
            className="my-2 cursor-pointer w-fit mx-auto"
          >
            <RefreshCcwIcon /> Start again
          </Button>
        )}
      </div>
    </div>
  );
};

function ToolPolicyImpactBlock({
  children,
  records,
  showDraftBoundary,
}: {
  children: ReactNode;
  records?: PolicyDryRunDecisionRecord[];
  showDraftBoundary: boolean;
}) {
  return (
    <>
      <ToolPolicyImpact records={records}>{children}</ToolPolicyImpact>
      {showDraftBoundary ? (
        <UnsafeContextStartsHereDivider labelPrefix="Dry run" />
      ) : null}
    </>
  );
}

function ToolPolicyImpact({
  children,
  records,
}: {
  children: ReactNode;
  records?: PolicyDryRunDecisionRecord[];
}) {
  if (!records?.length) {
    return children;
  }

  return (
    <div className="mb-4 grid gap-2 xl:w-[calc(100%+232px)] xl:grid-cols-[minmax(0,1fr)_220px] xl:items-stretch xl:gap-x-3">
      <div className="flex min-w-0 [&>.not-prose]:mb-0 [&>.not-prose]:flex-1">
        {children}
      </div>
      <div className="flex w-full xl:w-[220px]">
        <PolicyImpactAnnotation records={records} className="flex-1" />
      </div>
    </div>
  );
}

export type {
  BlockedToolPart,
  DualLlmPart,
  PolicyDeniedPart,
  PartialUIMessage,
};

// Type guard for tool-* prefixed parts (persisted tool calls from DB)
function _isToolPrefixedPart(part: unknown): part is {
  type: string;
  toolCallId: string;
  state: string;
  input: unknown;
  output: unknown;
  errorText?: string;
} {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    typeof (part as { type: string }).type === "string" &&
    (part as { type: string }).type.startsWith("tool-") &&
    "toolCallId" in part
  );
}

// Type guards for custom part types
function _isDualLlmPart(part: unknown): part is DualLlmPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as { type: string }).type === "dual-llm-analysis"
  );
}

function _isBlockedToolPart(part: unknown): part is BlockedToolPart {
  return (
    typeof part === "object" &&
    part !== null &&
    "type" in part &&
    (part as { type: string }).type === "blocked-tool"
  );
}

export default MessageThread;

function shouldRenderToolResultUnsafeBoundary(params: {
  message: PartialUIMessage;
  partIndex: number;
  unsafeContextBoundary?: archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"];
}): boolean {
  const { message, partIndex, unsafeContextBoundary } = params;

  if (unsafeContextBoundary?.kind !== "tool_result") {
    return false;
  }

  let sawBoundaryToolResult = false;
  for (let i = 0; i < (message.parts?.length ?? 0); i++) {
    const part = message.parts[i];
    if (
      "toolCallId" in part &&
      "state" in part &&
      part.state === "output-available" &&
      toolPartMatchesUnsafeContextBoundary(part, unsafeContextBoundary)
    ) {
      sawBoundaryToolResult = true;
      continue;
    }

    if (
      sawBoundaryToolResult &&
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0
    ) {
      return i === partIndex;
    }
  }

  return false;
}

function shouldRenderUnsafeContextDividerAfterMessage(params: {
  message: PartialUIMessage;
  unsafeContextBoundary?: archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"];
}): boolean {
  const { message, unsafeContextBoundary } = params;

  if (unsafeContextBoundary?.kind !== "tool_result") {
    return false;
  }

  let sawBoundaryToolResult = false;
  for (const part of message.parts ?? []) {
    if (
      "toolCallId" in part &&
      "state" in part &&
      part.state === "output-available" &&
      toolPartMatchesUnsafeContextBoundary(part, unsafeContextBoundary)
    ) {
      sawBoundaryToolResult = true;
      continue;
    }

    if (
      sawBoundaryToolResult &&
      part.type === "text" &&
      typeof part.text === "string" &&
      part.text.trim().length > 0
    ) {
      return false;
    }
  }

  return sawBoundaryToolResult;
}

function hasUnsafeBoundaryBefore(params: {
  messages: PartialUIMessage[];
  beforeMessageIndex: number;
  beforePartIndex: number;
  unsafeContextBoundary?: archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"];
}): boolean {
  if (params.unsafeContextBoundary?.kind === "preexisting_untrusted") {
    return true;
  }

  for (
    let messageIndex = 0;
    messageIndex <= params.beforeMessageIndex;
    messageIndex++
  ) {
    const message = params.messages[messageIndex];
    const lastPartIndex =
      messageIndex === params.beforeMessageIndex
        ? params.beforePartIndex - 1
        : (message.parts?.length ?? 0) - 1;

    for (let partIndex = 0; partIndex <= lastPartIndex; partIndex++) {
      const part = message.parts?.[partIndex];
      if (!part) {
        continue;
      }

      if (
        part.type === "text" &&
        parsePolicyDenied(part.text)?.unsafeContextActiveAtRequestStart
      ) {
        return true;
      }

      if (
        "state" in part &&
        part.state === "output-available" &&
        toolPartMatchesUnsafeContextBoundaryInThread(
          part,
          params.unsafeContextBoundary,
        )
      ) {
        return true;
      }
    }
  }

  return false;
}

function toolPartMatchesUnsafeContextBoundaryInThread(
  part: PartialUIMessage["parts"][number],
  unsafeContextBoundary?: archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"],
): boolean {
  if (!("type" in part) || typeof part.type !== "string") {
    return false;
  }

  if (unsafeContextBoundary?.kind !== "tool_result") {
    return false;
  }

  return toolPartMatchesUnsafeContextBoundary(part, unsafeContextBoundary);
}

function toolPartMatchesUnsafeContextBoundary(
  part: PartialUIMessage["parts"][number],
  boundary: Extract<
    NonNullable<
      archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"]
    >,
    { kind: "tool_result" }
  >,
): boolean {
  if ("toolCallId" in part && part.toolCallId === boundary.toolCallId) {
    return true;
  }

  const partToolName = getToolNameFromPart(part);
  return partToolName === boundary.toolName;
}

function hasSwapToolErrorInMessageThread(
  part: { toolCallId?: string; errorText?: string },
  allParts: Array<{ toolCallId?: string; errorText?: string }>,
): boolean {
  if (typeof part.errorText === "string" && part.errorText.length > 0) {
    return true;
  }

  if (!part.toolCallId) {
    return false;
  }

  return allParts.some(
    (candidate) =>
      candidate !== part &&
      candidate.toolCallId === part.toolCallId &&
      typeof candidate.errorText === "string" &&
      candidate.errorText.length > 0,
  );
}

function getPolicyImpactSummaryAnchor(
  messages: PartialUIMessage[],
): { messageIndex: number; partIndex: number } | undefined {
  const systemAnchor = findFirstTextPart(messages, "system");
  return systemAnchor ?? findFirstTextPart(messages);
}

function findFirstTextPart(
  messages: PartialUIMessage[],
  role?: PartialUIMessage["role"],
): { messageIndex: number; partIndex: number } | undefined {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    if (role && message.role !== role) {
      continue;
    }
    const partIndex = message.parts.findIndex((part) => part.type === "text");
    if (partIndex >= 0) {
      return { messageIndex, partIndex };
    }
  }
  return undefined;
}

type DraftUnsafeContextBoundary = {
  toolCallId: string;
};

type UnsafeContextBoundaryAnchor = {
  messageIndex: number;
  partIndex: number;
  toolCallId: string;
};

function getDraftUnsafeContextBoundary(
  policyImpactResult?: PolicyDryRunResponse | null,
): DraftUnsafeContextBoundary | undefined {
  if (!canCreateDraftUnsafeContextBoundary(policyImpactResult)) {
    return undefined;
  }

  for (const policyCase of policyImpactResult.result.cases) {
    const boundaryRecord = policyCase.records.find(
      (record) =>
        record.stepType === "tool_result" &&
        record.completeness === "complete" &&
        !record.counterfactual &&
        record.trustBefore.draft &&
        !record.trustAfter.draft &&
        typeof record.stepPreview.toolCallId === "string" &&
        record.stepPreview.toolCallId.length > 0,
    );
    if (boundaryRecord?.stepPreview.toolCallId) {
      return { toolCallId: boundaryRecord.stepPreview.toolCallId };
    }
  }

  return undefined;
}

function getCurrentUnsafeContextBoundaryAnchor({
  messages,
  unsafeContextBoundary,
}: {
  messages: PartialUIMessage[];
  unsafeContextBoundary?: archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"];
}): UnsafeContextBoundaryAnchor | undefined {
  if (unsafeContextBoundary?.kind !== "tool_result") {
    return undefined;
  }

  return (
    getToolCallIdAnchor(messages, unsafeContextBoundary.toolCallId) ??
    getUnsafeContextBoundaryAnchor(messages, unsafeContextBoundary)
  );
}

function getDraftUnsafeContextBoundaryAnchor({
  messages,
  draftUnsafeContextBoundary,
}: {
  messages: PartialUIMessage[];
  draftUnsafeContextBoundary?: DraftUnsafeContextBoundary;
}): UnsafeContextBoundaryAnchor | undefined {
  if (!draftUnsafeContextBoundary) {
    return undefined;
  }

  return getToolCallIdAnchor(messages, draftUnsafeContextBoundary.toolCallId);
}

function getToolCallIdAnchor(
  messages: PartialUIMessage[],
  toolCallId: string,
): UnsafeContextBoundaryAnchor | undefined {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
      const renderableToolCallId = getRenderableToolPartCallId(
        message.parts,
        partIndex,
      );
      if (renderableToolCallId === toolCallId) {
        return { messageIndex, partIndex, toolCallId: renderableToolCallId };
      }
    }
  }

  return undefined;
}

function getUnsafeContextBoundaryAnchor(
  messages: PartialUIMessage[],
  unsafeContextBoundary: Extract<
    NonNullable<
      archestraApiTypes.GetInteractionResponses["200"]["unsafeContextBoundary"]
    >,
    { kind: "tool_result" }
  >,
): UnsafeContextBoundaryAnchor | undefined {
  for (let messageIndex = 0; messageIndex < messages.length; messageIndex++) {
    const message = messages[messageIndex];
    for (let partIndex = 0; partIndex < message.parts.length; partIndex++) {
      const toolCallId = getRenderableToolPartCallId(message.parts, partIndex);
      if (
        toolCallId &&
        toolPartMatchesUnsafeContextBoundary(
          message.parts[partIndex],
          unsafeContextBoundary,
        )
      ) {
        return { messageIndex, partIndex, toolCallId };
      }
    }
  }

  return undefined;
}

function canCreateDraftUnsafeContextBoundary(
  policyImpactResult?: PolicyDryRunResponse | null,
): policyImpactResult is PolicyDryRunResponse {
  return (
    policyImpactResult?.policyFamily === "combined" ||
    policyImpactResult?.policyFamily === "tool_result"
  );
}

function shouldRenderDraftUnsafeContextBoundaryAfterToolPart({
  messageIndex,
  partIndex,
  currentUnsafeContextBoundaryAnchor,
  draftUnsafeContextBoundaryAnchor,
}: {
  messageIndex: number;
  partIndex: number;
  currentUnsafeContextBoundaryAnchor?: UnsafeContextBoundaryAnchor;
  draftUnsafeContextBoundaryAnchor?: UnsafeContextBoundaryAnchor;
}) {
  if (!draftUnsafeContextBoundaryAnchor) {
    return false;
  }

  if (
    currentUnsafeContextBoundaryAnchor &&
    sameUnsafeContextBoundaryAnchor(
      currentUnsafeContextBoundaryAnchor,
      draftUnsafeContextBoundaryAnchor,
    )
  ) {
    return false;
  }

  return (
    draftUnsafeContextBoundaryAnchor.messageIndex === messageIndex &&
    draftUnsafeContextBoundaryAnchor.partIndex === partIndex
  );
}

function sameUnsafeContextBoundaryAnchor(
  a: UnsafeContextBoundaryAnchor,
  b: UnsafeContextBoundaryAnchor,
) {
  return a.messageIndex === b.messageIndex && a.partIndex === b.partIndex;
}

function getRenderableToolPartCallId(
  parts: PartialUIMessage["parts"],
  partIndex: number,
): string | undefined {
  const part = parts[partIndex];
  if (
    !part ||
    !("toolCallId" in part) ||
    typeof part.toolCallId !== "string" ||
    !("state" in part)
  ) {
    return undefined;
  }

  if (part.state === "output-available" && partIndex > 0) {
    const previousPart = parts[partIndex - 1];
    if (
      isToolPartWithState(previousPart, "input-available") &&
      previousPart.toolCallId === part.toolCallId
    ) {
      return undefined;
    }
  }

  if (
    part.type === "dynamic-tool" ||
    part.type === "tool-invocation" ||
    _isToolPrefixedPart(part)
  ) {
    return part.toolCallId;
  }

  return undefined;
}

function isToolPartWithState(
  part: PartialUIMessage["parts"][number] | undefined,
  state: string,
): part is PartialUIMessage["parts"][number] & {
  toolCallId: string;
  state: string;
} {
  if (!part) {
    return false;
  }

  return (
    "toolCallId" in part &&
    typeof part.toolCallId === "string" &&
    "state" in part &&
    part.state === state
  );
}

function getPartKey(
  messageId: string | undefined,
  part: PartialUIMessage["parts"][number],
  keyTracker: Map<string, number>,
): string {
  const signature = getPartSignature(part);
  const occurrence = keyTracker.get(signature) ?? 0;
  keyTracker.set(signature, occurrence + 1);
  return `${messageId ?? "message"}-${signature}-${occurrence}`;
}

function getPartSignature(part: PartialUIMessage["parts"][number]): string {
  switch (part.type) {
    case "text":
      return `text:${part.text}`;
    case "reasoning":
      return `reasoning:${part.text}`;
    case "file":
      return `file:${part.url}:${part.mediaType}:${part.filename ?? ""}`;
    case "dynamic-tool":
    case "tool-invocation":
      return `tool:${part.toolCallId ?? part.type}`;
    case "source-url":
      return `source:${part.url}`;
    default:
      if (_isToolPrefixedPart(part)) {
        return `tool:${(part as { toolCallId?: string }).toolCallId ?? part.type}`;
      }
      return `part:${JSON.stringify(part)}`;
  }
}
