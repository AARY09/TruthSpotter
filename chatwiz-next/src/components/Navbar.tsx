import { Link, useNavigate } from "react-router-dom";
import { Shield, ArrowRight, Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";

interface NavbarProps {
  showGetStarted?: boolean;
}

export function Navbar({ showGetStarted = true }: NavbarProps) {
  const navigate = useNavigate();

  const navLinks = (
    <>
      <Link to="/about" className="hover:text-foreground transition-colors">
        About
      </Link>
      <Link to="/news" className="hover:text-foreground transition-colors">
        News
      </Link>
      <Link to="/pricing" className="hover:text-foreground transition-colors">
        Pricing
      </Link>
      <Link to="/verify" className="hover:text-foreground transition-colors">
        Verify
      </Link>
    </>
  );

  return (
    <header className="container flex items-center justify-between py-6 border-b border-border/40">
      <Link to="/" className="flex items-center gap-2 text-lg font-semibold">
        <Shield className="h-6 w-6 text-primary" />
        Truth<span className="text-primary">Spotter</span>
      </Link>
      
      {/* Desktop Navigation */}
      <nav className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
        {navLinks}
        <ThemeToggle />
        {showGetStarted && (
          <Button size="sm" className="gap-2 shadow-[0_10px_35px_rgba(59,130,246,0.35)]" onClick={() => navigate("/auth")}>
            Get started
            <ArrowRight className="h-4 w-4" />
          </Button>
        )}
      </nav>

      {/* Mobile Navigation */}
      <div className="flex items-center gap-2 md:hidden">
        <ThemeToggle />
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Open menu">
              <Menu className="h-4 w-4" />
            </Button>
          </SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Navigation</SheetTitle>
              <SheetDescription>Navigate to different sections of TruthSpotter</SheetDescription>
            </SheetHeader>
            <nav className="flex flex-col gap-4 mt-6">
              <Link to="/about" className="text-lg hover:text-primary transition-colors">
                About
              </Link>
              <Link to="/news" className="text-lg hover:text-primary transition-colors">
                News
              </Link>
              <Link to="/pricing" className="text-lg hover:text-primary transition-colors">
                Pricing
              </Link>
              <Link to="/verify" className="text-lg hover:text-primary transition-colors">
                Verify
              </Link>
              {showGetStarted && (
                <Button className="gap-2 mt-4" onClick={() => navigate("/auth")}>
                  Get started
                  <ArrowRight className="h-4 w-4" />
                </Button>
              )}
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}

