import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Menu, Shield, LogOut, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { VerificationSidebar, Verification } from "@/components/VerificationSidebar";
import { VerificationResult } from "@/components/VerificationResult";
import { ChatInput } from "@/components/ChatInput";
import { UserMessage } from "@/components/UserMessage";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { User } from "@supabase/supabase-js";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const Index = () => {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [conversations, setConversations] = useState<Verification[]>([]);
  const [currentConversationId, setCurrentConversationId] = useState<string | null>(null);
  const [currentClaim, setCurrentClaim] = useState<string | null>(null);
  const [currentResult, setCurrentResult] = useState<any | null>(null);
  const [agentSteps, setAgentSteps] = useState<string[]>([]);
  const [isVerifying, setIsVerifying] = useState(false);

  // claim that should be auto-verified when user is present
  const [autoRunClaim, setAutoRunClaim] = useState<string | null>(null);

  const location = useLocation();

  // -------------------------------
  // AUTH
  // -------------------------------
  useEffect(() => {
    const authRedirect = `/auth?returnTo=${encodeURIComponent(
      `${location.pathname}${location.search}`
    )}`;

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) navigate(authRedirect);
      else setUser(session.user);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) navigate(authRedirect);
      else setUser(session.user);
    });

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname, location.search]);

  // -------------------------------
  // LOAD CONVERSATIONS
  // -------------------------------
  useEffect(() => {
    if (user) loadConversations();
  }, [user]);

  const loadConversations = async () => {
    const { data, error } = await supabase
      .from("conversations")
      .select(`
        id,
        title,
        updated_at,
        messages (verification_status, confidence)
      `)
      .order("updated_at", { ascending: false })
      .limit(20);

    if (!error && data) {
      const toSidebarStatus = (status: string | null | undefined): Verification["status"] => {
        if (status === "verified" || status === "true") return "true";
        if (status === "refuted" || status === "false") return "false";
        return "unverified";
      };

      const mapped: Verification[] = data.map((conv: any) => {
        const lastResponse = conv.messages[0];
        return {
          id: conv.id,
          claim: conv.title || "New conversation",
          status: toSidebarStatus(lastResponse?.verification_status),
          confidence: lastResponse?.confidence ?? 0,
          timestamp: new Date(conv.updated_at),
          sources: conv.messages.length,
        };
      });
      setConversations(mapped);
    }
  };

  const handleNewChat = () => {
    setCurrentConversationId(null);
    setCurrentClaim(null);
    setCurrentResult(null);
    setAgentSteps([]);
  };

  // -------------------------------
  // VERIFY CLAIM + STREAM SSE
  // -------------------------------
  const handleVerifyClaim = async (claim: string) => {
    if (!user) return;

    setIsVerifying(true);
    setCurrentClaim(claim);
    setCurrentResult(null);
    setAgentSteps([]);

    try {
      // Create conversation if needed
      let conversationId = currentConversationId;
      if (!conversationId) {
        const { data: conv } = await supabase
          .from("conversations")
          .insert({ user_id: user.id, title: claim.slice(0, 100) })
          .select()
          .single();
        conversationId = conv.id;
        setCurrentConversationId(conversationId);
      }

      // Insert user message
      await supabase.from("messages").insert({
        conversation_id: conversationId,
        role: "user",
        content: claim,
      });

      const es = new EventSource(`${API_URL}/verify-stream?claim=${encodeURIComponent(claim)}`);

      es.addEventListener("step", (e) => {
        setAgentSteps((prev) => [...prev, JSON.parse(e.data)]);
      });

      es.addEventListener("final", async (e) => {
        const result = JSON.parse(e.data);
        es.close();
        setIsVerifying(false);
        setCurrentResult(result);

        // Store assistant message
        await supabase.from("messages").insert({
          conversation_id: conversationId,
          role: "assistant",
          content: result.factCheckSummary ?? "",
          verification_status: result.isVerified ? "verified" : "refuted",
          confidence: Math.round(result.confidence ?? 0),
          summary: result.factCheckSummary ?? "",
          sources: result.evidence ?? [],
        });

        await supabase
          .from("conversations")
          .update({ updated_at: new Date().toISOString() })
          .eq("id", conversationId);

        loadConversations();
        toast.success("Verification complete");
      });

      es.addEventListener("error", () => {
        es.close();
        setIsVerifying(false);
        toast.error("Stream connection failed");
      });
    } catch {
      setIsVerifying(false);
      toast.error("Verification failed");
    }
  };

  // -------------------------------
  // LOAD PAST CONVERSATION
  // -------------------------------
  const handleSelectVerification = async (v: Verification) => {
    setCurrentConversationId(v.id);
    setIsVerifying(true);
    setAgentSteps([]);

    const { data: messages } = await supabase
      .from("messages")
      .select("*")
      .eq("conversation_id", v.id)
      .order("created_at", { ascending: true });

    const userMsg = messages?.find((m) => m.role === "user");
    const assistantMsg = messages?.find((m) => m.role === "assistant");

    if (userMsg) setCurrentClaim(userMsg.content);

    if (assistantMsg) {
      setCurrentResult({
        verification_status: assistantMsg.verification_status,
        confidence: assistantMsg.confidence,
        summary: assistantMsg.summary,
        sources: assistantMsg.sources ?? [],
      });
    }

    setIsVerifying(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    toast.success("Signed out successfully");
  };

  // -------------------------------
  // UI
  // -------------------------------

  // If navigated with a `claim` in location state or URL, prefill the chat with it
  useEffect(() => {
    // Prefer location state (push), fallback to query param
    const stateClaim = (location.state as any)?.claim;
    const params = new URLSearchParams(location.search);
    const queryClaim = params.get("claim");

    const claim = stateClaim ?? queryClaim;
    if (claim) {
      setCurrentConversationId(null);
      setCurrentClaim(claim);
      setCurrentResult(null);
      setAgentSteps([]);
      // request auto-run of verification once user is available
      setAutoRunClaim(claim);
    }
    // we only want to handle this on mount / when location changes
  }, [location]);

  // when a claim was passed in and a user is available, auto-run verification once
  useEffect(() => {
    if (!autoRunClaim) return;
    if (!user) return; // wait for auth
    // avoid auto-running while already verifying
    if (isVerifying) return;

    // call the same handler used by the UI
    handleVerifyClaim(autoRunClaim);
    // clear the pending auto-run claim so we don't run again
    setAutoRunClaim(null);
  }, [autoRunClaim, user, isVerifying]);
  return (
    <div className="flex h-screen w-full bg-background">
      {/* Sidebar */}
      <div
        className={`${sidebarOpen ? "w-80" : "w-0"} transition-all duration-300 overflow-hidden border-r border-sidebar-border bg-sidebar`}
      >
        <div className="h-full flex flex-col">
          <div className="p-4 border-b flex items-center justify-between border-sidebar-border">
            <h2 className="text-lg font-semibold text-sidebar-foreground">Recent Chats</h2>
            <div className="flex gap-2">
              <Button variant="ghost" size="icon" title="New Chat" onClick={handleNewChat}>
                <Plus className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(false)}>
                <Menu className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <VerificationSidebar verifications={conversations} onSelectVerification={handleSelectVerification} />
        </div>
      </div>

      {/* MAIN AREA */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <header className="h-16 border-b border-border flex items-center px-6 gap-4">
          {!sidebarOpen && (
            <Button variant="ghost" size="icon" onClick={() => setSidebarOpen(true)}>
              <Menu className="h-4 w-4" />
            </Button>
          )}
          <div className="flex items-center gap-2">
            <Shield className="h-6 w-6 text-primary" />
            <h1 className="text-xl font-bold">
              Truth<span className="text-primary">Spotter</span>
            </h1>
          </div>
          <div className="ml-auto flex items-center gap-4">
            {user && <span className="text-sm text-muted-foreground">{user.email}</span>}
            <ThemeToggle />
            <Button variant="ghost" size="sm" onClick={() => navigate("/dashboard")}>
              Dashboard
            </Button>
            <Button variant="ghost" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4 mr-2" /> Sign out
            </Button>
          </div>
        </header>

        {/* Chat Area */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="max-w-4xl mx-auto space-y-6">
            {currentClaim && <UserMessage message={currentClaim} />}

            {/* Agent live stream */}
            {agentSteps.length > 0 && (
              <div className="bg-muted p-4 rounded-md border text-sm font-mono space-y-1 animate-in fade-in">
                {agentSteps.map((s, i) => (
                  <div key={i}>• {s}</div>
                ))}
              </div>
            )}

            {isVerifying && (
              <div className="flex items-center justify-center py-12 animate-pulse">
                <p className="text-muted-foreground">Processing claim...</p>
              </div>
            )}

            {/* Final result */}
            {currentResult && !isVerifying && (
              <VerificationResult
                status={(() => {
                  const s = currentResult.verification_status;
                  if (s === "verified" || s === "true") return "true";
                  if (s === "refuted" || s === "false") return "false";
                  if (currentResult.isVerified === true) return "true";
                  if (currentResult.isVerified === false) return "false";
                  return "unverified";
                })()}
                confidence={currentResult.confidence ?? 0}
                summary={currentResult.summary ?? currentResult.factCheckSummary ?? ""}
                sources={currentResult.sources ?? currentResult.evidence ?? []}
              />
            )}

            {!currentClaim && !isVerifying && (
              <div className="text-center py-20">
                <Shield className="h-20 w-20 text-primary mx-auto mb-6 opacity-50" />
                <h2 className="text-2xl font-bold">Welcome to TruthSpotter</h2>
                <p className="text-muted-foreground max-w-md mx-auto">
                  Enter any claim to verify its accuracy using multi-agent fact-checking.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Input */}
        <div className="border-t p-6">
          <div className="max-w-4xl mx-auto">
            <ChatInput onSubmit={handleVerifyClaim} disabled={isVerifying} />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Index;
