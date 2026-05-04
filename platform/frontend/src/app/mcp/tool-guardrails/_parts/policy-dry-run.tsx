import { ArrowRight, ShieldCheck } from "lucide-react";
import {
  forwardRef,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useInternalMcpCatalog } from "@/lib/mcp/internal-mcp-catalog.query";
import type {
  PolicyDryRunDecisionRecord,
  PolicyDryRunResponse,
} from "@/lib/policy.query";
import { useToolsWithAssignments } from "@/lib/tools/tool.query";
import { getToolSourceNameByToolName } from "@/lib/tools/tool-source";
import { cn } from "@/lib/utils";

export type PolicyDryRunScope = {
  sessionId?: string;
  interactionId?: string;
};

type PolicyToolSourceMap = Parameters<typeof getToolSourceNameByToolName>[1];
type PolicyToolSourceCatalogItems = Parameters<
  typeof getToolSourceNameByToolName
>[2];

export function PolicyDryRunResultPanel({
  result,
}: {
  result: PolicyDryRunResponse | null;
}) {
  const [exampleOpen, setExampleOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const exampleId = useId();
  const exampleContentId = useId();
  const detailsId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const exampleAnchorRef = useRef<HTMLDivElement | null>(null);
  const exampleRef = useRef<HTMLElement | null>(null);
  const dryRunToolNames = useMemo(() => {
    if (!result) {
      return [];
    }
    return [
      ...new Set(
        result.result.cases.flatMap((policyCase) =>
          policyCase.records.flatMap((record) =>
            record.stepPreview.toolName ? [record.stepPreview.toolName] : [],
          ),
        ),
      ),
    ];
  }, [result]);
  const { data: toolsWithAssignmentsData } = useToolsWithAssignments({
    filters: {
      toolNames: dryRunToolNames.length > 0 ? dryRunToolNames : undefined,
    },
    enabled: dryRunToolNames.length > 0,
  });
  const { data: internalMcpCatalogItems } = useInternalMcpCatalog({
    enabled: dryRunToolNames.length > 0,
  });
  const toolsByName = useMemo(
    () =>
      new Map(
        (toolsWithAssignmentsData?.data ?? []).map((tool) => [tool.name, tool]),
      ),
    [toolsWithAssignmentsData?.data],
  );

  useEffect(() => {
    if (!result) return;
    setExampleOpen(false);
    setDetailsOpen(false);
    window.requestAnimationFrame(() => {
      scrollElementIntoView(panelRef.current, { block: "start" });
    });
  }, [result]);

  useEffect(() => {
    if (!exampleOpen) return;
    window.requestAnimationFrame(() => {
      scrollElementIntoView(exampleAnchorRef.current ?? exampleRef.current, {
        block: "start",
      });
      exampleRef.current?.focus({ preventScroll: true });
    });
  }, [exampleOpen]);

  if (!result) {
    return null;
  }

  const summary = result.result.summary;
  const exampleSet = getExampleSet(result);
  const example = exampleSet.primary;
  const missingOrUnsupported =
    summary.missingPolicyInputSteps + summary.unsupportedSteps;
  const sampleLimitReached =
    result.extractionSummary.casesBuilt >= result.filters.limit;
  const affectedToolInteractions = summary.affectedToolInteractions;
  const canShowCallImpact = result.policyFamily !== "tool_result";
  const canShowResultImpact = result.policyFamily !== "tool_call";
  const shouldShowBlocked = summary.newlyBlocked > 0;
  const shouldShowApproval = summary.newlyRequireApproval > 0;
  const shouldShowLessRestrictive = summary.lessRestrictive > 0;
  const resultTransitionGroups = canShowResultImpact
    ? getResultTransitionGroups(result)
    : [];
  const resultTransitionTotal = resultTransitionGroups.reduce(
    (total, group) => total + group.value,
    0,
  );
  const shouldShowResultTransitionTotal = resultTransitionGroups.length > 1;
  const shouldShowLaterBlocked =
    result.policyFamily === "tool_result" && summary.newlyBlocked > 0;
  const shouldShowLaterApproval =
    result.policyFamily === "tool_result" && summary.newlyRequireApproval > 0;
  const shouldShowLaterLessRestrictive =
    result.policyFamily === "tool_result" && summary.lessRestrictive > 0;
  const detailItems = getSummaryDetailItems({
    affectedToolInteractions,
    affectedToolCalls: summary.affectedToolCalls,
    laterStepsNotReplayable: summary.counterfactualSteps,
    missingOrUnsupported,
    policyFamily: result.policyFamily,
  });

  return (
    <div
      ref={panelRef}
      className="scroll-mt-28 rounded-lg border border-border bg-muted/30 p-4 space-y-4"
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-emerald-500" />
            <h4 className="text-sm font-semibold">Historical impact summary</h4>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Real historical tool calls and outputs. Sensitive arguments and
            results are hidden to avoid exposing sensitive data.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Shows what would change if this draft policy were applied.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Uses a bounded sample of up to {result.filters.limit} recent
            matching cases
            {sampleLimitReached
              ? "; the sample limit was reached, so more historical cases may exist."
              : "."}
          </p>
        </div>
        <Badge variant="outline">
          {summary.evaluatedCases} evaluated / {summary.skippedCases} not
          evaluated
        </Badge>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryMetric
          label="Affected cases"
          value={summary.affectedCases}
          description="Historical cases where draft policies would change behavior."
        />
        <SummaryMetric
          label="Affected tool interactions"
          value={affectedToolInteractions}
          description="Unique historical tool interactions where at least one policy decision or output handling would change."
        />
        {canShowCallImpact && shouldShowBlocked ? (
          <SummaryMetric
            label="Calls would be blocked"
            value={summary.newlyBlocked}
            description="Previously allowed or approval-gated calls that would be blocked by the draft policy."
          />
        ) : null}
        {canShowCallImpact && shouldShowApproval ? (
          <SummaryMetric
            label="Calls would require approval"
            value={summary.newlyRequireApproval}
            description="Previously allowed calls that would require user approval with the draft policy."
          />
        ) : null}
        {canShowCallImpact && shouldShowLessRestrictive ? (
          <SummaryMetric
            label="Calls would be less restricted"
            value={summary.lessRestrictive}
            description="Calls that would become less restricted with the draft policy."
          />
        ) : null}
        {shouldShowResultTransitionTotal ? (
          <SummaryMetric
            label="Tool output handling would change"
            value={resultTransitionTotal}
            description="Historical tool outputs whose result-policy handling would change under the draft policy."
          />
        ) : null}
        {resultTransitionGroups.map((group) => (
          <SummaryMetric
            key={group.key}
            label={group.label}
            value={group.value}
            description={group.description}
          />
        ))}
        {shouldShowLaterBlocked ? (
          <SummaryMetric
            label="Later calls would be blocked"
            value={summary.newlyBlocked}
            description="Later tool calls that would be blocked after the draft result policy changes context trust."
          />
        ) : null}
        {shouldShowLaterApproval ? (
          <SummaryMetric
            label="Later calls would require approval"
            value={summary.newlyRequireApproval}
            description="Later tool calls that would require approval after the draft result policy changes context trust."
          />
        ) : null}
        {shouldShowLaterLessRestrictive ? (
          <SummaryMetric
            label="Later calls would be less restricted"
            value={summary.lessRestrictive}
            description="Later tool calls that would become less restricted after the draft result policy changes context trust."
          />
        ) : null}
      </div>

      {detailItems.length ? (
        <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
          <div className="rounded-md border border-border bg-background text-xs">
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
                aria-controls={detailsId}
              >
                <span>Details</span>
                <span className="text-[11px] font-normal">
                  {detailsOpen ? "Hide" : "Show"}
                </span>
              </button>
            </CollapsibleTrigger>
            <SmoothCollapsibleContent id={detailsId}>
              <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2 lg:grid-cols-3">
                {detailItems.map((item) => (
                  <DetailLine
                    key={item.label}
                    label={item.label}
                    value={item.value}
                    description={item.description}
                  />
                ))}
              </div>
            </SmoothCollapsibleContent>
          </div>
        </Collapsible>
      ) : null}

      <div
        ref={exampleAnchorRef}
        className="scroll-mt-28 flex items-center justify-between gap-3"
      >
        <p className="text-xs text-muted-foreground">
          {result.extractionSummary.completeCases} usable historical cases from{" "}
          {result.extractionSummary.interactionsScanned} scanned interactions.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={!example}
          aria-controls={example ? exampleContentId : undefined}
          aria-expanded={exampleOpen}
          onClick={() => setExampleOpen((open) => !open)}
        >
          {exampleOpen ? "Hide example" : "Show example"}
        </Button>
      </div>

      <Collapsible open={exampleOpen && Boolean(example)}>
        <SmoothCollapsibleContent id={exampleContentId}>
          {example ? (
            <PolicyDryRunExample
              id={exampleId}
              ref={exampleRef}
              result={result}
              exampleSet={exampleSet}
              toolsByName={toolsByName}
              internalMcpCatalogItems={internalMcpCatalogItems}
            />
          ) : null}
        </SmoothCollapsibleContent>
      </Collapsible>
    </div>
  );
}

export function PolicyImpactSummaryCard({
  result,
  onClear,
}: {
  result: PolicyDryRunResponse;
  onClear?: () => void;
}) {
  const affectedToolInteractions =
    result.result.summary.affectedToolInteractions;
  const incomplete =
    result.result.summary.missingPolicyInputSteps +
    result.result.summary.unsupportedSteps;

  return (
    <div className="rounded-lg border border-border bg-card p-3 text-xs">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
            <span className="font-medium">Policy impact</span>
          </div>
          <div className="mt-1 text-muted-foreground">
            {affectedToolInteractions === 0
              ? "No changes"
              : `${affectedToolInteractions} affected tool interaction${affectedToolInteractions === 1 ? "" : "s"}`}
            {incomplete > 0 ? `, ${incomplete} incomplete` : ""}
          </div>
        </div>
        {onClear ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 shrink-0 px-2 text-xs"
            onClick={onClear}
          >
            Clear
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function PolicyImpactAnnotation({
  records,
  className,
}: {
  records: PolicyDryRunDecisionRecord[];
  className?: string;
}) {
  if (records.length === 0) {
    return null;
  }
  const visibleRecords = getUniqueAnnotationRecords(records);

  return (
    <div
      className={cn(
        "w-full rounded-md border border-border bg-card p-3 text-xs",
        className,
      )}
    >
      <div className="grid min-h-5 gap-2">
        {visibleRecords.map(({ record, label }) => (
          <PolicyImpactLine key={label} record={record} label={label} />
        ))}
      </div>
    </div>
  );
}

function PolicyImpactLine({
  record,
  label,
}: {
  record: PolicyDryRunDecisionRecord;
  label: string;
}) {
  const prefix = record.stepType === "tool_result" ? "Result" : "Call";
  const transition = getImpactTransition(record);

  return (
    <div className="grid grid-cols-[48px_minmax(0,1fr)] items-baseline gap-2 leading-5">
      <span className="sr-only">{label}</span>
      <span className="text-[10px] font-medium uppercase text-muted-foreground">
        {prefix}
      </span>
      <span className="min-w-0 space-y-1 text-foreground">
        {transition.current && transition.draft ? (
          <span className="flex min-w-0 flex-wrap items-center gap-1.5 break-words">
            <span>{transition.current}</span>
            <ArrowRight className="h-3 w-3 shrink-0" />
            <span>{transition.draft}</span>
          </span>
        ) : (
          <span className="block break-words">{transition.fallback}</span>
        )}
      </span>
    </div>
  );
}

function getUniqueAnnotationRecords(records: PolicyDryRunDecisionRecord[]) {
  const seen = new Set<string>();
  const uniqueRecords: Array<{
    record: PolicyDryRunDecisionRecord;
    label: string;
  }> = [];

  for (const record of records) {
    const label = formatImpactBadge(record);
    if (seen.has(label)) {
      continue;
    }
    seen.add(label);
    uniqueRecords.push({ record, label });
  }

  return uniqueRecords;
}

export function getChangedDryRunRecords(result: PolicyDryRunResponse) {
  const seen = new Set<string>();

  return result.result.cases
    .flatMap((policyCase) => policyCase.records)
    .filter((record) => record.changed && record.completeness === "complete")
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .filter((record) => {
      const key = getChangedDryRunRecordKey(record);
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function getChangedDryRunRecordKey(record: PolicyDryRunDecisionRecord) {
  const stepKey = record.stepPreview.toolCallId
    ? `${record.caseId}:${record.stepType}:${record.stepPreview.toolCallId}`
    : `${record.caseId}:${record.stepType}:${record.stepId}`;
  return [
    stepKey,
    record.currentOutcome ?? "",
    record.draftOutcome ?? "",
    record.currentReason?.matchedPolicyAction ?? "",
    record.draftReason?.matchedPolicyAction ?? "",
    record.category,
  ].join("|");
}

function SummaryMetric({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description?: string;
}) {
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="text-lg font-semibold">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {description ? (
        <div className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
          {description}
        </div>
      ) : null}
    </div>
  );
}

const PolicyDryRunExample = forwardRef<
  HTMLElement,
  {
    id: string;
    result: PolicyDryRunResponse;
    exampleSet: PolicyDryRunExampleSet;
    toolsByName: PolicyToolSourceMap;
    internalMcpCatalogItems: PolicyToolSourceCatalogItems | undefined;
  }
>(({ id, result, exampleSet, toolsByName, internalMcpCatalogItems }, ref) => {
  const headingId = useId();
  const explanationRecord =
    exampleSet.callImpact ??
    exampleSet.downstreamImpact ??
    exampleSet.resultImpact ??
    exampleSet.primary;
  const laterStepsNotReplayable = getLaterStepsNotReplayableCount(
    result,
    explanationRecord?.caseId,
  );
  const records = getExampleImpactItems(result, exampleSet);

  return (
    <section
      id={id}
      ref={ref}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="rounded-md border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
    >
      <div id={headingId} className="font-medium">
        Example
      </div>
      <div className="mt-3 space-y-4">
        {records.map(({ key, title, description, record }) => (
          <PolicyDryRunExampleImpact
            key={key}
            title={title}
            description={description}
            record={record}
            toolsByName={toolsByName}
            internalMcpCatalogItems={internalMcpCatalogItems}
          />
        ))}
      </div>
      {laterStepsNotReplayable > 0 ? (
        <div className="mt-3">
          <ExampleLine
            label="Later steps affected"
            value={`${laterStepsNotReplayable} later historical ${pluralize(
              laterStepsNotReplayable,
              "step",
            )} may not have happened after this point because the draft policy would stop or pause the flow.`}
          />
        </div>
      ) : null}
      {result.policyFamily !== "tool_call" &&
      exampleSet.resultImpact &&
      !exampleSet.downstreamImpact ? (
        <p className="mt-3 rounded-md border border-border bg-muted/20 p-3 text-xs text-muted-foreground">
          No later tool decision changed in this historical case.
        </p>
      ) : null}
      <p className="mt-3 text-xs text-muted-foreground">
        Sensitive raw tool arguments and results are hidden to avoid exposing
        sensitive data.
      </p>
    </section>
  );
});

PolicyDryRunExample.displayName = "PolicyDryRunExample";

function PolicyDryRunExampleImpact({
  title,
  description,
  record,
  toolsByName,
  internalMcpCatalogItems,
}: {
  title: string;
  description: string;
  record: PolicyDryRunDecisionRecord;
  toolsByName: PolicyToolSourceMap;
  internalMcpCatalogItems: PolicyToolSourceCatalogItems | undefined;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const detailsId = useId();

  return (
    <div className="rounded-lg border border-border bg-muted/20 p-3">
      <PolicyDryRunExampleRecord
        title={title}
        description={description}
        record={record}
      />
      <div className="mt-3 grid gap-2 md:grid-cols-2">
        <ExampleLine label="Why this changes" value={formatReason(record)} />
        {hasTrustImpact(record) ? <TrustImpactCards record={record} /> : null}
      </div>
      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <div className="mt-3 rounded-md border border-border bg-background text-xs">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left font-medium text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground"
              aria-controls={detailsId}
            >
              <span>Details</span>
              <span className="text-[11px] font-normal">
                {detailsOpen ? "Hide" : "Show"}
              </span>
            </button>
          </CollapsibleTrigger>
          <SmoothCollapsibleContent id={detailsId}>
            <ExampleTechnicalDetails
              record={record}
              toolsByName={toolsByName}
              internalMcpCatalogItems={internalMcpCatalogItems}
            />
          </SmoothCollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

function PolicyDryRunExampleRecord({
  title,
  description,
  record,
}: {
  title: string;
  description: string;
  record: PolicyDryRunDecisionRecord;
}) {
  const preview = record.stepPreview;
  const badges = [
    record.firstDivergence ? "First changed point" : null,
    record.firstDownstreamAffectedStep ? "First later action affected" : null,
  ].filter((badge): badge is string => Boolean(badge));

  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      {badges.length ? (
        <div className="flex flex-wrap items-center gap-2">
          {badges.map((badge) => (
            <Badge key={badge} variant="outline">
              {badge}
            </Badge>
          ))}
        </div>
      ) : null}

      <div
        className={`grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(220px,280px)] ${
          badges.length ? "mt-3" : ""
        }`}
      >
        <div>
          <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </div>
          <div className="mt-1 font-medium">
            {preview?.title ?? `${formatStepType(record.stepType)} step`}
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {description}
          </div>
          {preview?.target ? (
            <div className="mt-2 text-sm text-muted-foreground">
              Target: {preview.target}
            </div>
          ) : null}
          {preview?.safeIdentifiers?.length ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {preview.safeIdentifiers.map((identifier) => (
                <Badge
                  key={`${identifier.label}:${identifier.value}`}
                  variant="outline"
                >
                  {identifier.label}: {identifier.value}
                </Badge>
              ))}
            </div>
          ) : null}
        </div>

        <div className="grid gap-2">
          <OutcomeCard
            label="Current policy"
            value={formatOutcome(record.currentOutcome) ?? "not evaluable"}
          />
          <OutcomeCard
            label="Draft policy"
            value={formatOutcome(record.draftOutcome) ?? "not evaluable"}
          />
        </div>
      </div>
    </div>
  );
}

function TrustImpactCards({ record }: { record: PolicyDryRunDecisionRecord }) {
  const trustImpact = getTrustImpactDisplay(record);

  return (
    <div className="rounded-md border border-border bg-background p-3 md:col-span-2">
      <div className="text-xs font-medium text-muted-foreground">
        Downstream context
      </div>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <OutcomeCard label="Current policy" value={trustImpact.current} />
        <OutcomeCard label="Draft policy" value={trustImpact.draft} />
      </div>
    </div>
  );
}

function OutcomeCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-background p-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 font-medium">{value}</div>
    </div>
  );
}

function ExampleLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-3">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-0.5 break-words">{value}</div>
    </div>
  );
}

function DetailLine({
  label,
  value,
  description,
}: {
  label: string;
  value: number;
  description: string;
}) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <div className="text-sm font-medium">{value}</div>
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 text-[11px] leading-snug text-muted-foreground/80">
        {description}
      </div>
    </div>
  );
}

function ExampleTechnicalDetails({
  record,
  toolsByName,
  internalMcpCatalogItems,
}: {
  record: PolicyDryRunDecisionRecord;
  toolsByName: PolicyToolSourceMap;
  internalMcpCatalogItems: PolicyToolSourceCatalogItems | undefined;
}) {
  const sourceName = record.stepPreview.toolName
    ? getToolSourceNameByToolName(
        record.stepPreview.toolName,
        toolsByName,
        internalMcpCatalogItems,
      )
    : record.sourceArtifact.providerType;
  const details = [
    { label: "Case", value: record.caseId },
    { label: "Step", value: `${record.stepOrder + 1}: ${record.stepId}` },
    { label: "Interaction", value: record.sourceArtifact.interactionId },
    { label: "Source", value: sourceName },
    {
      label: "Artifact",
      value: `${record.sourceArtifact.providerType} / ${record.sourceArtifact.field}`,
    },
    { label: "Confidence", value: formatConfidence(record.confidence) },
    { label: "Replay marker", value: formatReplayMarker(record) },
    record.stepPreview?.toolCallId
      ? { label: "Tool call id", value: record.stepPreview.toolCallId }
      : null,
    record.stepPreview?.hiddenInputFields.length
      ? {
          label: "Hidden fields",
          value: record.stepPreview.hiddenInputFields.join(", "),
        }
      : null,
  ].filter((item): item is { label: string; value: string } => Boolean(item));

  return (
    <div className="grid gap-2 p-3 pt-0 sm:grid-cols-2">
      {details.map((detail) => (
        <ExampleDetailLine
          key={detail.label}
          label={detail.label}
          value={detail.value}
        />
      ))}
    </div>
  );
}

function ExampleDetailLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border bg-muted/20 p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="mt-1 break-words font-mono text-[11px] text-foreground">
        {value}
      </div>
    </div>
  );
}

function SmoothCollapsibleContent({
  id,
  children,
}: {
  id: string;
  children: ReactNode;
}) {
  return (
    <CollapsibleContent
      id={id}
      className="overflow-hidden data-[state=closed]:animate-[policy-collapsible-up_200ms_ease-out] data-[state=open]:animate-[policy-collapsible-down_200ms_ease-out] motion-reduce:animate-none"
    >
      {children}
    </CollapsibleContent>
  );
}

function scrollElementIntoView(
  element: Element | null | undefined,
  options: { block?: ScrollLogicalPosition } = {},
) {
  if (!element) return;
  element.scrollIntoView({
    behavior: getPreferredScrollBehavior(),
    block: options.block ?? "start",
    inline: "nearest",
  });
}

function getPreferredScrollBehavior(): ScrollBehavior {
  if (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    return "auto";
  }
  return "smooth";
}

function formatStepType(stepType: string) {
  return stepType.replaceAll("_", " ");
}

type SummaryDetailInput = {
  affectedToolInteractions: number;
  affectedToolCalls: number;
  laterStepsNotReplayable: number;
  missingOrUnsupported: number;
  policyFamily: PolicyDryRunResponse["policyFamily"];
};

function getSummaryDetailItems({
  affectedToolInteractions,
  affectedToolCalls,
  laterStepsNotReplayable,
  missingOrUnsupported,
  policyFamily,
}: SummaryDetailInput) {
  const items: Array<{
    label: string;
    value: number;
    description: string;
  }> = [];

  if (affectedToolInteractions > 0) {
    items.push({
      label: "Affected tool interactions",
      value: affectedToolInteractions,
      description:
        "Unique historical tool interactions where at least one policy decision or output handling would change.",
    });
  }

  if (affectedToolCalls > 0) {
    items.push({
      label:
        policyFamily === "tool_result"
          ? "Affected later tool decisions"
          : "Affected tool calls",
      value: affectedToolCalls,
      description:
        policyFamily === "tool_result"
          ? "Later calls in the same historical cases whose policy decision changed after result trust changed."
          : "Historical calls for this tool whose policy decision changed.",
    });
  }

  if (missingOrUnsupported > 0) {
    items.push({
      label: "Not evaluated",
      value: missingOrUnsupported,
      description:
        "Historical steps skipped because the record did not contain every input needed for deterministic policy evaluation.",
    });
  }

  if (laterStepsNotReplayable > 0) {
    items.push({
      label: "Later steps affected",
      value: laterStepsNotReplayable,
      description:
        "These later historical steps happened originally, but may not happen after the draft policy stops or pauses an earlier step.",
    });
  }

  return items;
}

type ResultPolicyOutcome =
  | "blocked"
  | "trusted"
  | "untrusted"
  | "sanitize_with_dual_llm";

type ResultTransitionKey = `${ResultPolicyOutcome}->${ResultPolicyOutcome}`;

type ResultTransitionMetric = {
  key: ResultTransitionKey | "other";
  label: string;
  value: number;
  description: string;
};

const RESULT_TRANSITION_COPY: Partial<
  Record<ResultTransitionKey, { label: string; description: string }>
> = {
  "blocked->trusted": {
    label: "Blocked outputs would be allowed as safe",
    description:
      "Tool outputs that would be blocked under the current policy would be allowed through and treated as safe for later steps.",
  },
  "blocked->untrusted": {
    label: "Blocked outputs would be allowed as sensitive",
    description:
      "Tool outputs that would be blocked under the current policy would be allowed through, but later decisions would treat them as sensitive context.",
  },
  "blocked->sanitize_with_dual_llm": {
    label: "Blocked outputs would use Dual LLM",
    description:
      "Tool outputs that would be blocked under the current policy would be routed through Dual LLM before reaching the main agent.",
  },
  "trusted->blocked": {
    label: "Safe outputs would be blocked",
    description:
      "Tool outputs that would continue normally under the current policy would be blocked entirely.",
  },
  "trusted->untrusted": {
    label: "Safe outputs would become sensitive context",
    description:
      "Tool outputs that would be treated as safe under the current policy would make later decisions treat the context as sensitive.",
  },
  "trusted->sanitize_with_dual_llm": {
    label: "Safe outputs would use Dual LLM",
    description:
      "Tool outputs that would continue normally under the current policy would be routed through Dual LLM before reaching the main agent.",
  },
  "untrusted->trusted": {
    label: "Sensitive outputs would be treated as safe",
    description:
      "Tool outputs that would make later context sensitive under the current policy would be treated as safe for later steps.",
  },
  "untrusted->blocked": {
    label: "Sensitive outputs would be blocked",
    description:
      "Tool outputs that would reach the agent as sensitive context under the current policy would be blocked entirely.",
  },
  "untrusted->sanitize_with_dual_llm": {
    label: "Sensitive outputs would use Dual LLM",
    description:
      "Tool outputs that would make later context sensitive under the current policy would be routed through Dual LLM before reaching the main agent.",
  },
  "sanitize_with_dual_llm->trusted": {
    label: "Dual LLM outputs would continue as safe",
    description:
      "Tool outputs that would be routed through Dual LLM under the current policy would instead continue directly as safe.",
  },
  "sanitize_with_dual_llm->untrusted": {
    label: "Dual LLM outputs would become sensitive context",
    description:
      "Tool outputs that would be routed through Dual LLM under the current policy would instead make later decisions treat the context as sensitive.",
  },
  "sanitize_with_dual_llm->blocked": {
    label: "Dual LLM outputs would be blocked",
    description:
      "Tool outputs that would be routed through Dual LLM under the current policy would be blocked entirely.",
  },
};

function getResultTransitionGroups(
  result: PolicyDryRunResponse,
): ResultTransitionMetric[] {
  const counts = new Map<ResultTransitionKey, Set<string>>();
  const otherKeys = new Set<string>();

  for (const record of getAllRecords(result)) {
    if (
      record.stepType !== "tool_result" ||
      !record.changed ||
      record.completeness !== "complete"
    ) {
      continue;
    }

    const interactionKey = getRecordToolInteractionKey(record);
    if (
      !isResultPolicyOutcome(record.currentOutcome) ||
      !isResultPolicyOutcome(record.draftOutcome)
    ) {
      otherKeys.add(interactionKey);
      continue;
    }

    if (record.currentOutcome === record.draftOutcome) {
      continue;
    }

    const key =
      `${record.currentOutcome}->${record.draftOutcome}` as ResultTransitionKey;
    if (!RESULT_TRANSITION_COPY[key]) {
      otherKeys.add(interactionKey);
      continue;
    }
    const keys = counts.get(key) ?? new Set<string>();
    keys.add(interactionKey);
    counts.set(key, keys);
  }

  const groups: ResultTransitionMetric[] = Array.from(counts.entries()).map(
    ([key, keys]) => ({
      key,
      value: keys.size,
      ...(RESULT_TRANSITION_COPY[key] as {
        label: string;
        description: string;
      }),
    }),
  );

  if (otherKeys.size > 0) {
    groups.push({
      key: "other",
      value: otherKeys.size,
      label: "Other tool output handling would change",
      description:
        "Historical tool outputs whose result-policy handling would change in a way not covered by the standard result actions.",
    });
  }

  return groups.sort((left, right) => right.value - left.value);
}

function getRecordToolInteractionKey(record: PolicyDryRunDecisionRecord) {
  if (record.stepPreview.toolCallId) {
    return `${record.caseId}:${record.stepPreview.toolCallId}`;
  }
  return `${record.caseId}:${record.stepId}`;
}

function isResultPolicyOutcome(
  outcome: string | undefined,
): outcome is ResultPolicyOutcome {
  return (
    outcome === "blocked" ||
    outcome === "trusted" ||
    outcome === "untrusted" ||
    outcome === "sanitize_with_dual_llm"
  );
}

function formatReason(record: PolicyDryRunDecisionRecord) {
  return (
    record.draftReason?.message ?? (record.reasons.join(", ") || "No reason")
  );
}

function getTrustImpactDisplay(record: PolicyDryRunDecisionRecord) {
  const afterChanged = record.trustAfter.current !== record.trustAfter.draft;
  const beforeChanged = record.trustBefore.current !== record.trustBefore.draft;

  if (afterChanged || !beforeChanged) {
    return {
      current: formatTrustOutcome(record.trustAfter.current, "later"),
      draft: formatTrustOutcome(record.trustAfter.draft, "later"),
    };
  }

  return {
    current: formatTrustOutcome(record.trustBefore.current, "step"),
    draft: formatTrustOutcome(record.trustBefore.draft, "step"),
  };
}

function formatTrustOutcome(isTrusted: boolean, timing: "later" | "step") {
  if (timing === "step") {
    return isTrusted
      ? "This step would start safe"
      : "This step would start sensitive";
  }

  return isTrusted
    ? "Later context would stay safe"
    : "Later context would become sensitive";
}

function formatOutcome(outcome: string | undefined) {
  switch (outcome) {
    case "allow":
      return "tool call would be allowed";
    case "block":
      return "tool call would be blocked";
    case "require_approval":
      return "would require approval";
    case "trusted":
      return "would be marked safe";
    case "untrusted":
      return "would be marked sensitive";
    case "blocked":
      return "tool output would be blocked";
    case "sanitize_with_dual_llm":
      return "would be routed through Dual LLM";
    default:
      return outcome;
  }
}

function formatOutcomeTransition(record: PolicyDryRunDecisionRecord) {
  const transition = getImpactTransition(record);
  if (transition.current && transition.draft) {
    return `${transition.current} to ${transition.draft}`;
  }
  return transition.fallback;
}

function getImpactTransition(record: PolicyDryRunDecisionRecord) {
  const current = formatShortOutcome(record.currentOutcome);
  const draft = formatShortOutcome(record.draftOutcome);
  if (current && draft && current !== draft) {
    return { current, draft, fallback: draft };
  }

  const currentAction = formatMatchedPolicyAction(
    record.currentReason?.matchedPolicyAction,
  );
  const draftAction = formatMatchedPolicyAction(
    record.draftReason?.matchedPolicyAction,
  );
  if ((currentAction || draftAction) && currentAction !== draftAction) {
    return {
      current: currentAction ?? current,
      draft: draftAction ?? draft,
      fallback: draftAction ?? draft ?? currentAction ?? current ?? "Changed",
    };
  }

  return {
    current: undefined,
    draft: undefined,
    fallback: draft ?? current ?? formatCategory(record.category),
  };
}

function formatImpactBadge(record: PolicyDryRunDecisionRecord) {
  const prefix = record.stepType === "tool_result" ? "Result" : "Call";
  return `${prefix}: ${formatOutcomeTransition(record)}`;
}

function formatMatchedPolicyAction(action: string | undefined) {
  switch (action) {
    case "allow_when_context_is_untrusted":
      return "Always";
    case "block_when_context_is_untrusted":
      return "Safe only";
    case "require_approval":
      return "Require approval";
    case "block_always":
      return "Block";
    case "mark_as_trusted":
      return "Safe";
    case "mark_as_untrusted":
      return "Sensitive";
    case "sanitize_with_dual_llm":
      return "Dual LLM";
    default:
      return undefined;
  }
}

function formatShortOutcome(outcome: string | undefined) {
  switch (outcome) {
    case "allow":
      return "Allow";
    case "require_approval":
      return "Approval";
    case "block":
      return "Block";
    case "trusted":
      return "Safe";
    case "untrusted":
      return "Sensitive";
    case "blocked":
      return "Blocked";
    case "sanitize_with_dual_llm":
      return "Sanitize";
    default:
      return undefined;
  }
}

function formatCategory(category: PolicyDryRunDecisionRecord["category"]) {
  switch (category) {
    case "newly_blocked":
      return "Block";
    case "newly_require_approval":
      return "Approval";
    case "less_restrictive":
      return "Less strict";
    case "result_newly_blocked":
      return "Blocked";
    case "result_now_available":
      return "Available";
    case "result_now_safe":
      return "Safe";
    case "result_now_sensitive":
      return "Sensitive";
    case "result_reclassified":
      return "Changed";
    default:
      return "Changed";
  }
}

function formatConfidence(
  confidence: PolicyDryRunDecisionRecord["confidence"],
) {
  switch (confidence) {
    case "high_confidence":
      return "High confidence";
    case "partial":
      return "Partial";
    case "unsupported":
      return "Unsupported";
  }
}

function formatReplayMarker(record: PolicyDryRunDecisionRecord) {
  const markers = [
    record.firstDivergence ? "first changed point" : null,
    record.firstResultReclassification ? "first result change" : null,
    record.firstDownstreamAffectedStep ? "first later action affected" : null,
    record.counterfactual ? "later step may not replay" : null,
  ].filter((marker): marker is string => Boolean(marker));

  return markers.length ? markers.join(", ") : "regular replay step";
}

function getLaterStepsNotReplayableCount(
  result: PolicyDryRunResponse,
  caseId?: string,
) {
  if (!caseId) {
    return 0;
  }

  return (
    result.result.cases
      .find((policyCase) => policyCase.caseId === caseId)
      ?.records.filter((record) => record.counterfactual).length ?? 0
  );
}

function pluralize(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}

type PolicyDryRunExampleSet = {
  primary?: PolicyDryRunDecisionRecord;
  callImpact?: PolicyDryRunDecisionRecord;
  resultImpact?: PolicyDryRunDecisionRecord;
  downstreamImpact?: PolicyDryRunDecisionRecord;
};

function getExampleSet(result: PolicyDryRunResponse): PolicyDryRunExampleSet {
  const fallback = result.result.representativeExample;
  if (!fallback) {
    return {};
  }

  const records = getAllRecords(result).filter(
    (record) => record.changed && record.completeness === "complete",
  );
  const callImpact =
    result.policyFamily !== "tool_result"
      ? (records.find(
          (record) =>
            isToolCallImpact(record) && !record.firstDownstreamAffectedStep,
        ) ?? (isToolCallImpact(fallback) ? fallback : undefined))
      : undefined;

  if (result.policyFamily === "tool_call") {
    return {
      primary: callImpact ?? fallback,
      callImpact: callImpact ?? fallback,
    };
  }

  const downstreamImpact =
    records.find((record) => record.firstDownstreamAffectedStep) ??
    (fallback.firstDownstreamAffectedStep ? fallback : undefined);
  const caseId = downstreamImpact?.caseId ?? fallback.caseId;
  const resultImpact =
    records.find(
      (record) =>
        record.caseId === caseId &&
        record.stepType === "tool_result" &&
        (record.firstResultReclassification || isResultChange(record)),
    ) ?? (fallback.stepType === "tool_result" ? fallback : undefined);

  return {
    primary: callImpact ?? downstreamImpact ?? resultImpact ?? fallback,
    callImpact,
    resultImpact,
    downstreamImpact,
  };
}

type PolicyDryRunExampleImpactItem = {
  key: string;
  title: string;
  description: string;
  record: PolicyDryRunDecisionRecord;
};

function getExampleImpactItems(
  result: PolicyDryRunResponse,
  exampleSet: PolicyDryRunExampleSet,
): PolicyDryRunExampleImpactItem[] {
  const items: PolicyDryRunExampleImpactItem[] = [];

  if (result.policyFamily !== "tool_result" && exampleSet.callImpact) {
    items.push({
      key: "call-impact",
      title: "Affected historical action",
      description:
        "How the draft call policy changes this historical tool decision.",
      record: exampleSet.callImpact,
    });
  }

  if (result.policyFamily !== "tool_call" && exampleSet.resultImpact) {
    items.push({
      key: "result-impact",
      title: "Result impact",
      description:
        "How the historical tool result would be classified by the draft result policy.",
      record: exampleSet.resultImpact,
    });
  }

  if (result.policyFamily !== "tool_call" && exampleSet.downstreamImpact) {
    items.push({
      key: "later-action-impact",
      title: "Later action impact",
      description:
        "The first later tool decision changed because result trust changed.",
      record: exampleSet.downstreamImpact,
    });
  }

  if (items.length === 0 && exampleSet.primary) {
    items.push({
      key: "impact",
      title: "Affected historical step",
      description: "How the draft policy changes this historical step.",
      record: exampleSet.primary,
    });
  }

  return items;
}

function getAllRecords(result: PolicyDryRunResponse) {
  return result.result.cases.flatMap((policyCase) => policyCase.records);
}

function isToolCallImpact(record: PolicyDryRunDecisionRecord) {
  return record.stepType === "tool_call" || record.stepType === "refusal";
}

function isResultChange(record: PolicyDryRunDecisionRecord) {
  return (
    record.stepType === "tool_result" &&
    record.currentOutcome !== record.draftOutcome
  );
}

function hasTrustImpact(record: PolicyDryRunDecisionRecord) {
  if (record.stepType === "tool_result") {
    return false;
  }

  return (
    record.trustBefore.current !== record.trustBefore.draft ||
    record.trustAfter.current !== record.trustAfter.draft ||
    record.trustBefore.current !== record.trustAfter.current ||
    record.trustBefore.draft !== record.trustAfter.draft
  );
}
