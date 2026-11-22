import { expect, test } from "bun:test";

test("CI canary: deliberately fails to prove the workflow goes red", () => {
  expect(1).toBe(2);
});
