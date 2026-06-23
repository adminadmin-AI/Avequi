import { RuleEngine } from './rule-engine';

describe('RuleEngine', () => {
  let engine: RuleEngine;

  beforeEach(() => {
    engine = new RuleEngine();
  });

  // ─── var (data access) ──────────────────────────────────────────────────────

  describe('var operator', () => {
    it('should access top-level property', () => {
      expect(engine.evaluate({ var: 'amount' }, { amount: 500 })).toBe(500);
    });

    it('should access nested property with dot notation', () => {
      expect(
        engine.evaluate({ var: 'order.total' }, { order: { total: 1000 } }),
      ).toBe(1000);
    });

    it('should return null for missing key', () => {
      expect(engine.evaluate({ var: 'missing' }, {})).toBeNull();
    });

    it('should return default value for missing key', () => {
      expect(engine.evaluate({ var: ['missing', 'default'] }, {})).toBe('default');
    });

    it('should return entire data when path is empty string', () => {
      const data = { x: 1 };
      expect(engine.evaluate({ var: '' }, data)).toEqual(data);
    });
  });

  // ─── Comparison operators ───────────────────────────────────────────────────

  describe('comparison operators', () => {
    const data = { amount: 10000, name: 'PURCHASE_ORDER' };

    it('> should return true when left > right', () => {
      expect(engine.evaluate({ '>': [{ var: 'amount' }, 9999] }, data)).toBe(true);
    });

    it('> should return false when left <= right', () => {
      expect(engine.evaluate({ '>': [{ var: 'amount' }, 10000] }, data)).toBe(false);
    });

    it('>= should return true when equal', () => {
      expect(engine.evaluate({ '>=': [{ var: 'amount' }, 10000] }, data)).toBe(true);
    });

    it('< should return true when left < right', () => {
      expect(engine.evaluate({ '<': [{ var: 'amount' }, 20000] }, data)).toBe(true);
    });

    it('<= should return true when equal', () => {
      expect(engine.evaluate({ '<=': [{ var: 'amount' }, 10000] }, data)).toBe(true);
    });

    it('== should use loose equality', () => {
      expect(engine.evaluate({ '==': [1, '1'] }, data)).toBe(true);
    });

    it('=== should use strict equality', () => {
      expect(engine.evaluate({ '===': [1, '1'] }, data)).toBe(false);
      expect(engine.evaluate({ '===': [1, 1] }, data)).toBe(true);
    });

    it('!= should use loose inequality', () => {
      expect(engine.evaluate({ '!=': [1, '1'] }, data)).toBe(false);
      expect(engine.evaluate({ '!=': [1, 2] }, data)).toBe(true);
    });

    it('!== should use strict inequality', () => {
      expect(engine.evaluate({ '!==': [1, '1'] }, data)).toBe(true);
      expect(engine.evaluate({ '!==': [1, 1] }, data)).toBe(false);
    });

    it('< with 3 args (between) should work', () => {
      expect(engine.evaluate({ '<': [1, 5, 10] }, {})).toBe(true);
      expect(engine.evaluate({ '<': [1, 10, 5] }, {})).toBe(false);
    });
  });

  // ─── Logic operators ────────────────────────────────────────────────────────

  describe('logic operators', () => {
    it('and should return true when all are truthy', () => {
      expect(
        engine.evaluate(
          { and: [{ '>': [5, 1] }, { '<': [5, 10] }] },
          {},
        ),
      ).toBe(true);
    });

    it('and should short-circuit on first falsy', () => {
      expect(
        engine.evaluate({ and: [false, { '>': [5, 1] }] }, {}),
      ).toBe(false);
    });

    it('or should return true when any is truthy', () => {
      expect(
        engine.evaluate({ or: [false, { '>': [5, 1] }] }, {}),
      ).toBe(true);
    });

    it('or should return last falsy value when all falsy', () => {
      expect(engine.evaluate({ or: [false, 0, ''] }, {})).toBe('');
    });

    it('! should negate truthy value', () => {
      expect(engine.evaluate({ '!': [true] }, {})).toBe(false);
      expect(engine.evaluate({ '!': [false] }, {})).toBe(true);
    });

    it('!! should double-negate', () => {
      expect(engine.evaluate({ '!!': [1] }, {})).toBe(true);
      expect(engine.evaluate({ '!!': [0] }, {})).toBe(false);
    });
  });

  // ─── if / ternary ───────────────────────────────────────────────────────────

  describe('if operator', () => {
    it('should return then-branch when condition is true', () => {
      expect(
        engine.evaluate({ if: [true, 'yes', 'no'] }, {}),
      ).toBe('yes');
    });

    it('should return else-branch when condition is false', () => {
      expect(
        engine.evaluate({ if: [false, 'yes', 'no'] }, {}),
      ).toBe('no');
    });

    it('should handle multi-level if/else-if/else', () => {
      const rule = {
        if: [
          { '>': [{ var: 'amount' }, 50000] }, 'HIGH',
          { '>': [{ var: 'amount' }, 10000] }, 'MEDIUM',
          'LOW',
        ],
      };
      expect(engine.evaluate(rule, { amount: 60000 })).toBe('HIGH');
      expect(engine.evaluate(rule, { amount: 20000 })).toBe('MEDIUM');
      expect(engine.evaluate(rule, { amount: 5000 })).toBe('LOW');
    });
  });

  // ─── Numeric operators ──────────────────────────────────────────────────────

  describe('numeric operators', () => {
    it('+ should sum values', () => {
      expect(engine.evaluate({ '+': [1, 2, 3] }, {})).toBe(6);
    });

    it('- should subtract', () => {
      expect(engine.evaluate({ '-': [10, 3] }, {})).toBe(7);
    });

    it('- with single arg should negate', () => {
      expect(engine.evaluate({ '-': [5] }, {})).toBe(-5);
    });

    it('* should multiply', () => {
      expect(engine.evaluate({ '*': [3, 4] }, {})).toBe(12);
    });

    it('/ should divide', () => {
      expect(engine.evaluate({ '/': [10, 4] }, {})).toBe(2.5);
    });

    it('% should modulo', () => {
      expect(engine.evaluate({ '%': [10, 3] }, {})).toBe(1);
    });

    it('min should return minimum', () => {
      expect(engine.evaluate({ min: [3, 1, 2] }, {})).toBe(1);
    });

    it('max should return maximum', () => {
      expect(engine.evaluate({ max: [3, 1, 2] }, {})).toBe(3);
    });
  });

  // ─── String operators ────────────────────────────────────────────────────────

  describe('string operators', () => {
    it('cat should concatenate strings', () => {
      expect(engine.evaluate({ cat: ['hello', ' ', 'world'] }, {})).toBe('hello world');
    });

    it('cat should coerce non-strings', () => {
      expect(engine.evaluate({ cat: ['value: ', { var: 'x' }] }, { x: 42 })).toBe('value: 42');
    });

    it('substr should extract substring', () => {
      expect(engine.evaluate({ substr: ['hello world', 6] }, {})).toBe('world');
    });

    it('substr with length should work', () => {
      expect(engine.evaluate({ substr: ['hello world', 0, 5] }, {})).toBe('hello');
    });
  });

  // ─── in operator ─────────────────────────────────────────────────────────────

  describe('in operator', () => {
    it('should check string contains', () => {
      expect(engine.evaluate({ in: ['ello', 'hello world'] }, {})).toBe(true);
      expect(engine.evaluate({ in: ['xyz', 'hello world'] }, {})).toBe(false);
    });

    it('should check array membership', () => {
      expect(engine.evaluate({ in: ['APPROVED', ['APPROVED', 'PENDING']] }, {})).toBe(true);
      expect(engine.evaluate({ in: ['REJECTED', ['APPROVED', 'PENDING']] }, {})).toBe(false);
    });
  });

  // ─── Array operators ─────────────────────────────────────────────────────────

  describe('array operators', () => {
    const data = { items: [1, 2, 3, 4, 5] };

    it('map should transform each element', () => {
      const rule = { map: [{ var: 'items' }, { '*': [{ var: '' }, 2] }] };
      expect(engine.evaluate(rule, data)).toEqual([2, 4, 6, 8, 10]);
    });

    it('filter should return matching elements', () => {
      const rule = { filter: [{ var: 'items' }, { '>': [{ var: '' }, 3] }] };
      expect(engine.evaluate(rule, data)).toEqual([4, 5]);
    });

    it('reduce should accumulate', () => {
      const rule = {
        reduce: [
          { var: 'items' },
          { '+': [{ var: 'accumulator' }, { var: 'current' }] },
          0,
        ],
      };
      expect(engine.evaluate(rule, data)).toBe(15);
    });

    it('some should return true if any element matches', () => {
      const rule = { some: [{ var: 'items' }, { '>': [{ var: '' }, 4] }] };
      expect(engine.evaluate(rule, data)).toBe(true);
    });

    it('none should return true if no element matches', () => {
      const rule = { none: [{ var: 'items' }, { '>': [{ var: '' }, 10] }] };
      expect(engine.evaluate(rule, data)).toBe(true);
    });

    it('all should return true if all elements match', () => {
      const rule = { all: [{ var: 'items' }, { '>': [{ var: '' }, 0] }] };
      expect(engine.evaluate(rule, data)).toBe(true);
    });

    it('all should return false if any element fails', () => {
      const rule = { all: [{ var: 'items' }, { '>': [{ var: '' }, 3] }] };
      expect(engine.evaluate(rule, data)).toBe(false);
    });
  });

  // ─── missing / missing_some ───────────────────────────────────────────────────

  describe('missing operator', () => {
    it('should return list of missing keys', () => {
      const result = engine.evaluate(
        { missing: ['name', 'email'] },
        { name: 'John' },
      );
      expect(result).toEqual(['email']);
    });

    it('should return empty array when all keys present', () => {
      const result = engine.evaluate(
        { missing: ['name'] },
        { name: 'John' },
      );
      expect(result).toEqual([]);
    });

    it('missing_some should return missing keys when threshold not met', () => {
      const result = engine.evaluate(
        { missing_some: [2, ['name', 'email', 'phone']] },
        { name: 'John' },
      );
      expect(result).toEqual(['email', 'phone']);
    });

    it('missing_some should return empty array when threshold met', () => {
      const result = engine.evaluate(
        { missing_some: [1, ['name', 'email']] },
        { name: 'John' },
      );
      expect(result).toEqual([]);
    });
  });

  // ─── Nested / complex rules ───────────────────────────────────────────────────

  describe('nested rules', () => {
    it('should evaluate complex nested rule', () => {
      const rule = {
        and: [
          { '>': [{ var: 'amount' }, 1000] },
          { '==': [{ var: 'type' }, 'PURCHASE_ORDER'] },
        ],
      };
      expect(engine.evaluate(rule, { amount: 5000, type: 'PURCHASE_ORDER' })).toBe(true);
      expect(engine.evaluate(rule, { amount: 500, type: 'PURCHASE_ORDER' })).toBe(false);
      expect(engine.evaluate(rule, { amount: 5000, type: 'SALES_ORDER' })).toBe(false);
    });

    it('should evaluate arithmetic inside conditions', () => {
      const rule = { '>': [{ '+': [{ var: 'base' }, { var: 'tax' }] }, 1000] };
      expect(engine.evaluate(rule, { base: 900, tax: 150 })).toBe(true);
      expect(engine.evaluate(rule, { base: 800, tax: 150 })).toBe(false);
    });

    it('should handle deeply nested var access', () => {
      const rule = { '>': [{ var: 'order.items.0.price' }, 100] };
      expect(
        engine.evaluate(rule, { order: { items: [{ price: 200 }] } }),
      ).toBe(true);
    });
  });

  // ─── Primitives pass-through ──────────────────────────────────────────────────

  describe('primitive pass-through', () => {
    it('should return primitive number as-is', () => {
      expect(engine.evaluate(42, {})).toBe(42);
    });

    it('should return primitive string as-is', () => {
      expect(engine.evaluate('hello', {})).toBe('hello');
    });

    it('should return primitive boolean as-is', () => {
      expect(engine.evaluate(true, {})).toBe(true);
    });

    it('should return null as-is', () => {
      expect(engine.evaluate(null, {})).toBeNull();
    });
  });

  // ─── validate ─────────────────────────────────────────────────────────────────

  describe('validate', () => {
    it('should validate a valid rule', () => {
      const result = engine.validate({ '>': [{ var: 'amount' }, 100] });
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject unknown operator', () => {
      const result = engine.validate({ badOp: [1, 2] });
      expect(result.valid).toBe(false);
      expect(result.errors[0]).toContain('unknown operator');
    });

    it('should validate nested rules', () => {
      const result = engine.validate({
        and: [
          { '>': [{ var: 'x' }, 0] },
          { '<': [{ var: 'x' }, 100] },
        ],
      });
      expect(result.valid).toBe(true);
    });
  });

  // ─── Edge cases ───────────────────────────────────────────────────────────────

  describe('edge cases', () => {
    it('should handle empty array for some/none/all', () => {
      expect(engine.evaluate({ some: [[], { '>': [{ var: '' }, 0] }] }, {})).toBe(false);
      expect(engine.evaluate({ none: [[], { '>': [{ var: '' }, 0] }] }, {})).toBe(true);
      expect(engine.evaluate({ all: [[], { '>': [{ var: '' }, 0] }] }, {})).toBe(false);
    });

    it('should handle null data gracefully', () => {
      expect(engine.evaluate({ var: 'x' }, null)).toBeNull();
    });

    it('should handle string cat with numbers', () => {
      expect(engine.evaluate({ cat: ['Total: R$ ', 1500] }, {})).toBe('Total: R$ 1500');
    });

    it('+ with single string arg should coerce to number', () => {
      expect(engine.evaluate({ '+': ['5'] }, {})).toBe(5);
    });
  });
});
