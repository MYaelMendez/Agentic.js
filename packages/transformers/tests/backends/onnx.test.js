import { normalizeDeviceOrder, deviceToExecutionProviders } from "../../src/backends/onnx.js";
import { env } from "../../src/env.js";

describe("backends/onnx", () => {
  describe("normalizeDeviceOrder", () => {
    it("returns execution providers for valid devices", () => {
      // 'cpu' is always supported in Node; expect it to map to 'cpu' EP
      const result = normalizeDeviceOrder(["cpu"]);
      expect(result).toContain("cpu");
      expect(result.length).toBeGreaterThan(0);
    });

    it("filters out unsupported devices", () => {
      // 'wasm' is not supported in Node; only 'cpu' should remain
      const result = normalizeDeviceOrder(["wasm", "cpu"]);
      expect(result).not.toContain("wasm");
      expect(result).toContain("cpu");
    });

    it("falls back to defaults when the entire list is invalid", () => {
      const result = normalizeDeviceOrder(["invalidDevice123", "anotherFakeDevice"]);
      // Should return non-empty default list
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("falls back to defaults for an empty array", () => {
      const result = normalizeDeviceOrder([]);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("falls back to defaults when called with no arguments", () => {
      const result = normalizeDeviceOrder();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });

    it("expands 'auto' to all supported devices", () => {
      const resultAuto = normalizeDeviceOrder(["auto"]);
      const resultNull = deviceToExecutionProviders("auto");
      expect(resultAuto).toEqual(resultNull);
    });

    it("deduplicates repeated valid entries", () => {
      const result = normalizeDeviceOrder(["cpu", "cpu"]);
      // Duplicates should be removed; 'cpu' appears only once
      expect(result.filter((ep) => ep === "cpu").length).toBe(1);
    });
  });

  describe("env defaults", () => {
    it("env.useModelCache is a boolean", () => {
      expect(typeof env.useModelCache).toBe("boolean");
    });

    it("env.preferredDeviceOrder is a non-empty array", () => {
      expect(Array.isArray(env.preferredDeviceOrder)).toBe(true);
      expect(env.preferredDeviceOrder.length).toBeGreaterThan(0);
    });

    it("env.preferredDeviceOrder includes 'cpu' as a fallback", () => {
      // 'cpu' must always be present so execution never fails without a fallback
      expect(env.preferredDeviceOrder).toContain("cpu");
    });

    it("normalizeDeviceOrder honors env.preferredDeviceOrder by producing a non-empty EP list", () => {
      const result = normalizeDeviceOrder(env.preferredDeviceOrder);
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
