import { describe, it, expect } from "vitest";
import { parseLists, parsePlaces, stripXssiPrefix, extractSessionToken } from "../src/parser.js";
import masFixture from "./fixtures/mas-response.json";
import getlistFixture from "./fixtures/getlist-response.json";

describe("stripXssiPrefix", () => {
  it("strips the XSSI prefix from a response", () => {
    const input = ")]}'\n{\"data\": true}";
    expect(stripXssiPrefix(input)).toBe("{\"data\": true}");
  });

  it("returns the string unchanged if no prefix", () => {
    const input = "{\"data\": true}";
    expect(stripXssiPrefix(input)).toBe("{\"data\": true}");
  });
});

describe("extractSessionToken", () => {
  it("extracts session token from mas request URL", () => {
    const url = "https://www.google.com/locationhistory/preview/mas?authuser=0&hl=en&gl=us&pb=!2m3!1svNjKacyKCO-zqtsPmJ-8oAY!7e81!15i20393";
    expect(extractSessionToken(url)).toBe("vNjKacyKCO-zqtsPmJ-8oAY");
  });

  it("returns null if no token found", () => {
    const url = "https://www.google.com/maps/something";
    expect(extractSessionToken(url)).toBeNull();
  });
});

describe("parseLists", () => {
  it("parses list metadata from mas response", () => {
    const result = parseLists(JSON.stringify(masFixture));

    // Should have 49 lists total
    expect(result.length).toBe(49);

    // First list: "Want to go"
    expect(result[0]).toEqual({
      id: "1x5yjcIYJ3nW-DmNRQr9BuNTu9ig",
      name: "Want to go",
      type: 3,
      count: 35,
    });

    // Check a user-created list
    const houston = result.find((l) => l.name === "Houston Drinking New");
    expect(houston).toBeDefined();
    expect(houston!.type).toBe(1);
    expect(houston!.count).toBe(31);
  });

  it("handles built-in lists with null IDs", () => {
    const result = parseLists(JSON.stringify(masFixture));
    const savedPlaces = result.find((l) => l.name === "Saved places");
    expect(savedPlaces).toBeDefined();
    expect(savedPlaces!.id).toBeNull();
    expect(savedPlaces!.type).toBe(6);
  });

  it("throws on invalid structure", () => {
    expect(() => parseLists("[[]]")).toThrow();
  });
});

describe("parsePlaces", () => {
  it("parses places from getlist response", () => {
    const result = parsePlaces(JSON.stringify(getlistFixture));

    // Houston Drinking New has 31 places
    expect(result.length).toBe(31);

    // First place: Marquis II
    expect(result[0]).toEqual({
      name: "Marquis II",
      lat: 29.7252297,
      lng: -95.4200982,
      address: "Marquis II, 2631 Bissonnet St, Houston, TX 77005",
      comment: "",
      placeId: "-8772799911369865815_-4757512616063040366",
    });
  });

  it("handles places with empty address", () => {
    const result = parsePlaces(JSON.stringify(getlistFixture));
    const ojeman = result.find((p) => p.name === "Eighteen Ten Ojeman");
    expect(ojeman).toBeDefined();
    expect(ojeman!.address).toBe("");
  });
});
