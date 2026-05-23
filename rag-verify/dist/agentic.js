"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AgenticRAGVerifier = void 0;
const google_genai_1 = require("@langchain/google-genai");
const tools_1 = require("@langchain/core/tools");
const zod_1 = require("zod");
// ==============================
// AGENTIC RAG SYSTEM WITH LANGCHAIN
// ==============================
class AgenticRAGVerifier {
    constructor(detector, onUpdate) {
        this.detector = detector;
        this.onUpdate = onUpdate;
        this.llm = new google_genai_1.ChatGoogleGenerativeAI({
            apiKey: process.env.GEMINI_API_KEY,
            modelName: 'gemini-2.0-flash',
            temperature: 0.3,
            maxOutputTokens: 2000,
        });
        this.toolContext = {
            searchQueries: [],
            newsArticles: [],
            kbDocs: [],
        };
    }
    step(message) {
        console.log(message);
        this.onUpdate?.(message);
    }
    // ==============================
    // TOOL 1: ANALYZE CLAIM
    // ==============================
    createAnalyzeClaimTool() {
        return new tools_1.DynamicStructuredTool({
            name: 'analyze_claim',
            description: 'Analyzes a claim to extract sub-claims, keywords, entities, and verification strategies',
            schema: zod_1.z.object({
                claim: zod_1.z.string().describe('The claim text to analyze'),
            }),
            func: async ({ claim }) => {
                try {
                    this.step(`🔧 Tool: Analyzing claim structure...`);
                    const analysis = await this.detector.analyzeClaim(claim);
                    return JSON.stringify({
                        success: true,
                        extractedClaims: analysis.extractedClaims,
                        keywords: analysis.keywords,
                        message: `Extracted ${analysis.extractedClaims.length} sub-claims & ${analysis.keywords.length} keywords`,
                    }, null, 2);
                }
                catch (error) {
                    return JSON.stringify({
                        success: false,
                        keywords: claim.split(' ').slice(0, 5),
                        message: 'Partial analysis fallback executed',
                    }, null, 2);
                }
            },
        });
    }
    // ==============================
    // TOOL 2: GENERATE SEARCH QUERIES
    // ==============================
    createGenerateQueriesTool() {
        return new tools_1.DynamicStructuredTool({
            name: 'generate_search_queries',
            description: 'Generates diverse search queries to verify a claim based on analysis',
            schema: zod_1.z.object({
                claimAnalysis: zod_1.z.string().describe('The claim analysis output to base queries on'),
            }),
            func: async ({ claimAnalysis }) => {
                try {
                    this.step(`🔧 Tool: Generating search queries...`);
                    const prompt = `From the following claim analysis, generate exactly 3 diverse search queries:

${claimAnalysis}

Rules:
- One query should be very specific (include dates/locations if present)
- One query should be broader and contextual
- One query should explicitly include "fact check" or "hoax"
- Return ONLY the 3 queries, one per line, no bullets or extra text`;
                    const result = await this.llm.invoke(prompt);
                    const queries = result.content
                        .split('\n')
                        .map(q => q.trim())
                        .filter(Boolean)
                        .slice(0, 3);
                    // Store in context
                    this.toolContext.searchQueries = queries;
                    this.step(`📌 Generated queries: ${queries.join(' | ')}`);
                    return JSON.stringify({
                        success: true,
                        queries,
                        message: `Generated ${queries.length} search queries`,
                    }, null, 2);
                }
                catch (error) {
                    return JSON.stringify({
                        success: false,
                        queries: [],
                        message: 'Failed to generate queries',
                    }, null, 2);
                }
            },
        });
    }
    // ==============================
    // TOOL 3: FETCH NEWS ARTICLES
    // ==============================
    createFetchNewsTool() {
        return new tools_1.DynamicStructuredTool({
            name: 'fetch_news_articles',
            description: 'Fetches and stores news articles from Google News for given search queries',
            schema: zod_1.z.object({
                queries: zod_1.z.array(zod_1.z.string()).describe('Array of search queries to fetch news for'),
            }),
            func: async ({ queries }) => {
                try {
                    this.step(`🔧 Tool: Fetching news articles for ${queries.length} queries...`);
                    const allArticles = [];
                    for (const query of queries) {
                        this.step(`📰 Searching: "${query}"`);
                        const articles = await this.detector.fetchGoogleNewsSearch(query);
                        if (articles.length > 0) {
                            allArticles.push(...articles.slice(0, 5));
                            try {
                                await this.detector.storeNewsArticles(articles);
                                this.step(`💾 Stored ${articles.length} articles for "${query}"`);
                            }
                            catch (e) {
                                this.step(`⚠️ Failed to store articles: ${e?.message}`);
                            }
                        }
                        await new Promise(res => setTimeout(res, 800));
                    }
                    // Store in context
                    this.toolContext.newsArticles = allArticles;
                    return JSON.stringify({
                        success: true,
                        articleCount: allArticles.length,
                        message: `Fetched ${allArticles.length} total articles`,
                    }, null, 2);
                }
                catch (error) {
                    return JSON.stringify({
                        success: false,
                        articleCount: 0,
                        articles: [],
                        message: 'Failed to fetch news articles',
                    }, null, 2);
                }
            },
        });
    }
    // ==============================
    // TOOL 4: RETRIEVE EVIDENCE FROM VECTOR DB
    // ==============================
    createRetrieveEvidenceTool() {
        return new tools_1.DynamicStructuredTool({
            name: 'retrieve_evidence',
            description: 'Retrieves relevant evidence from the vector database using similarity search',
            schema: zod_1.z.object({
                claim: zod_1.z.string().describe('The claim to find relevant evidence for'),
                limit: zod_1.z.number().optional().describe('Maximum number of documents to retrieve'),
            }),
            func: async ({ claim, limit = 15 }) => {
                try {
                    this.step(`🔧 Tool: Retrieving evidence from vector store...`);
                    const docs = await this.detector.findRelevantEvidence(claim, limit);
                    const snippets = docs.slice(0, 6).map((doc, idx) => ({
                        index: idx + 1,
                        source: doc.metadata?.source || doc.metadata?.link || 'unknown',
                        date: doc.metadata?.date || 'unknown date',
                        snippet: (doc.pageContent || '').slice(0, 260).replace(/\s+/g, ' '),
                    }));
                    // Store in context
                    this.toolContext.kbDocs = docs;
                    this.step(`📚 Retrieved ${docs.length} relevant documents`);
                    return JSON.stringify({
                        success: true,
                        documentCount: docs.length,
                        snippets,
                        message: `Retrieved ${docs.length} relevant documents`,
                    }, null, 2);
                }
                catch (error) {
                    return JSON.stringify({
                        success: false,
                        documentCount: 0,
                        snippets: [],
                        message: 'Failed to retrieve evidence',
                    }, null, 2);
                }
            },
        });
    }
    // ==============================
    // TOOL 5: FACT CHECK WITH EVIDENCE
    // ==============================
    createFactCheckTool() {
        return new tools_1.DynamicStructuredTool({
            name: 'fact_check',
            description: 'Performs fact-checking on a claim using provided evidence and returns a verdict',
            schema: zod_1.z.object({
                claim: zod_1.z.string().describe('The claim to fact-check'),
                evidenceSnippets: zod_1.z.string().describe('JSON string of evidence snippets'),
            }),
            func: async ({ claim, evidenceSnippets }) => {
                try {
                    this.step(`🔧 Tool: Fact-checking claim...`);
                    const snippets = JSON.parse(evidenceSnippets);
                    const snippetText = snippets.map((s) => `[#${s.index}] Source: ${s.source} (${s.date})\n${s.snippet}...`).join('\n\n');
                    const prompt = `You are a professional fact-checker.

TASK: Decide whether the claim is SUPPORTED, REFUTED, or INCONCLUSIVE based on the evidence.

Claim: ${claim}

Evidence Snippets:
${snippetText}

INSTRUCTIONS:
- Carefully weigh all evidence
- Use majority evidence and more recent evidence when there is conflict
- VERDICT rules:
  • If most strong, recent sources clearly support → VERDICT: SUPPORTED
  • If strong evidence clearly contradicts → VERDICT: REFUTED
  • If evidence is mixed/weak/not directly about claim → VERDICT: INCONCLUSIVE

Return in this exact format:

VERDICT: SUPPORTED | REFUTED | INCONCLUSIVE
REASONING: <2–4 sentences explaining why, referencing snippet indices like [#1], [#2]>`;
                    const result = await this.llm.invoke(prompt);
                    const output = result.content;
                    return JSON.stringify({
                        success: true,
                        verdict: output,
                        message: 'Fact-checking completed',
                    }, null, 2);
                }
                catch (error) {
                    return JSON.stringify({
                        success: false,
                        verdict: 'VERDICT: INCONCLUSIVE\nREASONING: Unable to complete fact-check due to error.',
                        message: 'Fact-check fallback executed',
                    }, null, 2);
                }
            },
        });
    }
    // ==============================
    // TOOL CALLING WITH LLM
    // ==============================
    async invokeLLMWithTools(systemPrompt, userMessage, tools, maxIterations = 5) {
        let messages = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userMessage },
        ];
        let iterationCount = 0;
        let finalResponse = '';
        while (iterationCount < maxIterations) {
            iterationCount++;
            // Format tools for the LLM
            const toolDescriptions = tools.map(t => `Tool: ${t.name}\nDescription: ${t.description}\nParameters: ${JSON.stringify(t.schema.shape)}`).join('\n\n');
            const promptWithTools = `${messages.map(m => `${m.role}: ${m.content}`).join('\n\n')}

Available Tools:
${toolDescriptions}

You can use tools by responding with:
TOOL_CALL: tool_name
PARAMETERS: {"param": "value"}

Or provide a final answer by responding with:
FINAL_ANSWER: your response here`;
            const response = await this.llm.invoke(promptWithTools);
            const content = response.content;
            // Check if LLM wants to use a tool
            if (content.includes('TOOL_CALL:')) {
                const toolMatch = content.match(/TOOL_CALL:\s*(\w+)/);
                const paramsMatch = content.match(/PARAMETERS:\s*(\{[\s\S]*?\})/);
                if (toolMatch) {
                    const toolName = toolMatch[1];
                    const tool = tools.find(t => t.name === toolName);
                    if (tool && paramsMatch) {
                        try {
                            const params = JSON.parse(paramsMatch[1]);
                            const toolResult = await tool.func(params);
                            messages.push({ role: 'assistant', content }, { role: 'user', content: `Tool Result:\n${toolResult}` });
                            continue;
                        }
                        catch (error) {
                            messages.push({ role: 'assistant', content }, { role: 'user', content: `Tool Error: ${error}` });
                            continue;
                        }
                    }
                }
            }
            // Check for final answer
            if (content.includes('FINAL_ANSWER:')) {
                const answerMatch = content.match(/FINAL_ANSWER:\s*([\s\S]*)/);
                if (answerMatch) {
                    finalResponse = answerMatch[1].trim();
                    break;
                }
            }
            // If no tool call or final answer, treat as final response
            finalResponse = content;
            break;
        }
        return finalResponse;
    }
    // ==============================
    // AGENT 1: CLAIM ANALYST
    // ==============================
    async runClaimAnalystAgent(claim) {
        this.step(`🔍 Stage 1 — Claim Analyst Agent starting...`);
        const tools = [this.createAnalyzeClaimTool()];
        const systemPrompt = `You are a Claim Analyst Agent. Your goal is to prepare claims for fact-checking.

Use the analyze_claim tool to extract sub-claims and keywords, then provide:
- Main claim and sub-claims
- Key entities, locations, dates, and numbers to verify
- Whether the claim is vague or specific
- 3–5 high-level search strategies to verify this claim

Keep it structured and concise.`;
        try {
            const result = await this.invokeLLMWithTools(systemPrompt, `Analyze this claim: "${claim}"`, tools, 3);
            this.step(`✅ Claim Analyst completed`);
            return result;
        }
        catch (error) {
            this.step(`⚠️ Claim Analyst fallback`);
            return `Fallback claim analysis for: "${claim}". Key terms: ${claim.split(' ').slice(0, 8).join(', ')}`;
        }
    }
    // ==============================
    // AGENT 2: EVIDENCE RESEARCHER
    // ==============================
    async runEvidenceResearcherAgent(claim, analystOutput) {
        this.step(`📚 Stage 2 — Evidence Researcher Agent starting...`);
        const tools = [
            this.createGenerateQueriesTool(),
            this.createFetchNewsTool(),
            this.createRetrieveEvidenceTool(),
        ];
        const systemPrompt = `You are an Evidence Researcher Agent. Your goal is to find relevant evidence.

Process:
1. Use generate_search_queries with the claim analysis to create 3 diverse queries
2. Use fetch_news_articles with those queries to get fresh news
3. Use retrieve_evidence with the original claim to get relevant documents from the knowledge base

Provide a summary of what you found.`;
        try {
            await this.invokeLLMWithTools(systemPrompt, `Research evidence for this claim: "${claim}"\n\nClaim Analysis:\n${analystOutput}`, tools, 6);
            const summary = `Evidence summary:
- Search Queries: ${this.toolContext.searchQueries.join(', ') || 'None'}
- News Articles fetched: ${this.toolContext.newsArticles.length}
- KB Docs (vector hits): ${this.toolContext.kbDocs.length}`;
            this.step(`📚 Evidence Researcher completed (Articles: ${this.toolContext.newsArticles.length}, KB docs: ${this.toolContext.kbDocs.length})`);
            return {
                searchQueries: this.toolContext.searchQueries,
                newsArticles: this.toolContext.newsArticles,
                kbDocs: this.toolContext.kbDocs,
                summary,
            };
        }
        catch (error) {
            this.step(`⚠️ Evidence Researcher fallback`);
            return {
                searchQueries: [],
                newsArticles: [],
                kbDocs: [],
                summary: `Evidence fallback summary for claim: "${claim}"`,
            };
        }
    }
    // ==============================
    // AGENT 3: FACT CHECKER
    // ==============================
    async runFactCheckerAgent(claim, analystOutput, evidence) {
        this.step(`⚖️ Stage 3 — Fact Checker Agent starting...`);
        const tools = [this.createFactCheckTool()];
        const systemPrompt = `You are a Fact Checker Agent. Your goal is to determine the truth of claims.

Use the fact_check tool with the claim and evidence snippets to get a professional verdict.
The tool will return SUPPORTED, REFUTED, or INCONCLUSIVE with reasoning.`;
        const evidenceSnippets = evidence.kbDocs.slice(0, 6).map((doc, idx) => ({
            index: idx + 1,
            source: doc.metadata?.source || doc.metadata?.link || 'unknown',
            date: doc.metadata?.date || 'unknown date',
            snippet: (doc.pageContent || '').slice(0, 260).replace(/\s+/g, ' '),
        }));
        try {
            const result = await this.invokeLLMWithTools(systemPrompt, `Fact-check this claim: "${claim}"\n\nPass the evidence snippets to the fact_check tool.`, tools, 3);
            this.step(`✅ Fact Checker completed`);
            return result;
        }
        catch (error) {
            this.step(`⚠️ Fact Checker fallback`);
            return `VERDICT: INCONCLUSIVE\nREASONING: Fact-checker fallback: unable to fully verify.`;
        }
    }
    // ==============================
    // SYNTHESIS
    // ==============================
    async synthesizeResults(claim, analystOutput, evidence, factCheckerOutput) {
        this.step(`🎯 Stage 4 — Synthesizing results...`);
        const topNewsLines = evidence.newsArticles.slice(0, 5).map(a => `- "${a.title}" (Source: ${a.source ?? 'Unknown'}, Date: ${a.date})`);
        const synthesisPrompt = `You are a Synthesis Expert. Combine all agent outputs into a final verdict.

Claim: "${claim}"

=== CLAIM ANALYST OUTPUT ===
${analystOutput}

=== EVIDENCE RESEARCHER OUTPUT ===
${evidence.summary}

Top News Headlines:
${topNewsLines.join('\n') || 'None'}

=== FACT CHECKER OUTPUT ===
${factCheckerOutput}

The Fact Checker includes a VERDICT line. Interpret it as:
- VERDICT: SUPPORTED → claim is factually supported
- VERDICT: REFUTED → claim is factually false
- VERDICT: INCONCLUSIVE → evidence is not strong/clear enough

Return ONLY valid JSON:

{
  "isVerified": boolean,
  "confidence": number,
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "analysis": "2-3 sentence technical analysis",
  "factCheckSummary": "2-3 sentence user-friendly explanation",
  "keyFindings": ["finding 1", "finding 2", "finding 3"]
}

Mapping:
- SUPPORTED: isVerified=true, confidence=70-95
- REFUTED: isVerified=false, confidence=70-95
- INCONCLUSIVE: isVerified=false, confidence=60 or lower`;
        try {
            const model = this.detector.genAI.getGenerativeModel({
                model: 'gemini-2.0-flash',
                generationConfig: { maxOutputTokens: 800, temperature: 0.15 },
            });
            const result = await model.generateContent(synthesisPrompt);
            const rawText = result.response.text();
            const parsed = this.detector.extractJsonFromResponse(rawText);
            this.step(`🎯 Synthesis completed`);
            const mappedEvidence = this.mapEvidence(evidence.kbDocs);
            return {
                isVerified: Boolean(parsed.isVerified),
                confidence: Number(parsed.confidence ?? 50),
                riskLevel: parsed.riskLevel ?? 'MEDIUM',
                factCheckSummary: parsed.factCheckSummary || 'No clear conclusion available.',
                analysis: parsed.analysis || 'Analysis from combined agent outputs.',
                evidence: mappedEvidence,
                agentInsights: {
                    claimAnalyst: analystOutput,
                    evidenceResearcher: evidence.summary,
                    factChecker: factCheckerOutput,
                    synthesizer: JSON.stringify(parsed.keyFindings ?? [], null, 2),
                },
                searchQueries: evidence.searchQueries,
                evidenceSources: evidence.kbDocs.length,
            };
        }
        catch (error) {
            this.step(`⚠️ Synthesis fallback`);
            return {
                isVerified: false,
                confidence: 50,
                riskLevel: 'MEDIUM',
                factCheckSummary: 'Evidence is inconclusive. Treat as unverified.',
                analysis: 'Fallback synthesis executed.',
                evidence: this.mapEvidence(evidence.kbDocs),
                agentInsights: {
                    claimAnalyst: analystOutput,
                    evidenceResearcher: evidence.summary,
                    factChecker: factCheckerOutput,
                    synthesizer: 'Fallback synthesizer used.',
                },
                searchQueries: evidence.searchQueries,
                evidenceSources: evidence.kbDocs.length,
            };
        }
    }
    // ==============================
    // HELPERS
    // ==============================
    safeField(v) {
        if (typeof v === 'string')
            return v;
        if (!v)
            return 'Unknown';
        if (typeof v === 'object') {
            try {
                return JSON.stringify(v).slice(0, 120);
            }
            catch {
                return '[object]';
            }
        }
        return String(v);
    }
    mapEvidence(docs) {
        return docs.slice(0, 8).map(doc => ({
            title: this.safeField(doc.metadata?.title ?? doc.metadata?.source ?? 'Untitled'),
            snippet: this.safeField(doc.pageContent).slice(0, 200) + '...',
            link: doc.metadata?.link ?? undefined,
            date: this.safeField(doc.metadata?.date),
            source: this.safeField(doc.metadata?.source ?? 'Unknown'),
        }));
    }
    // ==============================
    // MAIN ENTRYPOINT
    // ==============================
    async verifyClaimAgentic(claim) {
        this.step(`🤖 Starting Agentic Verification with LangChain Tools`);
        this.step(`📌 Claim: "${claim}"`);
        // Reset context
        this.toolContext = {
            searchQueries: [],
            newsArticles: [],
            kbDocs: [],
        };
        // 1) Claim Analyst Agent
        const analystOutput = await this.runClaimAnalystAgent(claim);
        // 2) Evidence Researcher Agent
        const evidenceContext = await this.runEvidenceResearcherAgent(claim, analystOutput);
        // 3) Fact Checker Agent
        const factCheckerOutput = await this.runFactCheckerAgent(claim, analystOutput, evidenceContext);
        // 4) Synthesis
        const final = await this.synthesizeResults(claim, analystOutput, evidenceContext, factCheckerOutput);
        this.step(`🏁 Verification complete`);
        return final;
    }
}
exports.AgenticRAGVerifier = AgenticRAGVerifier;
//# sourceMappingURL=agentic.js.map