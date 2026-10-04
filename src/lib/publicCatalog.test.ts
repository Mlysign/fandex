import { afterEach, describe, expect, it } from "vitest";
import { publicCatalogEnabled } from "./publicCatalog";
import robots from "@/app/robots";

afterEach(() => {
  delete process.env.PUBLIC_CATALOG;
});

describe("PUBLIC_CATALOG", () => {
  it("is on by default and on for anything that is not an explicit off", () => {
    expect(publicCatalogEnabled()).toBe(true);
    process.env.PUBLIC_CATALOG = "yes";
    expect(publicCatalogEnabled()).toBe(true);
    process.env.PUBLIC_CATALOG = "";
    expect(publicCatalogEnabled()).toBe(true);
  });

  it("is off for 0, false and off, read at call time", () => {
    for (const v of ["0", "false", "OFF", " off "]) {
      process.env.PUBLIC_CATALOG = v;
      expect(publicCatalogEnabled(), v).toBe(false);
    }
  });

  it("robots.txt invites the catalog when on, and only /legal/ when off", () => {
    const on = robots();
    const onRule = on.rules as { allow: string[]; disallow: string[] }[];
    expect(onRule[0].allow).toContain("/movie/");
    expect(onRule[0].disallow).not.toContain("/");

    process.env.PUBLIC_CATALOG = "0";
    const off = robots();
    const offRule = off.rules as { allow: string[]; disallow: string[] }[];
    expect(offRule).toHaveLength(1);
    expect(offRule[0].allow).toEqual(["/legal/"]);
    expect(offRule[0].disallow).toEqual(["/"]);
  });
});
