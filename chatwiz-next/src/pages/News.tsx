import { useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Shield } from "lucide-react";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";
const DEFAULT_IMAGE =
  "https://images.unsplash.com/photo-1507679799987-c73779587ccf?w=1200&q=80&auto=format&fit=crop";

type NewsItem = {
  id: string;
  title: string;
  source: string;
  time: string;
  category: string;
  isMisinformation: boolean;
  image: string;
  summary: string;
};

// Trending misinformation (carousel) — keep 3 scrollable rumor items
const trendingRumors = [
  {
    id: "r1",
    claim: "Celebrity X faked a rescue to gain followers",
    source: "Social",
    category: "Politics",
    image: "https://images.unsplash.com/photo-1524504388940-b1c1722653e1?w=1200&q=80&auto=format&fit=crop",
  },
  {
    id: "r2",
    claim: "New study shows coffee causes longevity",
    source: "Viral Post",
    category: "Health",
    image: "https://images.unsplash.com/photo-1503341455253-b2e723bb3dbb?w=1200&q=80&auto=format&fit=crop",
  },
  {
    id: "r3",
    claim: "Major bank collapsing tomorrow (rumor)",
    source: "Screenshot",
    category: "Business",
    image: "https://images.unsplash.com/photo-1508873535684-277a3cbcc12b?w=1200&q=80&auto=format&fit=crop",
  },
];

// Fallback when API is unavailable
const fallbackNewsList: NewsItem[] = [
  {
    id: "1",
    title: "What happens if you walk 10,000 steps daily for a month?",
    source: "India Today",
    time: "6d",
    category: "Health",
    isMisinformation: true,
    image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=1200&q=80&auto=format&fit=crop",
    summary: "A deep dive into the health effects and myths around step targets.",
  },
  {
    id: "9",
    title: "Major bank collapsing tomorrow (rumor)",
    source: "Viral Post",
    time: "3h",
    category: "Business",
    isMisinformation: true,
    image: "https://images.unsplash.com/photo-1529070538774-1843cb3265df?w=1200&q=80&auto=format&fit=crop",
    summary: "A viral post claims a major bank will collapse tomorrow — here's what to know.",
  },
  {
    id: "2",
    title: "3 Apple settings every iPhone user should disable for longer battery",
    source: "Live Mint",
    time: "3w",
    category: "Tech",
    isMisinformation: false,
    image: "https://images.unsplash.com/photo-1511707171634-5f897ff02aa9?w=800&q=60&auto=format&fit=crop",
    summary: "Small tweaks that can actually add hours to daily battery life.",
  },
  {
    id: "3",
    title: "SIR battle in Bengal: EC warns TMC against threatening BLOs; rebuts claims...",
    source: "The Times of India",
    time: "2h",
    category: "Politics",
    isMisinformation: true,
    image: "https://images.unsplash.com/photo-1529101091764-c3526daf38fe?w=800&q=60&auto=format&fit=crop",
    summary: "Election-related tensions rise as new notices are issued.",
  },
  {
    id: "4",
    title: "Keep your passwords secure with Microsoft Edge",
    source: "Microsoft Edge",
    time: "1w",
    category: "Tech",
    isMisinformation: false,
    image: "https://images.unsplash.com/photo-1542744173-8e7e53415bb0?w=800&q=60&auto=format&fit=crop",
    summary: "Built-in password manager features that help protect your accounts.",
  },
  {
    id: "5",
    title: "Local team wins regional sports championship",
    source: "Sports Daily",
    time: "1d",
    category: "Sports",
    isMisinformation: false,
    image: "https://images.unsplash.com/photo-1517649763962-0c623066013b?w=800&q=60&auto=format&fit=crop",
    summary: "A thrilling final sees the underdogs lift the trophy after penalties.",
  },
  {
    id: "6",
    title: "New study links screen time to sleep changes in teens",
    source: "Health News",
    time: "4d",
    category: "Health",
    isMisinformation: true,
    image: "https://images.unsplash.com/photo-1517511620798-cec17d428bc0?w=800&q=60&auto=format&fit=crop",
    summary: "Researchers discuss correlations between device use and sleep quality.",
  },
  {
    id: "7",
    title: "Tech startup raises series B to expand globally",
    source: "Business Today",
    time: "2w",
    category: "Business",
    isMisinformation: false,
    image: "https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=800&q=60&auto=format&fit=crop",
    summary: "Funding will help scale operations across Asia and Europe.",
  },
  {
    id: "8",
    title: "Community geography project maps local biodiversity",
    source: "Geo Weekly",
    time: "6d",
    category: "Geography",
    isMisinformation: false,
    image: "https://images.unsplash.com/photo-1501785888041-af3ef285b470?w=800&q=60&auto=format&fit=crop",
    summary: "Volunteers catalog species and create an open-access map.",
  },
];

const News = () => {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("All");
  const [slide, setSlide] = useState(0);
  const [autoPlay, setAutoPlay] = useState(true);
  const [newsList, setNewsList] = useState<NewsItem[]>(fallbackNewsList);
  const [newsLoading, setNewsLoading] = useState(false);
  const [newsError, setNewsError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    const q = search.trim() || "latest news";

    const load = async () => {
      setNewsLoading(true);
      setNewsError(null);
      try {
        const res = await fetch(
          `${API_URL}/news?q=${encodeURIComponent(q)}&limit=20`,
          { signal: controller.signal }
        );
        const json = await res.json();
        if (!res.ok || !json.success || !Array.isArray(json.data) || json.data.length === 0) {
          setNewsList(fallbackNewsList);
          if (!res.ok) setNewsError("Could not load live news — showing sample stories.");
          return;
        }

        const mapped: NewsItem[] = json.data.map((a: Record<string, string>, idx: number) => ({
          id: String(idx + 1),
          title: a.title || a.snippet || "Untitled",
          source: a.source || "News",
          time: a.date ? new Date(a.date).toLocaleDateString() : "",
          category: "General",
          isMisinformation: false,
          image: DEFAULT_IMAGE,
          summary: a.snippet || a.title || "",
        }));
        setNewsList(mapped);
      } catch (err) {
        if ((err as Error).name === "AbortError") return;
        setNewsList(fallbackNewsList);
        setNewsError("Could not load live news — showing sample stories.");
      } finally {
        if (!controller.signal.aborted) setNewsLoading(false);
      }
    };

    const timer = setTimeout(load, 400);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [search]);

  useEffect(() => {
    if (!autoPlay) return;
    const id = setInterval(() => setSlide((s) => (s + 1) % trendingRumors.length), 4500);
    return () => clearInterval(id);
  }, [autoPlay]);

  const categories = useMemo(
    () => [
      "All",
      ...Array.from(new Set(newsList.map((n) => n.category).filter(Boolean))),
    ],
    [newsList]
  );

  const openAndVerify = (claim: string) => {
    // navigate to the chatbot (verify) page and pass the claim in the URL and location state
    navigate(`/verify?claim=${encodeURIComponent(claim)}`, { state: { claim } });
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="flex items-center gap-3 mb-6">
        <Shield className="h-8 w-8 text-primary" />
        <h1 className="text-2xl font-bold">TruthSpotter — News</h1>
        <div className="ml-auto flex gap-2">
          <Button variant="ghost" onClick={() => navigate('/verify')}>Go to Chat</Button>
          <Button variant="ghost" onClick={() => navigate('/dashboard')}>Dashboard</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left: search + category filter */}
        <aside className="col-span-3">
          <div className="bg-card p-4 rounded-lg shadow-sm mb-4">
            <label className="block text-sm font-medium mb-2">Search claims</label>
            <input
              aria-label="Search claims"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search titles, summaries, sources"
              className="w-full border rounded px-3 py-2 bg-transparent"
            />
          </div>

          <div className="bg-card p-4 rounded-lg shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold">Categories</h3>
              <button
                onClick={() => {
                  setSelectedCategory("All");
                  setSearch("");
                }}
                className="text-xs text-muted-foreground"
              >
                Reset
              </button>
            </div>
            <div className="flex flex-col gap-2">
              {categories.map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCategory(c)}
                  className={`text-left px-3 py-2 rounded ${selectedCategory === c ? 'bg-primary text-white' : 'bg-muted/30'}`}
                >
                  {c}
                </button>
              ))}
            </div>
          </div>
        </aside>

        {/* Main news area */}
        <main className="col-span-9">
          {/* Improved slideable trending carousel (3 items) */}
          <section className="mb-6">
            <div
              className="relative rounded-lg overflow-hidden shadow-lg bg-muted/10"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === "ArrowLeft") setSlide((s) => (s - 1 + trendingRumors.length) % trendingRumors.length);
                if (e.key === "ArrowRight") setSlide((s) => (s + 1) % trendingRumors.length);
              }}
            >
              {/* sliding track */}
              <div className="w-full overflow-hidden">
                <div
                  className="flex transition-transform duration-500 ease-out"
                  style={{ transform: `translateX(-${slide * 100}%)` }}
                >
                  {trendingRumors.map((t) => (
                    <div key={t.id} className="w-full flex-shrink-0 h-44 relative">
                      <img src={t.image || DEFAULT_IMAGE} alt={t.claim} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                      <div className="absolute left-6 bottom-4 text-white max-w-2xl">
                        <div className="inline-block bg-black/40 text-xs px-2 py-1 rounded">{t.source}</div>
                        <h2 className="text-lg font-semibold mt-1">{t.claim}</h2>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* controls */}
              <div className="absolute inset-x-4 top-3 flex items-center justify-between pointer-events-none">
                <div className="pointer-events-auto">
                  <button
                    onClick={() => setAutoPlay((v) => !v)}
                    className="text-white bg-black/30 px-2 py-1 rounded mr-2"
                  >
                    {autoPlay ? "Pause" : "Play"}
                  </button>
                </div>
                <div className="pointer-events-auto flex items-center gap-2">
                  <button
                    onClick={() => setSlide((s) => (s - 1 + trendingRumors.length) % trendingRumors.length)}
                    className="text-white bg-black/30 px-2 py-1 rounded"
                    aria-label="Previous"
                  >
                    ‹
                  </button>
                  <button
                    onClick={() => setSlide((s) => (s + 1) % trendingRumors.length)}
                    className="text-white bg-black/30 px-2 py-1 rounded"
                    aria-label="Next"
                  >
                    ›
                  </button>
                </div>
              </div>

              {/* indicators & thumbnails */}
              <div className="mt-2 px-4 py-3 bg-transparent flex flex-col items-center gap-2">
                <div className="flex items-center gap-2">
                  {trendingRumors.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => setSlide(i)}
                      className={`w-2 h-2 rounded-full ${i === slide ? 'bg-primary' : 'bg-muted/50'}`}
                      aria-label={`Go to slide ${i + 1}`}
                    />
                  ))}
                </div>

                <div className="flex items-center gap-2 mt-2">
                  {trendingRumors.map((t, i) => (
                    <button
                      key={t.id}
                      onClick={() => setSlide(i)}
                      className={`w-16 h-10 overflow-hidden rounded-md border ${i === slide ? 'ring-2 ring-primary' : 'border-transparent'}`}
                    >
                      <img src={t.image || DEFAULT_IMAGE} alt={t.claim} className="w-full h-full object-cover" />
                    </button>
                  ))}
                </div>
              </div>

              {/* verify CTA */}
              <div className="absolute left-6 bottom-4">
                <button
                  onClick={() => openAndVerify(trendingRumors[slide].claim)}
                  className="text-sm text-white bg-primary px-3 py-1 rounded"
                >
                  Verify
                </button>
              </div>
            </div>
          </section>

          {/* Grid of cards (filtered by search + category) */}
          <section>
            {newsError && (
              <p className="text-sm text-muted-foreground mb-3">{newsError}</p>
            )}
            {newsLoading && (
              <p className="text-sm text-muted-foreground mb-3">Loading news…</p>
            )}
            <div className="grid grid-cols-2 gap-4">
              {(() => {
                const q = search.trim().toLowerCase();
                const filtered = newsList.filter((n) => {
                  if (selectedCategory !== "All" && n.category !== selectedCategory) return false;
                  if (q === "") return true;
                  return `${n.title} ${n.summary} ${n.source}`.toLowerCase().includes(q);
                });

                if (filtered.length === 0) {
                  return (
                    <div className="col-span-2 text-center text-muted-foreground py-12">
                      No matching items found.
                    </div>
                  );
                }

                return filtered.map((n, idx) => (
                  <article
                    key={n.id ?? idx}
                    className="flex gap-4 p-4 bg-card rounded-lg shadow-sm hover:shadow cursor-pointer"
                    onClick={() => openAndVerify(n.title)}
                  >
                    <img
                      src={n.image || DEFAULT_IMAGE}
                      alt={n.title}
                      className="w-36 h-24 object-cover rounded-md flex-shrink-0"
                    />
                    <div className="flex-1">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">
                          {n.source} • {n.time}
                        </span>
                        <span className="text-xs bg-muted px-2 py-1 rounded">{n.category}</span>
                      </div>
                      <h3 className="font-medium mt-2">{n.title}</h3>
                      <p className="text-sm text-muted-foreground mt-1">{n.summary}</p>
                    </div>
                  </article>
                ));
              })()}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
};

export default News;
