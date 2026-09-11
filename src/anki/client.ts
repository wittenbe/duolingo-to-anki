interface AnkiResponse<T> {
  result: T;
  error: string | null;
}

export interface AnkiClient {
  request<T>(action: string, params?: object): Promise<T>;
  ensureDeck(name: string): Promise<void>;
}

export function createAnkiClient(url: string): AnkiClient {
  async function request<T>(action: string, params: object = {}): Promise<T> {
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ action, version: 6, params }),
    });
    const { result, error } = (await res.json()) as AnkiResponse<T>;
    if (error) throw new Error(`AnkiConnect error (${action}): ${error}`);
    return result;
  }

  async function ensureDeck(name: string): Promise<void> {
    const decks = await request<string[]>("deckNames");
    if (!decks.includes(name)) {
      await request("createDeck", { deck: name });
      console.log(`Created deck: "${name}"`);
    }
  }

  return { request, ensureDeck };
}
