import { describe, expect, it } from "vitest";
import { challengeProcessEnvironment, generatedProcessEnvironment } from "../src/environment.js";

describe("child process environment isolation", () => {
  const source = {
    PATH: "/bin",
    HOME: "/tmp/home",
    LANG: "en_US.UTF-8",
    BERGET_API_KEY: "provider-secret",
    AWS_SECRET_ACCESS_KEY: "unrelated-secret",
    GITHUB_TOKEN: "unrelated-token",
    CHALLENGE_PROVIDER: "berget",
    CHALLENGE_MODEL: "model",
    CHALLENGE_WEIGHTED_TOKEN_BUDGET: "1000",
  };

  it("removes all credentials from generated application commands", () => {
    expect(generatedProcessEnvironment(source)).toEqual({ PATH: "/bin", HOME: "/tmp/home", LANG: "en_US.UTF-8" });
  });

  it("passes only the selected provider credential to the Pi challenge", () => {
    expect(challengeProcessEnvironment(source)).toMatchObject({
      PATH: "/bin",
      BERGET_API_KEY: "provider-secret",
      CHALLENGE_PROVIDER: "berget",
      CHALLENGE_MODEL: "model",
      CHALLENGE_WEIGHTED_TOKEN_BUDGET: "1000",
    });
    expect(challengeProcessEnvironment(source)).not.toHaveProperty("AWS_SECRET_ACCESS_KEY");
    expect(challengeProcessEnvironment(source)).not.toHaveProperty("GITHUB_TOKEN");
  });
});
