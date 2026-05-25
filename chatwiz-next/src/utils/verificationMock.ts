import { VerificationStatus } from "@/components/VerificationSidebar";
import { API_URL } from "@/lib/api";

export interface VerificationResponse {
  status: VerificationStatus;
  confidence: number;
  summary: string;
  sources: Array<{
    title: string;
    source: string;
    description: string;
    reliability: number;
    url?: string;
  }>;
}

// Calls the actual Render backend API instead of returning mock data
export const verifyClaim = async (
  claim: string
): Promise<{
  status: "true" | "false" | "unverified";
  confidence: number;
  summary: string;
  sources: {
    title: string;
    source: string;
    description: string;
    reliability: number;
    url?: string;
  }[];
}> => {
  try {
    const response = await fetch(`${API_URL}/verify-claim-agentic`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claim }),
    });

    if (!response.ok) {
      throw new Error(`API request failed with status ${response.status}`);
    }

    const json = await response.json();
    const verification = json?.data?.verification;

    if (!verification) {
      throw new Error("Invalid API response structure");
    }

    // Map backend response to frontend structure
    return {
      status: verification.isVerified ? "true" : "false",
      confidence: verification.confidence ?? 0,
      summary:
        verification.factCheckSummary ||
        verification.analysis ||
        "No summary available.",
      sources: (verification.evidence || []).map((e: any) => ({
        title: e.title || "Untitled Source",
        source: e.source || "Unknown Source",
        description: e.snippet || "No description available.",
        reliability: e.reliability || 80,
        url: e.link || e.url || "",
      })),
    };
  } catch (error) {
    console.error("Error verifying claim:", error);
    return {
      status: "unverified",
      confidence: 50,
      summary:
        "Unable to verify the claim at this time. Please try again later.",
      sources: [
        {
          title: "Verification Unavailable",
          source: "TruthSpotter API",
          description:
            "The verification API failed to respond or returned invalid data.",
          reliability: 0,
        },
      ],
    };
  }
};
