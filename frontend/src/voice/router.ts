import type { Intent } from './schema';

export async function fetchIntent(text: string, context?: any): Promise<Intent> {
  const url = import.meta.env.VITE_INTENT_BACKEND || 'http://localhost:8000/intent';
  
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, context })
  });
  if (!res.ok) {
    const msg = await res.text();
    throw new Error(`Intent error: ${res.status} ${msg}`);
  }
  const data = await res.json();
  return data.intent as Intent;
}


