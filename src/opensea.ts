interface AccountProfile {
  address?: unknown;
  username?: unknown;
  bio?: unknown;
}

export class OpenSeaClient {
  private readonly baseUrl = "https://api.opensea.io/api/v2";

  constructor(
    private readonly apiKey: string,
    _chain: string,
    _collectionSlug: string,
  ) {}

  async profileContainsCode(walletAddress: string, code: string): Promise<boolean> {
    const walletProfile = await this.getProfile(walletAddress);
    if (this.bioContains(walletProfile.bio, code)) return true;

    if (typeof walletProfile.username !== "string" || !walletProfile.username.trim()) {
      return false;
    }

    const usernameProfile = await this.getProfile(walletProfile.username);
    return this.bioContains(usernameProfile.bio, code);
  }

  private bioContains(bio: unknown, code: string): boolean {
    return typeof bio === "string" && bio.toUpperCase().includes(code.toUpperCase());
  }

  private getProfile(identifier: string): Promise<AccountProfile> {
    return this.getJson<AccountProfile>("/accounts/" + encodeURIComponent(identifier));
  }

  private async getJson<T>(path: string): Promise<T> {
    const response = await fetch(this.baseUrl + path, {
      headers: {
        accept: "application/json",
        "cache-control": "no-cache",
        "x-api-key": this.apiKey,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error("OpenSea request failed (" + response.status + ")");
    return (await response.json()) as T;
  }
}
