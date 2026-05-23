import { Card } from "@/components/ui/card";

interface UserMessageProps {
  message: string;
}

export const UserMessage = ({ message }: UserMessageProps) => {
  return (
    <div className="flex justify-end animate-in fade-in slide-in-from-right-4 duration-300">
      <Card className="max-w-[80%] p-4 bg-primary text-primary-foreground">
        <p className="text-sm leading-relaxed">{message}</p>
      </Card>
    </div>
  );
};
