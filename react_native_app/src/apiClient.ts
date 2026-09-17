import { Platform } from 'react-native';

export type JsonObject = Record<string, unknown>;

export class ApiResult {
  constructor(
    readonly statusCode: number,
    readonly body: JsonObject,
    readonly headers: Headers,
  ) {}

  get isSuccess() {
    return this.statusCode >= 200 && this.statusCode < 300;
  }

  get errorCode() {
    return typeof this.body.error === 'string' ? this.body.error : undefined;
  }
}

export const personas = [
  'approved',
  'utilization-too-high',
  'insufficient-history',
  'new-credit-lines',
] as const;

export type Persona = (typeof personas)[number];

function apiHost() {
  if (process.env.EXPO_PUBLIC_API_HOST) {
    return process.env.EXPO_PUBLIC_API_HOST;
  }
  return Platform.OS === 'android' ? '10.0.2.2' : 'localhost';
}

export class ApiClient {
  persona: Persona = 'approved';

  private uri(path: string) {
    return 'http://' + apiHost() + ':4010' + path;
  }

  private headers() {
    return {
      'content-type': 'application/json',
      'x-test-persona': this.persona,
    };
  }

  private async wrap(request: Promise<Response>) {
    const response = await request;
    let body: JsonObject;
    try {
      const decoded: unknown = await response.json();
      body = decoded !== null && typeof decoded === 'object'
        ? (decoded as JsonObject)
        : { error: 'UNPARSEABLE' };
    } catch {
      body = { error: 'UNPARSEABLE' };
    }
    return new ApiResult(response.status, body, response.headers);
  }

  getCreditLine() {
    return this.wrap(fetch(this.uri('/v1/credit-line'), { headers: this.headers() }));
  }

  submitIncreaseRequest(amountCents: number) {
    return this.wrap(
      fetch(this.uri('/v1/credit-line/increase-requests'), {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify({ requested_amount_cents: amountCents }),
      }),
    );
  }
}
