/**
 * The shrink-on-arrival rules, against the table the Python worker is tested with too
 * (workers/optimize/target_cases.json).
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planTarget, type SourceSummary, type TargetPlan } from "@/lib/media/target";

interface Case {
  name: string;
  source: SourceSummary;
  plan: TargetPlan;
}

const cases = JSON.parse(readFileSync(path.resolve(__dirname, "../../../workers/optimize/target_cases.json"), "utf8")) as Case[];

describe("planTarget", () => {
  it("has cases", () => expect(cases.length).toBeGreaterThan(10));

  it.each(cases.map((c) => [c.name, c] as const))("%s", (_name, c) => {
    expect(planTarget(c.source)).toEqual(c.plan);
  });
});
