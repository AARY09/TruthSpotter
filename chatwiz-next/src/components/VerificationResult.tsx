import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ExternalLink,
  Quote,
  FileText,
  Shield,
  Layers,
  Check,
  X,
  Info,
  Link as LinkIcon,
  BookOpen,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { VerificationStatus } from "./VerificationSidebar";

export type EvidenceStance = "SUPPORTS" | "CONTRADICTS" | "NEUTRAL_CONTEXT";

type SourceInfo = string | { name?: string; icon?: string; [key: string]: any };

export interface EvidenceItem {
  id?: string;
  citationNumber?: number;
  title?: string;
  source?: SourceInfo;
  publisher?: string;
  snippet?: string;
  link?: string;
  url?: string;
  date?: string;
  stance?: EvidenceStance;
  finding?: string;
  highlightedQuote?: string;
  supportsVerdict?: boolean;
}

export interface FactualStatement {
  statement: string;
  citationIds?: string[];
  citationNumbers?: number[];
  sources?: { id?: string; title?: string; publisher?: string; link?: string }[];
}

export interface VerificationResultProps {
  claim?: string;
  status: VerificationStatus;
  confidence: number;
  summary: string;
  analysis?: string;
  sources?: EvidenceItem[];
  supportingEvidence?: EvidenceItem[];
  contradictingEvidence?: EvidenceItem[];
  contextEvidence?: EvidenceItem[];
  factualStatements?: FactualStatement[];
}

export const VerificationResult = ({
  claim,
  status,
  confidence,
  summary,
  analysis,
  sources = [],
  supportingEvidence,
  contradictingEvidence,
  contextEvidence,
  factualStatements = [],
}: VerificationResultProps) => {
  const [highlightedDocId, setHighlightedDocId] = useState<string | null>(null);

  // Normalize source list with fallback citation numbers and IDs
  const normalizedSources: EvidenceItem[] = sources.map((item, idx) => {
    const pub =
      typeof item.source === "string"
        ? item.source
        : item.source?.name || item.publisher || "Unknown Publisher";
    const url = item.link || item.url || "";
    const citationNumber = item.citationNumber || idx + 1;
    const id = item.id || `doc_${citationNumber}`;
    return {
      ...item,
      id,
      citationNumber,
      publisher: pub,
      source: pub,
      link: url,
      url,
      title: item.title || pub || "Untitled Source",
      date: item.date || "Recent",
      snippet: item.snippet || "No snippet available",
      stance: item.stance || (status === "true" ? "SUPPORTS" : status === "false" ? "CONTRADICTS" : "NEUTRAL_CONTEXT"),
      finding: item.finding || (item.stance === "SUPPORTS" ? "Supports the claim" : item.stance === "CONTRADICTS" ? "Contradicts the claim" : "Provides contextual background"),
      highlightedQuote: item.highlightedQuote || item.snippet || "",
    };
  });

  // Group evidence by stance
  const supporting =
    supportingEvidence && supportingEvidence.length > 0
      ? supportingEvidence
      : normalizedSources.filter((s) => s.stance === "SUPPORTS");

  const contradicting =
    contradictingEvidence && contradictingEvidence.length > 0
      ? contradictingEvidence
      : normalizedSources.filter((s) => s.stance === "CONTRADICTS");

  const context =
    contextEvidence && contextEvidence.length > 0
      ? contextEvidence
      : normalizedSources.filter(
          (s) => s.stance === "NEUTRAL_CONTEXT" || (!s.stance && s.finding)
        );

  const getStatusIcon = () => {
    switch (status) {
      case "true":
        return <CheckCircle2 className="h-6 w-6 text-green-500" />;
      case "false":
        return <XCircle className="h-6 w-6 text-red-500" />;
      case "unverified":
        return <AlertCircle className="h-6 w-6 text-amber-500" />;
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "true":
        return "Verified True";
      case "false":
        return "Verified False / Misinformation";
      case "unverified":
        return "Unverified / Inconclusive";
    }
  };

  const getStatusBorder = () => {
    switch (status) {
      case "true":
        return "border-l-4 border-l-green-500";
      case "false":
        return "border-l-4 border-l-red-500";
      case "unverified":
        return "border-l-4 border-l-amber-500";
    }
  };

  const getStanceBadge = (stance?: EvidenceStance) => {
    switch (stance) {
      case "SUPPORTS":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 gap-1 font-medium hover:bg-emerald-500/20">
            <Check className="h-3 w-3" /> Supports Claim
          </Badge>
        );
      case "CONTRADICTS":
        return (
          <Badge className="bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 gap-1 font-medium hover:bg-rose-500/20">
            <X className="h-3 w-3" /> Contradicts Claim
          </Badge>
        );
      case "NEUTRAL_CONTEXT":
      default:
        return (
          <Badge className="bg-sky-500/15 text-sky-600 dark:text-sky-400 border-sky-500/30 gap-1 font-medium hover:bg-sky-500/20">
            <Info className="h-3 w-3" /> Context / Warning
          </Badge>
        );
    }
  };

  const scrollToEvidence = (citationNum: number) => {
    const el = document.getElementById(`evidence-row-${citationNum}`);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      const docId = `doc_${citationNum}`;
      setHighlightedDocId(docId);
      setTimeout(() => setHighlightedDocId(null), 3000);
    }
  };

  // Helper to parse inline citation brackets [1], [2] into clickable badges
  const renderTextWithCitations = (text: string) => {
    if (!text) return null;
    const parts = text.split(/(\[\d+\])/g);
    return parts.map((part, i) => {
      const match = part.match(/\[(\d+)\]/);
      if (match) {
        const num = parseInt(match[1], 10);
        return (
          <button
            key={i}
            onClick={() => scrollToEvidence(num)}
            className="inline-flex items-center justify-center font-mono text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-primary/15 text-primary hover:bg-primary hover:text-primary-foreground transition-all duration-150 mx-0.5 cursor-pointer align-baseline hover:scale-105"
            title={`Jump to Source [${num}]`}
          >
            [{num}]
          </button>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ========================================================
          1. MAIN VERDICT CARD
         ======================================================== */}
      <Card className={cn("p-6 bg-card border-border shadow-md transition-all", getStatusBorder())}>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-full bg-muted/60">{getStatusIcon()}</div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs uppercase tracking-wider text-muted-foreground font-semibold">
                  Verification Verdict
                </span>
              </div>
              <h2 className="text-xl font-bold text-foreground">{getStatusLabel()}</h2>
            </div>
          </div>

          {/* Stance Counter Badges */}
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs gap-1 border-emerald-500/40 text-emerald-600 dark:text-emerald-400 bg-emerald-500/10">
              <Check className="h-3 w-3" /> {supporting.length} Supporting
            </Badge>
            <Badge variant="outline" className="text-xs gap-1 border-rose-500/40 text-rose-600 dark:text-rose-400 bg-rose-500/10">
              <X className="h-3 w-3" /> {contradicting.length} Contradicting
            </Badge>
            <Badge variant="outline" className="text-xs gap-1 border-sky-500/40 text-sky-600 dark:text-sky-400 bg-sky-500/10">
              <Info className="h-3 w-3" /> {context.length} Context
            </Badge>
          </div>
        </div>

        {claim && (
          <div className="mb-4 p-3 rounded-lg bg-muted/40 border border-border/50 text-sm">
            <span className="font-semibold text-muted-foreground text-xs uppercase tracking-wider block mb-1">
              Evaluated Claim:
            </span>
            <p className="text-foreground font-medium italic">"{claim}"</p>
          </div>
        )}

        <div className="space-y-4">
          {/* Confidence Progress Bar */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground font-medium">Confidence Score</span>
              <span className="text-lg font-bold text-foreground">{confidence}%</span>
            </div>
            <Progress value={confidence} className="h-2.5" />
          </div>

          {/* Fact Check Summary with Interactive Citations */}
          <div className="p-4 rounded-xl bg-muted/30 border border-border/60">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Shield className="h-3.5 w-3.5 text-primary" />
              Fact-Check Summary & Evidence Citations
            </h3>
            <p className="text-sm text-foreground leading-relaxed">
              {renderTextWithCitations(summary)}
            </p>
          </div>
        </div>
      </Card>

      {/* ========================================================
          2. KEY FACTUAL STATEMENTS & CITATION TRACING
         ======================================================== */}
      {factualStatements && factualStatements.length > 0 && (
        <Card className="p-6 bg-card border-border shadow-sm">
          <div className="mb-4">
            <h3 className="text-md font-semibold text-foreground flex items-center gap-2">
              <LinkIcon className="h-4 w-4 text-primary" />
              Factual Statements & Citation Tracing
            </h3>
            <p className="text-xs text-muted-foreground">
              Every major factual statement synthesized from the evidence, linked directly to its source.
            </p>
          </div>

          <div className="space-y-3">
            {factualStatements.map((stmt, idx) => (
              <div
                key={idx}
                className="p-3.5 rounded-lg border border-border/70 bg-muted/20 hover:bg-muted/40 transition-colors flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-start gap-2.5 flex-1">
                  <span className="flex-shrink-0 w-5 h-5 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center mt-0.5">
                    {idx + 1}
                  </span>
                  <p className="text-sm text-foreground leading-normal font-medium">
                    {stmt.statement}
                  </p>
                </div>

                {/* Citation links */}
                <div className="flex items-center gap-1.5 flex-wrap pl-7 sm:pl-0">
                  <span className="text-xs text-muted-foreground font-medium mr-1">Sources:</span>
                  {(stmt.citationNumbers || [1]).map((num) => {
                    const matchedSource = normalizedSources.find((s) => s.citationNumber === num);
                    return (
                      <button
                        key={num}
                        onClick={() => scrollToEvidence(num)}
                        className="inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md bg-secondary hover:bg-primary hover:text-primary-foreground border border-border transition-colors cursor-pointer"
                        title={matchedSource?.title || `Evidence ${num}`}
                      >
                        <span className="font-mono text-primary font-bold">[{num}]</span>
                        <span className="max-w-[120px] truncate">{matchedSource?.publisher || `Source ${num}`}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ========================================================
          3. EVIDENCE VERIFICATION & FINDING MATRIX (TABLE / TABS)
         ======================================================== */}
      <Card className="p-6 bg-card border-border shadow-sm">
        <div className="mb-6">
          <h3 className="text-lg font-semibold text-foreground flex items-center gap-2">
            <Layers className="h-5 w-5 text-primary" />
            Evidence Verification & Finding Matrix
          </h3>
          <p className="text-sm text-muted-foreground">
            Detailed breakdown of retrieved articles, their specific stance, findings, and highlighted quote evidence.
          </p>
        </div>

        <Tabs defaultValue="matrix" className="w-full">
          <TabsList className="mb-4 grid grid-cols-2 sm:grid-cols-4 w-full h-auto p-1 bg-muted/60">
            <TabsTrigger value="matrix" className="text-xs sm:text-sm py-2">
              Evidence Matrix ({normalizedSources.length})
            </TabsTrigger>
            <TabsTrigger value="supporting" className="text-xs sm:text-sm py-2 text-emerald-600 dark:text-emerald-400">
              Supporting ({supporting.length})
            </TabsTrigger>
            <TabsTrigger value="contradicting" className="text-xs sm:text-sm py-2 text-rose-600 dark:text-rose-400">
              Contradicting ({contradicting.length})
            </TabsTrigger>
            <TabsTrigger value="analysis" className="text-xs sm:text-sm py-2">
              Full Analysis
            </TabsTrigger>
          </TabsList>

          {/* TAB 1: THE EVIDENCE | FINDING MATRIX TABLE */}
          <TabsContent value="matrix" className="space-y-4">
            {normalizedSources.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                No evidence sources available for this claim.
              </p>
            ) : (
              <div className="rounded-lg border border-border overflow-hidden">
                <Table>
                  <TableHeader className="bg-muted/50">
                    <TableRow>
                      <TableHead className="w-[40%] font-semibold">Evidence Article</TableHead>
                      <TableHead className="w-[60%] font-semibold">Finding & Highlighted Quote</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {normalizedSources.map((item) => {
                      const isHighlighted = highlightedDocId === item.id;
                      return (
                        <TableRow
                          key={item.id}
                          id={`evidence-row-${item.citationNumber}`}
                          className={cn(
                            "transition-colors duration-500",
                            isHighlighted && "bg-primary/10 ring-2 ring-primary/40"
                          )}
                        >
                          {/* Evidence Column */}
                          <TableCell className="align-top py-4">
                            <div className="space-y-2">
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-xs font-bold px-2 py-0.5 rounded bg-primary/10 text-primary">
                                  [{item.citationNumber}]
                                </span>
                                <span className="text-xs font-semibold text-primary">
                                  {item.publisher}
                                </span>
                              </div>

                              <h4 className="text-sm font-semibold text-foreground line-clamp-2 leading-snug">
                                {item.title}
                              </h4>

                              <div className="text-xs text-muted-foreground">
                                <span>{item.date}</span>
                              </div>

                              {item.link && (
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="h-7 text-xs gap-1.5 mt-1 border-border/80 hover:bg-primary hover:text-primary-foreground"
                                  onClick={() => window.open(item.link, "_blank")}
                                >
                                  <ExternalLink className="h-3 w-3" />
                                  View Source URL
                                </Button>
                              )}
                            </div>
                          </TableCell>

                          {/* Finding Column */}
                          <TableCell className="align-top py-4">
                            <div className="space-y-3">
                              {/* Stance Badge & Finding */}
                              <div className="flex items-start gap-2 flex-wrap">
                                {getStanceBadge(item.stance)}
                              </div>

                              <p className="text-sm text-foreground font-medium leading-relaxed">
                                {item.finding}
                              </p>

                              {/* Highlighted Quote Box */}
                              {item.highlightedQuote && (
                                <div className="p-3 rounded-lg bg-muted/60 border-l-2 border-primary/60 text-xs text-muted-foreground flex items-start gap-2">
                                  <Quote className="h-3.5 w-3.5 text-primary flex-shrink-0 mt-0.5" />
                                  <p className="italic leading-relaxed">
                                    "{item.highlightedQuote}"
                                  </p>
                                </div>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </TabsContent>

          {/* TAB 2: SUPPORTING EVIDENCE */}
          <TabsContent value="supporting" className="space-y-4">
            {supporting.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg">
                <p>No supporting evidence articles found for this claim.</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {supporting.map((item) => (
                  <Card key={item.id} className="p-4 bg-emerald-500/5 border-emerald-500/20 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Badge className="bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 border-none text-xs gap-1">
                          <Check className="h-3 w-3" /> Supports [{item.citationNumber}]
                        </Badge>
                        <span className="text-xs text-muted-foreground">{item.date}</span>
                      </div>
                      <h4 className="text-sm font-semibold text-foreground mb-1 leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-xs text-primary font-medium mb-3">{item.publisher}</p>
                      <p className="text-sm text-foreground/90 font-medium mb-3">
                        {item.finding}
                      </p>
                      {item.highlightedQuote && (
                        <div className="p-2.5 rounded bg-background/80 border border-emerald-500/20 text-xs text-muted-foreground italic mb-3">
                          "{item.highlightedQuote}"
                        </div>
                      )}
                    </div>
                    {item.link && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 mt-2 text-xs"
                        onClick={() => window.open(item.link, "_blank")}
                      >
                        <ExternalLink className="h-3 w-3" /> Open Article
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 3: CONTRADICTING EVIDENCE */}
          <TabsContent value="contradicting" className="space-y-4">
            {contradicting.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground bg-muted/20 rounded-lg">
                <p>No contradicting evidence articles found for this claim.</p>
              </div>
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {contradicting.map((item) => (
                  <Card key={item.id} className="p-4 bg-rose-500/5 border-rose-500/20 shadow-sm flex flex-col justify-between">
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Badge className="bg-rose-500/20 text-rose-600 dark:text-rose-400 border-none text-xs gap-1">
                          <X className="h-3 w-3" /> Contradicts [{item.citationNumber}]
                        </Badge>
                        <span className="text-xs text-muted-foreground">{item.date}</span>
                      </div>
                      <h4 className="text-sm font-semibold text-foreground mb-1 leading-snug">
                        {item.title}
                      </h4>
                      <p className="text-xs text-primary font-medium mb-3">{item.publisher}</p>
                      <p className="text-sm text-foreground/90 font-medium mb-3">
                        {item.finding}
                      </p>
                      {item.highlightedQuote && (
                        <div className="p-2.5 rounded bg-background/80 border border-rose-500/20 text-xs text-muted-foreground italic mb-3">
                          "{item.highlightedQuote}"
                        </div>
                      )}
                    </div>
                    {item.link && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="w-full gap-1.5 mt-2 text-xs"
                        onClick={() => window.open(item.link, "_blank")}
                      >
                        <ExternalLink className="h-3 w-3" /> Open Article
                      </Button>
                    )}
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* TAB 4: FULL DETAILED ANALYSIS WITH INLINE CITATIONS */}
          <TabsContent value="analysis" className="space-y-4">
            <div className="p-5 rounded-xl bg-muted/30 border border-border/70 space-y-3">
              <h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-primary" />
                Comprehensive Investigation Analysis
              </h4>
              <div className="text-sm text-foreground/90 leading-relaxed space-y-2 whitespace-pre-line">
                {renderTextWithCitations(analysis || summary)}
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </Card>
    </div>
  );
};
