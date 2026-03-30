import { describe, it, expect } from "vitest";
import { parseLists, parsePlaces, stripXssiPrefix } from "../src/parser.js";
import listsFixture from "./fixtures/lists-response.json";
import placesFixture from "./fixtures/places-response.json";

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

describe("parseLists", () => {
  it("parses list metadata from raw response", () => {
    const result = parseLists(listsFixture.raw);
    expect(result).toEqual(listsFixture.expectedLists);
  });

  it("throws descriptive error on invalid structure", () => {
    expect(() => parseLists(")]}'\n[[]]")).toThrow();
  });

  it("returns empty array for empty entries", () => {
    const result = parseLists(")]}'\n[[null,[]]]");
    expect(result).toEqual([]);
  });
});

describe("parsePlaces", () => {
  it("parses places from raw response", () => {
    const result = parsePlaces(placesFixture.raw);
    expect(result).toEqual(placesFixture.expectedPlaces);
  });

  it("throws descriptive error when a required field is missing", () => {
    // Entry has [1] = ["url","id"] which is too short for [1][5][2] (lat path)
    const broken = ")]}'\n[[null,null,null,null,null,null,null,null,[[null,[\"url\",\"id\"],\"Name\",null,null]]]]";
    expect(() => parsePlaces(broken)).toThrow(/lat/);
  });
});
