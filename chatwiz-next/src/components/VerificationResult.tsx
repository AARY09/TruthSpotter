import { CheckCircle2, XCircle, AlertCircle, ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { VerificationStatus } from "./VerificationSidebar";

type SourceInfo = string | { name?: string; icon?: string; [key: string]: any };

interface EvidenceItem {
  title?: string;
  source?: SourceInfo;
  snippet?: string;
  link?: string;
  date?: string;
}

interface VerificationResultProps {
  status: VerificationStatus;
  confidence: number;
  summary: string;
  sources?: EvidenceItem[]; // optional to prevent undefined crash
}

export const VerificationResult = ({
  status,
  confidence,
  summary,
  sources = [], // <- prevents undefined.length error
}: VerificationResultProps) => {
  const getStatusIcon = () => {
    switch (status) {
      case "true":
        return <CheckCircle2 className="h-5 w-5" />;
      case "false":
        return <XCircle className="h-5 w-5" />;
      case "unverified":
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getStatusColor = () => {
    switch (status) {
      case "true":
        return "text-verified-true";
      case "false":
        return "text-verified-false";
      case "unverified":
        return "text-verified-unverified";
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "true":
        return "Verified True";
      case "false":
        return "Verified False";
      case "unverified":
        return "Unverified";
    }
  };

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* ---- MAIN RESULT ---- */}
      <Card className="p-6 bg-card border-border">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-foreground">Verification Result</h2>
          <div className={cn("flex items-center gap-2", getStatusColor())}>
            {getStatusIcon()}
            <span className="font-semibold">{getStatusLabel()}</span>
          </div>
        </div>

        <div className="space-y-4">
          {/* Confidence */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-muted-foreground">Confidence Score</span>
              <span className="text-lg font-semibold text-foreground">{confidence}%</span>
            </div>
            <Progress value={confidence} className="h-2" />
          </div>

          {/* Summary */}
          <div>
            <h3 className="text-sm font-semibold text-foreground mb-2">Summary</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{summary}</p>
          </div>
        </div>
      </Card>

      {/* ---- EVIDENCE SOURCES ---- */}
      <Card className="p-6 bg-card border-border">
        <div className="mb-4">
          <h3 className="text-lg font-semibold text-foreground">Evidence Sources</h3>
          <p className="text-sm text-muted-foreground">{sources.length} sources analyzed</p>
        </div>

        {sources.length === 0 ? (
          <p className="text-center text-muted-foreground py-4">
            No evidence sources available for this claim.
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {sources.map((item, index) => {
              const sourceName =
                typeof item.source === "string"
                  ? item.source
                  : item.source?.name ?? "Unknown source";
              const title = item.title ?? sourceName ?? "Untitled source";
              const snippet =
                item.snippet ?? "No summary available for this evidence.";

              return (
                <Card key={index} className="p-4 bg-secondary border-border">
                  <div className="flex items-start justify-between mb-3">
                    <h4 className="text-sm font-semibold text-foreground flex-1 line-clamp-2">
                      {title}
                    </h4>
                  </div>

                  <p className="text-xs text-primary mb-2">{sourceName}</p>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {snippet}
                  </p>

                  {item.link && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => window.open(item.link, "_blank")}
                    >
                      <ExternalLink className="h-3 w-3" />
                      View Source
                    </Button>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
