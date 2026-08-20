import type { Handler, RequestContext } from "./types";

type Route = {
  method: string;
  pattern: URLPattern;
  handler: Handler;
};

export class Router {
  private readonly routes: Route[] = [];

  on(method: string, pathname: string, handler: Handler): this {
    this.routes.push({ method, pattern: new URLPattern({ pathname }), handler });
    return this;
  }

  async route(context: Omit<RequestContext, "params">): Promise<Response | null> {
    for (const route of this.routes) {
      if (route.method !== context.request.method) continue;
      const match = route.pattern.exec(context.url);
      if (!match) continue;
      const params = Object.fromEntries(
        Object.entries(match.pathname.groups).map(([key, value]) => [key, value ? decodeURIComponent(value) : ""]),
      );
      return route.handler({ ...context, params });
    }
    return null;
  }
}
