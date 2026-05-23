import { X, CheckCircle2, XCircle, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

export type VerificationStatus = "true" | "false" | "unverified";

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
  const getStatusIcon = (status: VerificationStatus) => {
    switch (status) {
      case "true":
        return <CheckCircle2 className="h-4 w-4" />;
      case "false":
        return <XCircle className="h-4 w-4" />;
      case "unverified":
        return <AlertCircle className="h-4 w-4" />;
    }
  };

  const getStatusColor = (status: VerificationStatus) => {
    switch (status) {
      case "true":
        return "text-verified-true";
      case "false":
        return "text-verified-false";
      case "unverified":
        return "text-verified-unverified";
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
          {verifications.map((verification) => (
            <button
              key={verification.id}
              onClick={() => onSelectVerification?.(verification)}
              className="w-full text-left p-3 rounded-lg bg-sidebar-accent hover:bg-sidebar-accent/80 transition-colors border border-sidebar-border"
            >
              <div className="flex items-start gap-2 mb-2">
                <div className={cn("flex items-center gap-1", getStatusColor(verification.status))}>
                  {getStatusIcon(verification.status)}
                  <span className="text-xs font-medium capitalize">{verification.status}</span>
                </div>
                <span className="text-xs text-muted-foreground ml-auto">
                  {getTimeAgo(verification.timestamp)}
                </span>
              </div>
              <p className="text-sm text-sidebar-foreground line-clamp-2 mb-2">
                {verification.claim}
              </p>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">{verification.confidence}% confidence</span>
                <span className="text-muted-foreground">{verification.sources} sources</span>
              </div>
            </button>
          ))}
        </div>
      </ScrollArea>
  );
};
