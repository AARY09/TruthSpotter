import { CheckCircle2, XCircle, AlertCircle, HelpCircle, Clock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type VerificationStatus = "true" | "false" | "unverified" | "inconclusive";

export interface Verification {
  id: string;
  claim: string;
  status: VerificationStatus;
  confidence: number;
  timestamp: Date;
  sources: number;
}

interface VerificationSidebarProps {
  verifications: Verification[];
  onSelectVerification?: (verification: Verification) => void;
}

export const VerificationSidebar = ({
  verifications,
  onSelectVerification,
}: VerificationSidebarProps) => {
  const renderStatusBadge = (status: VerificationStatus) => {
    switch (status) {
      case "true":
        return (
          <Badge
            variant="outline"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30 shadow-none transition-all"
          >
            <CheckCircle2 className="h-3 w-3 shrink-0 stroke-[2.5]" />
            <span>Verified</span>
          </Badge>
        );
      case "false":
        return (
          <Badge
            variant="outline"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-rose-500/15 text-rose-600 dark:text-rose-400 border-rose-500/30 shadow-none transition-all"
          >
            <XCircle className="h-3 w-3 shrink-0 stroke-[2.5]" />
            <span>False</span>
          </Badge>
        );
      case "inconclusive":
        return (
          <Badge
            variant="outline"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-purple-500/15 text-purple-600 dark:text-purple-400 border-purple-500/30 shadow-none transition-all"
          >
            <HelpCircle className="h-3 w-3 shrink-0 stroke-[2.5]" />
            <span>Inconclusive</span>
          </Badge>
        );
      case "unverified":
      default:
        return (
          <Badge
            variant="outline"
            className="inline-flex items-center gap-1.5 px-2 py-0.5 text-[11px] font-semibold rounded-md border bg-amber-500/15 text-amber-600 dark:text-amber-400 border-amber-500/30 shadow-none transition-all"
          >
            <AlertCircle className="h-3 w-3 shrink-0 stroke-[2.5]" />
            <span>Unverified</span>
          </Badge>
        );
    }
  };

  const getTimeAgo = (date: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);

    if (diffInSeconds < 60) return "Just now";
    if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
    if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
    return `${Math.floor(diffInSeconds / 86400)}d ago`;
  };

  return (
    <ScrollArea className="flex-1">
      <div className="p-2 space-y-2">
        {verifications.length === 0 ? (
          <div className="py-8 px-4 text-center text-xs text-muted-foreground">
            No verification history yet
          </div>
        ) : (
          verifications.map((verification) => (
            <button
              key={verification.id}
              onClick={() => onSelectVerification?.(verification)}
              className="group w-full text-left p-3 rounded-xl bg-sidebar-accent/50 hover:bg-sidebar-accent transition-all duration-200 border border-sidebar-border hover:border-sidebar-ring/40 shadow-sm hover:shadow"
            >
              <div className="flex items-center justify-between gap-2 mb-2">
                {renderStatusBadge(verification.status)}
                <span className="text-[11px] font-medium text-muted-foreground/80 flex items-center gap-1 shrink-0">
                  <Clock className="h-3 w-3 opacity-60" />
                  {getTimeAgo(verification.timestamp)}
                </span>
              </div>
              <p className="text-sm font-medium text-sidebar-foreground line-clamp-2 mb-2 group-hover:text-primary transition-colors leading-snug">
                {verification.claim}
              </p>
              <div className="flex items-center justify-between text-[11px] font-medium text-muted-foreground pt-1.5 border-t border-sidebar-border/60">
                <span className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-block h-1.5 w-1.5 rounded-full",
                      verification.status === "true"
                        ? "bg-emerald-500"
                        : verification.status === "false"
                        ? "bg-rose-500"
                        : verification.status === "inconclusive"
                        ? "bg-purple-500"
                        : "bg-amber-500"
                    )}
                  />
                  {verification.confidence}% confidence
                </span>
                <span>{verification.sources} sources</span>
              </div>
            </button>
          ))
        )}
      </div>
    </ScrollArea>
  );
};
