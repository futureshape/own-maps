import { fileURLToPath } from "node:url";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(fileURLToPath(new URL("./migrations", import.meta.url))),
          GOOGLE_CLIENT_ID: "test-client.apps.googleusercontent.com",
          GOOGLE_MAPS_STATIC_API_KEY: "test-static-maps-key",
          APP_ENV: "test",
        },
      },
    })),
  ],
  test: {
    setupFiles: ["./test/apply-migrations.ts"],
    include: ["test/**/*.test.ts"],
  },
});
