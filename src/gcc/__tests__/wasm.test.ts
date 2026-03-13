import { describe, it, expect } from "vitest";
import { encodeUnsignedLEB128, encodeSignedLEB128 } from "../wasm.ts";

describe("WASM helpers", () => {
  describe("encodeUnsignedLEB128", () => {
    it("encodes 0", () => {
      expect(encodeUnsignedLEB128(0)).toEqual([0x00]);
    });

    it("encodes small values (< 128) as single byte", () => {
      expect(encodeUnsignedLEB128(1)).toEqual([0x01]);
      expect(encodeUnsignedLEB128(42)).toEqual([42]);
      expect(encodeUnsignedLEB128(127)).toEqual([0x7f]);
    });

    it("encodes 128 as two bytes", () => {
      expect(encodeUnsignedLEB128(128)).toEqual([0x80, 0x01]);
    });

    it("encodes 255 as two bytes", () => {
      expect(encodeUnsignedLEB128(255)).toEqual([0xff, 0x01]);
    });

    it("encodes 624485 (example from Wikipedia)", () => {
      expect(encodeUnsignedLEB128(624485)).toEqual([0xe5, 0x8e, 0x26]);
    });
  });

  describe("encodeSignedLEB128", () => {
    it("encodes 0", () => {
      expect(encodeSignedLEB128(0)).toEqual([0x00]);
    });

    it("encodes small positive values", () => {
      expect(encodeSignedLEB128(1)).toEqual([0x01]);
      expect(encodeSignedLEB128(42)).toEqual([42]);
      expect(encodeSignedLEB128(63)).toEqual([0x3f]);
    });

    it("encodes 64 as two bytes (sign bit would be set in single byte)", () => {
      expect(encodeSignedLEB128(64)).toEqual([0xc0, 0x00]);
    });

    it("encodes -1", () => {
      expect(encodeSignedLEB128(-1)).toEqual([0x7f]);
    });

    it("encodes -64 as single byte", () => {
      expect(encodeSignedLEB128(-64)).toEqual([0x40]);
    });

    it("encodes -65 as two bytes", () => {
      expect(encodeSignedLEB128(-65)).toEqual([0xbf, 0x7f]);
    });

    it("encodes -123456 (example from Wikipedia)", () => {
      expect(encodeSignedLEB128(-123456)).toEqual([0xc0, 0xbb, 0x78]);
    });
  });
});
