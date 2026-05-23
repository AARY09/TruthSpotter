import { useState } from "react";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

interface ChatInputProps {
  onSubmit: (claim: string) => void;
  disabled?: boolean;
}

export const ChatInput = ({ onSubmit, disabled }: ChatInputProps) => {
  const [claim, setClaim] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (claim.trim() && !disabled) {
      onSubmit(claim);
      setClaim("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="w-full">
      <div className="relative">
        <Textarea
          value={claim}
          onChange={(e) => setClaim(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter a claim to verify..."
          disabled={disabled}
          className="min-h-[60px] pr-12 resize-none bg-input border-border text-foreground placeholder:text-muted-foreground"
        />
        <Button
          type="submit"
          size="icon"
          disabled={!claim.trim() || disabled}
          className="absolute bottom-2 right-2 h-8 w-8"
        >
          <Search className="h-4 w-4" />
        </Button>
      </div>
    </form>
  );
};
