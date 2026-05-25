/** Backend API base URL (no trailing slash) */
export const API_URL = (
  import.meta.env.DEV
    ? import.meta.env.VITE_API_URL ?? 'http://localhost:3000'
    : import.meta.env.NEXT_PUBLIC_API_URL ??
      import.meta.env.VITE_API_URL ??
      'https://truthspotter-0q6g.onrender.com'
).replace(/\/$/, '');
