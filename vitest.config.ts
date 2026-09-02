import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Several root tests intentionally spawn their own app test/build/dev
    // processes. Running those files concurrently oversubscribes small CI and
    // Docker runners, creating timeout-only failures. Serialize root files while
    // leaving every nested app suite and assertion unchanged.
    fileParallelism: false,
  },
});
