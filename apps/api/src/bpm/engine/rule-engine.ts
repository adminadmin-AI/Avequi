import { Injectable } from '@nestjs/common';

export interface RuleValidationResult {
  valid: boolean;
  errors: string[];
}

@Injectable()
export class RuleEngine {
  /**
   * Evaluate a JsonLogic rule against a data object.
   * Returns any value (bool, number, string, array, etc.)
   */
  evaluate(rule: any, data: any): any {
    // Primitives pass through
    if (rule === null || rule === undefined) return rule;
    if (typeof rule !== 'object') return rule;
    if (Array.isArray(rule)) return rule.map((r) => this.evaluate(r, data));

    const keys = Object.keys(rule);
    if (keys.length === 0) return rule;

    const op = keys[0];
    const args = rule[op];

    switch (op) {
      // ─── Data access ──────────────────────────────────────────────────────
      case 'var': {
        const path = Array.isArray(args) ? args[0] : args;
        const defaultVal = Array.isArray(args) ? args[1] : undefined;
        if (path === '' || path === null || path === undefined) return data;
        const result = this.getVar(String(path), data);
        return result !== undefined ? result : (defaultVal !== undefined ? defaultVal : null);
      }

      case 'missing': {
        const keys2 = Array.isArray(args) ? args : [args];
        return keys2.filter((k: string) => {
          const v = this.getVar(String(k), data);
          return v === undefined || v === null || v === '';
        });
      }

      case 'missing_some': {
        const need = this.evaluate(args[0], data) as number;
        const keys3 = this.evaluate(args[1], data) as string[];
        const missing = keys3.filter((k) => {
          const v = this.getVar(String(k), data);
          return v === undefined || v === null || v === '';
        });
        const presentCount = keys3.length - missing.length;
        // If enough keys are present (>= need), return [] (threshold satisfied)
        return presentCount >= need ? [] : missing;
      }

      // ─── Logic ────────────────────────────────────────────────────────────
      case 'if': {
        const conditions = Array.isArray(args) ? args : [args];
        for (let i = 0; i < conditions.length - 1; i += 2) {
          if (this.isTruthy(this.evaluate(conditions[i], data))) {
            return this.evaluate(conditions[i + 1], data);
          }
        }
        // Last item is the else
        if (conditions.length % 2 === 1) {
          return this.evaluate(conditions[conditions.length - 1], data);
        }
        return null;
      }

      case '==': {
        const [a, b] = this.evalArgs(args, data);
        // eslint-disable-next-line eqeqeq
        return a == b;
      }

      case '===': {
        const [a, b] = this.evalArgs(args, data);
        return a === b;
      }

      case '!=': {
        const [a, b] = this.evalArgs(args, data);
        // eslint-disable-next-line eqeqeq
        return a != b;
      }

      case '!==': {
        const [a, b] = this.evalArgs(args, data);
        return a !== b;
      }

      case '>': {
        const [a, b] = this.evalArgs(args, data);
        return a > b;
      }

      case '>=': {
        const [a, b] = this.evalArgs(args, data);
        return a >= b;
      }

      case '<': {
        // Supports both [a, b] and [a, b, c] (between check)
        const vals = this.evalArgs(args, data);
        if (vals.length === 3) return vals[0] < vals[1] && vals[1] < vals[2];
        return vals[0] < vals[1];
      }

      case '<=': {
        const vals = this.evalArgs(args, data);
        if (vals.length === 3) return vals[0] <= vals[1] && vals[1] <= vals[2];
        return vals[0] <= vals[1];
      }

      case '!': {
        const val = Array.isArray(args) ? this.evaluate(args[0], data) : this.evaluate(args, data);
        return !this.isTruthy(val);
      }

      case '!!': {
        const val = Array.isArray(args) ? this.evaluate(args[0], data) : this.evaluate(args, data);
        return this.isTruthy(val);
      }

      case 'and': {
        const items = Array.isArray(args) ? args : [args];
        let last: any = true;
        for (const item of items) {
          last = this.evaluate(item, data);
          if (!this.isTruthy(last)) return last;
        }
        return last;
      }

      case 'or': {
        const items = Array.isArray(args) ? args : [args];
        let last: any = false;
        for (const item of items) {
          last = this.evaluate(item, data);
          if (this.isTruthy(last)) return last;
        }
        return last;
      }

      // ─── Numeric ──────────────────────────────────────────────────────────
      case '+': {
        const vals = this.evalArgs(args, data);
        if (vals.length === 1) return Number(vals[0]);
        return vals.reduce((acc: number, v: any) => acc + Number(v), 0);
      }

      case '-': {
        const vals = this.evalArgs(args, data);
        if (vals.length === 1) return -Number(vals[0]);
        return Number(vals[0]) - Number(vals[1]);
      }

      case '*': {
        const vals = this.evalArgs(args, data);
        return vals.reduce((acc: number, v: any) => acc * Number(v), 1);
      }

      case '/': {
        const [a, b] = this.evalArgs(args, data);
        return Number(a) / Number(b);
      }

      case '%': {
        const [a, b] = this.evalArgs(args, data);
        return Number(a) % Number(b);
      }

      case 'min': {
        const vals = this.evalArgs(args, data).map(Number);
        return Math.min(...vals);
      }

      case 'max': {
        const vals = this.evalArgs(args, data).map(Number);
        return Math.max(...vals);
      }

      // ─── String ───────────────────────────────────────────────────────────
      case 'cat': {
        const vals = this.evalArgs(args, data);
        return vals.join('');
      }

      case 'substr': {
        const vals = this.evalArgs(args, data);
        const str = String(vals[0]);
        const start = Number(vals[1]);
        if (vals.length === 3) {
          const len = Number(vals[2]);
          if (len >= 0) return str.substr(start < 0 ? Math.max(0, str.length + start) : start, len);
          // negative length: trim from end
          return str.substr(start < 0 ? Math.max(0, str.length + start) : start, str.length + len - (start < 0 ? str.length + start : start));
        }
        return str.substr(start < 0 ? Math.max(0, str.length + start) : start);
      }

      // ─── Array / String membership ────────────────────────────────────────
      case 'in': {
        const [needle, haystack] = this.evalArgs(args, data);
        if (typeof haystack === 'string') return haystack.includes(String(needle));
        if (Array.isArray(haystack)) return haystack.includes(needle);
        return false;
      }

      // ─── Array operations ─────────────────────────────────────────────────
      case 'map': {
        const [arr, mapper] = args as [any, any];
        const evaluated = this.evaluate(arr, data);
        if (!Array.isArray(evaluated)) return [];
        return evaluated.map((item) => this.evaluate(mapper, item));
      }

      case 'filter': {
        const [arr, condition] = args as [any, any];
        const evaluated = this.evaluate(arr, data);
        if (!Array.isArray(evaluated)) return [];
        return evaluated.filter((item) => this.isTruthy(this.evaluate(condition, item)));
      }

      case 'reduce': {
        const [arr, reducer, initial] = args as [any, any, any];
        const evaluated = this.evaluate(arr, data);
        if (!Array.isArray(evaluated)) return this.evaluate(initial, data);
        const init = this.evaluate(initial, data);
        return evaluated.reduce(
          (acc, current) => this.evaluate(reducer, { accumulator: acc, current }),
          init,
        );
      }

      case 'all': {
        const [arr, condition] = args as [any, any];
        const evaluated = this.evaluate(arr, data);
        if (!Array.isArray(evaluated) || evaluated.length === 0) return false;
        return evaluated.every((item) => this.isTruthy(this.evaluate(condition, item)));
      }

      case 'some': {
        const [arr, condition] = args as [any, any];
        const evaluated = this.evaluate(arr, data);
        if (!Array.isArray(evaluated) || evaluated.length === 0) return false;
        return evaluated.some((item) => this.isTruthy(this.evaluate(condition, item)));
      }

      case 'none': {
        const [arr, condition] = args as [any, any];
        const evaluated = this.evaluate(arr, data);
        if (!Array.isArray(evaluated)) return true;
        return !evaluated.some((item) => this.isTruthy(this.evaluate(condition, item)));
      }

      case 'merge': {
        const vals = this.evalArgs(args, data);
        return vals.reduce((acc: any[], v: any) => {
          if (Array.isArray(v)) return acc.concat(v);
          acc.push(v);
          return acc;
        }, []);
      }

      default:
        throw new Error(`Unknown JsonLogic operator: "${op}"`);
    }
  }

  /**
   * Validate a JsonLogic rule (structural validation).
   */
  validate(rule: any): RuleValidationResult {
    const errors: string[] = [];
    this.validateNode(rule, errors, '$');
    return { valid: errors.length === 0, errors };
  }

  private validateNode(node: any, errors: string[], path: string): void {
    if (node === null || node === undefined || typeof node !== 'object' || Array.isArray(node)) {
      return;
    }

    const keys = Object.keys(node);
    if (keys.length === 0) return;
    if (keys.length > 1) {
      errors.push(`${path}: rule object must have exactly one operator key, found: ${keys.join(', ')}`);
      return;
    }

    const op = keys[0];
    const knownOps = [
      'var', 'missing', 'missing_some', 'if',
      '==', '===', '!=', '!==', '>', '>=', '<', '<=',
      '!', '!!', 'and', 'or',
      '+', '-', '*', '/', '%', 'min', 'max',
      'cat', 'substr', 'in',
      'map', 'filter', 'reduce', 'all', 'some', 'none', 'merge',
    ];

    if (!knownOps.includes(op)) {
      errors.push(`${path}: unknown operator "${op}"`);
      return;
    }

    const args = node[op];
    if (Array.isArray(args)) {
      args.forEach((arg: any, i: number) => this.validateNode(arg, errors, `${path}.${op}[${i}]`));
    } else {
      this.validateNode(args, errors, `${path}.${op}`);
    }
  }

  private evalArgs(args: any, data: any): any[] {
    if (!Array.isArray(args)) return [this.evaluate(args, data)];
    return args.map((a) => this.evaluate(a, data));
  }

  private getVar(path: string, data: any): any {
    const parts = path.split('.');
    let current = data;
    for (const part of parts) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== 'object') return undefined;
      current = current[part];
    }
    return current;
  }

  private isTruthy(value: any): boolean {
    // JsonLogic falsy: null, undefined, false, 0, '', []
    if (value === null || value === undefined) return false;
    if (value === false) return false;
    if (value === 0) return false;
    if (value === '') return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }
}
