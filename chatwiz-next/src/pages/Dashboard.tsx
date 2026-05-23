import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, LineChart, Line, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { MessageSquare, CheckCircle, AlertCircle, TrendingUp, Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";

interface DashboardStats {
  totalConversations: number;
  totalMessages: number;
  verifiedCount: number;
  unverifiedCount: number;
  partiallyVerifiedCount: number;
}

interface ActivityData {
  date: string;
  conversations: number;
  messages: number;
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [stats, setStats] = useState<DashboardStats>({
    totalConversations: 0,
    totalMessages: 0,
    verifiedCount: 0,
    unverifiedCount: 0,
    partiallyVerifiedCount: 0,
  });
  const [activityData, setActivityData] = useState<ActivityData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    checkAuth();
    fetchDashboardData();
  }, []);

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      navigate("/auth");
    }
  };

  const fetchDashboardData = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Fetch conversations
      const { data: conversations, error: convError } = await supabase
        .from("conversations")
        .select("id, created_at")
        .eq("user_id", user.id);

      if (convError) throw convError;

      // Fetch messages
      const { data: messages, error: msgError } = await supabase
        .from("messages")
        .select("id, conversation_id, verification_status, created_at")
        .in("conversation_id", conversations?.map(c => c.id) || []);

      if (msgError) throw msgError;

      // Calculate stats
      const verifiedCount =
        messages?.filter((m) =>
          ["verified", "true"].includes(m.verification_status ?? "")
        ).length || 0;
      const unverifiedCount =
        messages?.filter((m) =>
          ["refuted", "false", "unverified"].includes(m.verification_status ?? "")
        ).length || 0;
      const partiallyVerifiedCount =
        messages?.filter((m) => m.verification_status === "partially_verified").length || 0;

      setStats({
        totalConversations: conversations?.length || 0,
        totalMessages: messages?.length || 0,
        verifiedCount,
        unverifiedCount,
        partiallyVerifiedCount,
      });

      // Process activity data (last 7 days)
      const last7Days = Array.from({ length: 7 }, (_, i) => {
        const date = new Date();
        date.setDate(date.getDate() - (6 - i));
        return date.toISOString().split('T')[0];
      });

      const activity = last7Days.map(date => {
        const dayConversations = conversations?.filter(c => 
          c.created_at.startsWith(date)
        ).length || 0;
        
        const dayMessages = messages?.filter(m => 
          m.created_at.startsWith(date)
        ).length || 0;

        return {
          date: new Date(date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
          conversations: dayConversations,
          messages: dayMessages,
        };
      });

      setActivityData(activity);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    } finally {
      setLoading(false);
    }
  };

  const verificationData = [
    { name: "Verified", value: stats.verifiedCount, color: "hsl(var(--chart-1))" },
    { name: "Unverified", value: stats.unverifiedCount, color: "hsl(var(--chart-2))" },
    { name: "Partially Verified", value: stats.partiallyVerifiedCount, color: "hsl(var(--chart-3))" },
  ];

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Button variant="ghost" onClick={() => navigate("/")}>
              ← Back to Chat
            </Button>
            <h1 className="text-2xl font-bold">Analytics Dashboard</h1>
          </div>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Button
              variant="outline"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/auth");
              }}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4 mb-8">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Conversations</CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalConversations}</div>
              <p className="text-xs text-muted-foreground">All time</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Total Messages</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalMessages}</div>
              <p className="text-xs text-muted-foreground">All time</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Verified Claims</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.verifiedCount}</div>
              <p className="text-xs text-muted-foreground">Successfully verified</p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-sm font-medium">Unverified Claims</CardTitle>
              <AlertCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.unverifiedCount}</div>
              <p className="text-xs text-muted-foreground">Flagged as false</p>
            </CardContent>
          </Card>
        </div>

        <Tabs defaultValue="activity" className="space-y-6">
          <TabsList>
            <TabsTrigger value="activity">Activity Overview</TabsTrigger>
            <TabsTrigger value="verification">Verification Stats</TabsTrigger>
          </TabsList>

          <TabsContent value="activity" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Activity Over Time</CardTitle>
                <CardDescription>Last 7 days of conversations and messages</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={activityData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Legend />
                    <Line type="monotone" dataKey="conversations" stroke="hsl(var(--chart-1))" strokeWidth={2} />
                    <Line type="monotone" dataKey="messages" stroke="hsl(var(--chart-2))" strokeWidth={2} />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Daily Activity Breakdown</CardTitle>
                <CardDescription>Comparison of conversations vs messages</CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={activityData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="date" className="text-xs" />
                    <YAxis className="text-xs" />
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                    <Legend />
                    <Bar dataKey="conversations" fill="hsl(var(--chart-1))" />
                    <Bar dataKey="messages" fill="hsl(var(--chart-2))" />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="verification" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Verification Status Distribution</CardTitle>
                <CardDescription>Breakdown of claim verification results</CardDescription>
              </CardHeader>
              <CardContent className="flex justify-center">
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={verificationData}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(0)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      {verificationData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip 
                      contentStyle={{ 
                        backgroundColor: 'hsl(var(--card))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '6px'
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <div className="grid gap-4 md:grid-cols-3">
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-green-600 dark:text-green-400">
                    Verified
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.verifiedCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.totalMessages > 0 
                      ? `${((stats.verifiedCount / stats.totalMessages) * 100).toFixed(1)}% of total`
                      : '0% of total'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-red-600 dark:text-red-400">
                    Unverified
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.unverifiedCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.totalMessages > 0 
                      ? `${((stats.unverifiedCount / stats.totalMessages) * 100).toFixed(1)}% of total`
                      : '0% of total'}
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                    Partially Verified
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="text-3xl font-bold">{stats.partiallyVerifiedCount}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {stats.totalMessages > 0 
                      ? `${((stats.partiallyVerifiedCount / stats.totalMessages) * 100).toFixed(1)}% of total`
                      : '0% of total'}
                  </p>
                </CardContent>
              </Card>
            </div>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}
