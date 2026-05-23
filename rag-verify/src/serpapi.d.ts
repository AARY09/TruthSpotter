declare module 'serpapi' {
  export interface SerpApiParams {
    engine?: string;
    q?: string;
    hl?: string;
    gl?: string;
    num?: number;
    api_key?: string;
    [key: string]: any;
  }

  export interface NewsResult {
    title: string;
    snippet: string;
    link: string;
    date?: string;
    source?: string;
  }

  export interface SerpApiResponse {
    news_results?: NewsResult[];
    [key: string]: any;
  }

  export function getJson(params: SerpApiParams): Promise<SerpApiResponse>;
}

