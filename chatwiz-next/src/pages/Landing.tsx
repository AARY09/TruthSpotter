import { Link, useNavigate } from "react-router-dom";
import { Sparkles, ArrowRight, Radio, Zap, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Navbar } from "@/components/Navbar";

const stats = [
  { label: "Claims processed", value: "2.3M+" },
  { label: "Avg. verdict time", value: "28s" },
  { label: "Global partners", value: "42" },
];

const features = [
  {
    icon: ShieldCheck,
    title: "Agentic verification",
    copy: "Analyzer → Researcher → Fact Checker → Synthesizer. The same four-agent loop that powers the dashboard.",
  },
  {
    icon: Radio,
    title: "Daily rumor watch",
    copy: "New watcher agent sweeps Google News and social chatter every morning, routing narratives into RAG memory.",
  },
  {
    icon: Zap,
    title: "Crisis-grade UX",
    copy: "Latency-tuned SSE streaming, Supabase audit trails, and a neon noir UI inspired by Aceternity surfaces.",
  },
];

const Landing = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="relative isolate overflow-hidden">
        <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.22),_transparent_70%)] blur-3xl" />
        <Navbar />

        <main className="container space-y-24 pb-24 pt-10">
          <section className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] items-center">
            <div className="space-y-6">
              <Badge className="w-fit border border-primary/40 bg-primary/10 text-primary">Aceternity Glow Edition</Badge>
              <h1 className="text-4xl font-semibold leading-tight md:text-6xl">
                Real-time misinformation defense for newsrooms and civic teams.
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl">
                TruthSpotter pairs LangChain + Qdrant retrieval with an agentic reasoner so you can surface, verify, and
                brief high-risk claims before they spiral.
              </p>
              <div className="flex flex-wrap gap-4">
                <Button size="lg" className="gap-2" onClick={() => navigate("/auth")}>
                  Get started
                  <Sparkles className="h-4 w-4" />
                </Button>
                <Button size="lg" variant="outline" asChild>
                  <Link to="/pricing">View pricing</Link>
                </Button>
              </div>
              <div className="grid grid-cols-3 gap-4 pt-6">
                {stats.map((stat) => (
                  <div key={stat.label} className="rounded-2xl border border-white/10 bg-card/70 p-4 text-center backdrop-blur">
                    <p className="text-3xl font-semibold">{stat.value}</p>
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">{stat.label}</p>
                  </div>
                ))}
              </div>
            </div>
            <Card className="relative border-primary/30 bg-gradient-to-br from-background/80 via-background to-primary/10 shadow-xl backdrop-blur">
              <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-[110px]" />
              <CardContent className="space-y-6 p-8">
                <p className="text-xs uppercase tracking-widest text-primary">Live agent feed</p>
                <div className="space-y-3 text-sm font-mono">
                  {["Analyzer → Parsed 4 sub-claims", "Researcher → Stored 6 sources", "Fact Checker → Verdict: Refuted", "Synthesizer → JSON brief ready"].map(
                    (log) => (
                      <div key={log} className="flex items-center gap-3 rounded-xl border border-white/5 bg-muted/40 px-4 py-3">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        {log}
                      </div>
                    )
                  )}
                </div>
                <div className="rounded-2xl border border-primary/40 bg-background/80 p-6 shadow-inner shadow-primary/20">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">Active investigation</p>
                  <p className="text-lg font-semibold">“New polio outbreak in Delhi hospitals?”</p>
                  <p className="text-sm text-muted-foreground">
                    Auto-routing to task force, status streaming inside the dashboard.
                  </p>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className="space-y-10">
            <div className="flex flex-wrap items-center gap-4">
              <Badge variant="outline">Product DNA</Badge>
              <h2 className="text-3xl font-semibold">Why teams standardize on TruthSpotter</h2>
            </div>
            <div className="grid gap-6 md:grid-cols-3">
              {features.map(({ icon: Icon, title, copy }) => (
                <Card key={title} className="border-muted/40 bg-card/70 backdrop-blur transition hover:border-primary/50">
                  <CardContent className="space-y-4 p-6">
                    <div className="flex items-center justify-between">
                      <div className="rounded-full bg-primary/10 p-3 text-primary">
                        <Icon className="h-5 w-5" />
                      </div>
                      <Badge variant="outline" className="text-xs uppercase tracking-wide">
                        Live
                      </Badge>
                    </div>
                    <h3 className="text-xl font-semibold">{title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{copy}</p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default Landing;

