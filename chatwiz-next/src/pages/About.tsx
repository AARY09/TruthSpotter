import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ArrowRight, Globe, MessageSquareWarning, Target, Zap, Award, TrendingUp, ShieldCheck, Database } from "lucide-react";
import { Navbar } from "@/components/Navbar";

const milestones = [
  {
    year: "2023",
    title: "Election pilot",
    summary: "Partnered with three fact-check desks to stress test the agent orchestrator.",
  },
  {
    year: "2024",
    title: "Dashboard launch",
    summary: "Released the streaming verification UI built with Supabase + shadcn + Aceternity gradients.",
  },
  {
    year: "2025",
    title: "Rumor watcher",
    summary: "New watcher agent ingests viral claims daily and routes them to Qdrant for retrieval.",
  },
];

const team = [
  { name: "Mayuresh Mhatre", role: "Head of Trust & Safety" },
  { name: "Sagar Jadhav", role: "Lead ML Engineer" },
  { name: "Aakash Borji", role: "Customer Operations" },
  { name: "Aary Jain", role: "PR Head" },
];

const values = [
  {
    icon: Target,
    title: "Transparency First",
    description: "Every verdict includes explainable reasoning, source citations, and confidence metrics.",
  },
  {
    icon: Zap,
    title: "Crisis-Ready",
    description: "Optimized for high-volume, real-time verification during breaking news and emergencies.",
  },
  {
    icon: Award,
    title: "Evidence-Linked",
    description: "Users can explore the exact sources and data that led to each verification conclusion.",
  },
];

const techStack = [
  {
    icon: ShieldCheck,
    name: "Agentic AI",
    description: "Multi-agent orchestration with LangChain and OpenAI Agents SDK",
  },
  {
    icon: Database,
    name: "Vector Search",
    description: "Qdrant-powered RAG for real-time evidence retrieval",
  },
  {
    icon: TrendingUp,
    name: "Real-time Streaming",
    description: "SSE-based status updates and live verification feeds",
  },
];

const About = () => (
  <div className="min-h-screen bg-background text-foreground">
    <div className="relative isolate overflow-hidden">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,_rgba(59,130,246,0.15),_transparent_70%)] blur-3xl" />
      <Navbar showGetStarted={false} />
      
      <div className="container py-16 space-y-20">
        {/* Hero Section */}
        <section className="grid items-center gap-12 md:grid-cols-[1.1fr_0.9fr]">
          <div className="space-y-6">
            <Badge variant="outline" className="w-fit uppercase tracking-[0.3em] text-xs">
              About TruthSpotter
            </Badge>
            <h1 className="text-4xl md:text-5xl font-semibold leading-tight">
              We build AI copilots that keep public discourse anchored in verifiable evidence.
            </h1>
            <p className="text-lg text-muted-foreground leading-relaxed">
              TruthSpotter was born inside civic response teams dealing with rolling crises. The neon-noir interface,
              LangChain tool calling, and Supabase audit trails you see across the product all came from that urgency.
              Today, we serve newsrooms, fact-checkers, and emergency responders who need transparent, explainable
              verification at scale.
            </p>
            <div className="flex flex-wrap gap-4">
              <Button asChild className="gap-2">
                <Link to="/pricing">
                  Explore pricing
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/auth">Request access</Link>
              </Button>
            </div>
          </div>
          
          <Card className="relative border-primary/30 bg-gradient-to-br from-card/80 via-card to-primary/10 shadow-xl backdrop-blur">
            <div className="absolute -right-10 -top-10 h-40 w-40 rounded-full bg-primary/20 blur-[110px]" />
            <CardContent className="space-y-6 p-8">
              <div className="flex items-center gap-3 text-muted-foreground">
                <Globe className="h-5 w-5 text-primary" />
                <span className="text-sm font-medium">Operating across 5 continents</span>
              </div>
              <div className="rounded-2xl border border-primary/40 bg-background/80 p-6 space-y-4 shadow-inner shadow-primary/20">
                <MessageSquareWarning className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-lg font-semibold mb-2">Our Mission</p>
                  <p className="text-sm text-muted-foreground leading-relaxed">
                    Equip journalists, civil society, and emergency responders with an explainable agentic verifier
                    that reduces misinformation half-life during high-stress moments.
                  </p>
                </div>
              </div>
              <div className="space-y-4">
                <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Core Team</p>
                <div className="grid gap-4">
                  {team.map((member) => (
                    <div key={member.name} className="flex items-center gap-4 rounded-xl border border-muted/40 bg-muted/20 p-4">
                      <Avatar className="h-12 w-12 border-2 border-primary/30">
                        <AvatarFallback className="bg-primary/10 text-primary font-semibold">
                          {member.name.slice(0, 2)}
                        </AvatarFallback>
                      </Avatar>
                      <div>
                        <p className="font-semibold">{member.name}</p>
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">{member.role}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* Values Section */}
        <section className="space-y-8">
          <div className="text-center space-y-4">
            <Badge variant="outline" className="uppercase tracking-[0.3em] text-xs">
              Our Values
            </Badge>
            <h2 className="text-3xl font-semibold">What drives TruthSpotter</h2>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {values.map((value) => {
              const Icon = value.icon;
              return (
                <Card key={value.title} className="border-muted/40 bg-card/70 backdrop-blur transition hover:border-primary/50 hover:shadow-lg">
                  <CardContent className="space-y-4 p-6">
                    <div className="rounded-full bg-primary/10 p-4 w-fit text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-xl font-semibold">{value.title}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{value.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Tech Stack Section */}
        <section className="space-y-8">
          <div className="text-center space-y-4">
            <Badge variant="outline" className="uppercase tracking-[0.3em] text-xs">
              Technology
            </Badge>
            <h2 className="text-3xl font-semibold">Built on Modern AI Infrastructure</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              TruthSpotter leverages cutting-edge AI and vector search technologies to deliver fast, accurate verification.
            </p>
          </div>
          <div className="grid gap-6 md:grid-cols-3">
            {techStack.map((tech) => {
              const Icon = tech.icon;
              return (
                <Card key={tech.name} className="border-muted/40 bg-card/70 backdrop-blur transition hover:border-primary/50 hover:shadow-lg">
                  <CardContent className="space-y-4 p-6">
                    <div className="rounded-full bg-primary/10 p-4 w-fit text-primary">
                      <Icon className="h-6 w-6" />
                    </div>
                    <h3 className="text-xl font-semibold">{tech.name}</h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">{tech.description}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Milestones Section */}
        <section className="space-y-8">
          <div className="text-center space-y-4">
            <Badge variant="outline" className="uppercase tracking-[0.3em] text-xs">
              Timeline
            </Badge>
            <h2 className="text-3xl font-semibold">Our Journey</h2>
          </div>
          <div className="relative">
            {/* Timeline line */}
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-primary/40 via-primary/30 to-primary/20 md:left-1/2 md:-translate-x-0.5" />
            <div className="space-y-12 md:space-y-16">
              {milestones.map((milestone, index) => (
                <div
                  key={milestone.year}
                  className={`relative flex items-center gap-6 md:gap-12 ${
                    index % 2 === 0 ? "md:flex-row" : "md:flex-row-reverse"
                  }`}
                >
                  {/* Timeline dot */}
                  <div className="relative z-10 flex-shrink-0">
                    <div className="h-8 w-8 rounded-full bg-primary border-4 border-background shadow-lg flex items-center justify-center">
                      <div className="h-2 w-2 rounded-full bg-primary" />
                    </div>
                  </div>
                  {/* Content */}
                  <Card className="flex-1 border-muted/40 bg-card/70 backdrop-blur transition hover:border-primary/50 hover:shadow-lg">
                    <CardContent className="space-y-3 p-6">
                      <div className="flex items-center justify-between">
                        <Badge variant="outline" className="text-primary border-primary/40 bg-primary/10">
                          {milestone.year}
                        </Badge>
                      </div>
                      <h3 className="text-xl font-semibold">{milestone.title}</h3>
                      <p className="text-sm text-muted-foreground leading-relaxed">{milestone.summary}</p>
                    </CardContent>
                  </Card>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        <section className="rounded-3xl border border-primary/30 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-12 text-center">
          <h2 className="text-2xl font-semibold mb-4">Ready to join the fight against misinformation?</h2>
          <p className="text-muted-foreground max-w-2xl mx-auto mb-6">
            Start verifying claims today with our agentic fact-checking platform. Built for teams that need
            transparency, speed, and evidence-backed conclusions.
          </p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild size="lg" className="gap-2">
              <Link to="/auth">
                Get started
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <Link to="/pricing">View pricing</Link>
            </Button>
          </div>
        </section>
      </div>
    </div>
  </div>
);

export default About;

