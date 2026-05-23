import { Link } from "react-router-dom";
import { ArrowRight, CheckCircle } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Navbar } from "@/components/Navbar";

const plans = [
  {
    name: "Basic",
    price: "Free",
    description: "Ideal for analysts validating individual claims with the live dashboard.",
    perks: [
      "50 verifications per month",
      "1 concurrent agent run",
      "Streaming status + archives",
      "Email verdict summaries",
    ],
    cta: "Start free",
    variant: "outline" as const,
  },
  {
    name: "Pro",
    price: "$79",
    description: "For newsrooms & civic teams needing automated rumor sweeps and alerting.",
    perks: [
      "Unlimited verifications",
      "Daily rumor watcher ingestion",
      "Workspace analytics + exports",
      "SSO & audit logging",
    ],
    cta: "Upgrade now",
    highlighted: true,
    variant: "default" as const,
  },
];

const Pricing = () => (
  <div className="min-h-screen bg-background text-foreground">
    <Navbar showGetStarted={false} />
    <div className="container py-16 space-y-12">
      <div className="text-center space-y-4">
        <Badge variant="outline" className="uppercase tracking-[0.3em] text-xs">
          Pricing
        </Badge>
        <h1 className="text-4xl font-semibold">Choose a plan that scales with your verification ops</h1>
        <p className="mx-auto max-w-2xl text-muted-foreground">
          Built with the same TruthSpotter + Aceternity visuals as the dashboard. Switch tiers anytime—workspaces carry
          over automatically.
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-2">
        {plans.map((plan) => (
          <Card
            key={plan.name}
            className={`border-muted/50 bg-card/70 backdrop-blur transition hover:border-primary/60 ${
              plan.highlighted ? "ring-2 ring-primary shadow-[0_20px_50px_rgba(59,130,246,0.35)]" : ""
            }`}
          >
            {plan.highlighted && (
              <span className="absolute right-4 top-4 rounded-full bg-primary/20 px-3 py-1 text-xs font-semibold text-primary">
                Most popular
              </span>
            )}
            <CardHeader>
              <CardTitle className="text-2xl">{plan.name}</CardTitle>
              <CardDescription>{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div>
                <span className="text-4xl font-semibold">{plan.price}</span>
                <span className="text-sm text-muted-foreground">{plan.price !== "Free" && "/seat/mo"}</span>
              </div>
              <ul className="space-y-3 text-sm text-muted-foreground">
                {plan.perks.map((perk) => (
                  <li key={perk} className="flex items-start gap-2 text-left text-foreground">
                    <CheckCircle className="h-4 w-4 text-primary" />
                    {perk}
                  </li>
                ))}
              </ul>
            </CardContent>
            <CardFooter>
              <Button asChild variant={plan.variant} className="w-full gap-2">
                <Link to="/auth">
                  {plan.cta}
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardFooter>
          </Card>
        ))}
      </div>

      <div className="rounded-3xl border border-primary/30 bg-gradient-to-r from-primary/10 via-background to-primary/5 p-10 text-center">
        <p className="text-muted-foreground max-w-3xl mx-auto">
          Need enterprise deployment options, on-prem vector storage, or guaranteed SLAs?{" "}
          <Link to="/about" className="text-primary underline underline-offset-4">
            Talk with our team
          </Link>{" "}
          and we’ll tailor TruthSpotter to your crisis playbook.
        </p>
      </div>
    </div>
  </div>
);

export default Pricing;

